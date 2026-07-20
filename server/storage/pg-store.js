// PostgreSQL persistence (used when DATABASE_URL is set).
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

class PgStore {
  constructor(cfg) {
    this.cfg = cfg;
    this.vectorReady = false;
    this.vectorDimensions = cfg.knowledge?.embeddingDimensions || 1536;
    this.pool = new Pool({
      connectionString: cfg.databaseUrl,
      ssl: cfg.pgSsl ? { rejectUnauthorized: false } : false,
    });
  }
  async init() {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await this.pool.query(schema);
    if (this.cfg.pgvector) await this.initVector();
  }
  async q(text, params) { return (await this.pool.query(text, params)).rows; }

  async initVector() {
    try {
      await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
      await this.pool.query(`ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_vec vector(${this.vectorDimensions})`);
      try {
        await this.pool.query('CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding_vec ON knowledge_chunks USING hnsw (embedding_vec vector_cosine_ops)');
      } catch (idxErr) {
        console.warn('[storage] pgvector index unavailable; vector search will run without HNSW index:', idxErr.message);
      }
      this.vectorReady = true;
      console.log(`[storage] pgvector enabled for knowledge chunks (${this.vectorDimensions} dimensions)`);
    } catch (err) {
      this.vectorReady = false;
      console.warn('[storage] pgvector unavailable; using JSON embedding search:', err.message);
    }
  }

  // Users
  async createUser(u) {
    await this.q(
      `INSERT INTO users (id, username, password_hash, full_name, email, department, role, active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [u.id, u.username, u.password_hash, u.full_name, u.email, u.department, u.role, u.active, u.created_at]);
    return u;
  }
  async getUserByUsername(username) { return (await this.q('SELECT * FROM users WHERE username=$1', [username]))[0] || null; }
  async getUserById(id) { return (await this.q('SELECT * FROM users WHERE id=$1', [id]))[0] || null; }
  async listUsers() { return this.q('SELECT * FROM users ORDER BY username'); }
  async updateUser(id, patch) {
    const cols = Object.keys(patch);
    if (!cols.length) return this.getUserById(id);
    const sets = cols.map((c, i) => `${c}=$${i + 2}`).join(', ');
    await this.q(`UPDATE users SET ${sets} WHERE id=$1`, [id, ...cols.map(c => patch[c])]);
    return this.getUserById(id);
  }
  async deleteUser(id) { await this.q('DELETE FROM users WHERE id=$1', [id]); }
  async countUsers() { return parseInt((await this.q('SELECT COUNT(*) AS n FROM users'))[0].n, 10); }

  // Workspaces
  async createWorkspace(w) {
    await this.q(
      `INSERT INTO workspaces (id, owner_id, title, brief, language, mode, kind, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [w.id, w.owner_id, w.title, w.brief, w.language, w.mode, w.kind || 'analysis', w.status, w.created_at, w.updated_at]);
    return w;
  }
  async listWorkspaces(ownerId, includeArchived) {
    return this.q(
      `SELECT * FROM workspaces WHERE owner_id=$1 ${includeArchived ? '' : "AND status <> 'archived'"} ORDER BY updated_at DESC`,
      [ownerId]);
  }
  async getWorkspace(id) { return (await this.q('SELECT * FROM workspaces WHERE id=$1', [id]))[0] || null; }
  async updateWorkspace(id, patch) {
    patch = { ...patch, updated_at: new Date().toISOString() };
    const cols = Object.keys(patch);
    const sets = cols.map((c, i) => `${c}=$${i + 2}`).join(', ');
    await this.q(`UPDATE workspaces SET ${sets} WHERE id=$1`, [id, ...cols.map(c => patch[c])]);
    return this.getWorkspace(id);
  }
  async deleteWorkspace(id) { await this.q('DELETE FROM workspaces WHERE id=$1', [id]); }

  // Files
  async addFile(f) {
    await this.q(
      `INSERT INTO files (id, workspace_id, original_name, stored_name, mime_type, size_bytes, extracted_text, content, file_data, uploaded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [f.id, f.workspace_id, f.original_name, f.stored_name, f.mime_type, f.size_bytes, f.extracted_text, f.content || null, f.file_data || f.content || null, f.uploaded_at]);
    return f;
  }
  async listFiles(wsId) { return this.q('SELECT id, workspace_id, original_name, stored_name, mime_type, size_bytes, extracted_text, uploaded_at FROM files WHERE workspace_id=$1 ORDER BY uploaded_at', [wsId]); }
  async getFile(id) { return (await this.q('SELECT id, workspace_id, original_name, stored_name, mime_type, size_bytes, uploaded_at FROM files WHERE id=$1', [id]))[0] || null; }
  async getFileContent(id) { const r = (await this.q('SELECT COALESCE(content, file_data) AS content FROM files WHERE id=$1', [id]))[0]; return r ? r.content : null; }
  async deleteFile(id) { await this.q('DELETE FROM files WHERE id=$1', [id]); }

  // Analyses
  async addAnalysis(a) {
    await this.q(
      `INSERT INTO analyses (id, workspace_id, mode, provider, model, result, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [a.id, a.workspace_id, a.mode, a.provider, a.model, JSON.stringify(a.result), a.created_at]);
    return a;
  }
  async listAnalyses(wsId) { return this.q('SELECT * FROM analyses WHERE workspace_id=$1 ORDER BY created_at DESC', [wsId]); }

  // Messages
  async addMessage(m) {
    await this.q(
      `INSERT INTO messages (id, workspace_id, role, content, provider, model, mode, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [m.id, m.workspace_id, m.role, m.content, m.provider, m.model, m.mode, m.created_at]);
    return m;
  }
  async listMessages(wsId) { return this.q('SELECT * FROM messages WHERE workspace_id=$1 ORDER BY created_at', [wsId]); }

  // Outputs
  async addOutput(o) {
    await this.q(
      `INSERT INTO outputs (id, workspace_id, type, format, title, file_name, content, file_data, provider, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [o.id, o.workspace_id, o.type, o.format, o.title, o.file_name, o.content, o.file_data || null, o.provider, o.created_at]);
    return o;
  }
  async listOutputs(wsId) { return this.q('SELECT id, workspace_id, type, format, title, file_name, content, provider, created_at FROM outputs WHERE workspace_id=$1 ORDER BY created_at DESC', [wsId]); }
  async getOutput(id) { return (await this.q('SELECT id, workspace_id, type, format, title, file_name, content, provider, created_at FROM outputs WHERE id=$1', [id]))[0] || null; }
  async getOutputFile(id) { const r = (await this.q('SELECT file_data FROM outputs WHERE id=$1', [id]))[0]; return r ? r.file_data : null; }
  async updateOutput(id, patch) {
    const cols = Object.keys(patch);
    if (!cols.length) return this.getOutput(id);
    const sets = cols.map((c, i) => `${c}=$${i + 2}`).join(', ');
    await this.q(`UPDATE outputs SET ${sets} WHERE id=$1`, [id, ...cols.map(c => patch[c])]);
    return this.getOutput(id);
  }
  async deleteOutput(id) { await this.q('DELETE FROM outputs WHERE id=$1', [id]); }

  // Notes
  async addNote(n) {
    await this.q(
      `INSERT INTO notes (id, workspace_id, author_id, content, created_at) VALUES ($1,$2,$3,$4,$5)`,
      [n.id, n.workspace_id, n.author_id, n.content, n.created_at]);
    return n;
  }
  async listNotes(wsId) { return this.q('SELECT * FROM notes WHERE workspace_id=$1 ORDER BY created_at DESC', [wsId]); }
  async deleteNote(id) { await this.q('DELETE FROM notes WHERE id=$1', [id]); }

  // Activity logs
  async addLog(l) {
    await this.q(
      `INSERT INTO logs (id, user_id, username, action, workspace_id, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [l.id, l.user_id, l.username, l.action, l.workspace_id || null, l.detail, l.created_at]);
    return l;
  }
  async listLogs(limit = 300) { return this.q('SELECT * FROM logs ORDER BY created_at DESC LIMIT $1', [limit]); }

  // Knowledge base
  async addKnowledgeDocument(d) {
    await this.q(
      `INSERT INTO knowledge_documents (id, title, original_name, stored_name, mime_type, size_bytes, language, active, chunk_count, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [d.id, d.title, d.original_name, d.stored_name || '', d.mime_type || '', d.size_bytes || 0, d.language || 'auto',
        d.active !== false, d.chunk_count || 0, d.created_by || null, d.created_at, d.updated_at || d.created_at]);
    return d;
  }
  async updateKnowledgeDocument(id, patch) {
    patch = { ...patch, updated_at: new Date().toISOString() };
    const cols = Object.keys(patch);
    if (!cols.length) return (await this.q('SELECT * FROM knowledge_documents WHERE id=$1', [id]))[0] || null;
    const sets = cols.map((c, i) => `${c}=$${i + 2}`).join(', ');
    await this.q(`UPDATE knowledge_documents SET ${sets} WHERE id=$1`, [id, ...cols.map(c => patch[c])]);
    return (await this.q('SELECT * FROM knowledge_documents WHERE id=$1', [id]))[0] || null;
  }
  async listKnowledgeDocuments() {
    return this.q('SELECT * FROM knowledge_documents ORDER BY created_at DESC');
  }
  async deleteKnowledgeDocument(id) { await this.q('DELETE FROM knowledge_documents WHERE id=$1', [id]); }
  async addKnowledgeChunks(chunks) {
    for (const c of chunks) {
      const emb = Array.isArray(c.embedding_json) ? c.embedding_json : null;
      if (this.vectorReady && emb && emb.length === this.vectorDimensions) {
        await this.q(
          `INSERT INTO knowledge_chunks (id, document_id, chunk_index, content, embedding_json, embedding_vec, metadata, created_at)
           VALUES ($1,$2,$3,$4,$5,$6::vector,$7,$8)`,
          [c.id, c.document_id, c.chunk_index, c.content, JSON.stringify(emb), `[${emb.join(',')}]`,
            JSON.stringify(c.metadata || {}), c.created_at]);
      } else {
        await this.q(
          `INSERT INTO knowledge_chunks (id, document_id, chunk_index, content, embedding_json, metadata, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [c.id, c.document_id, c.chunk_index, c.content, c.embedding_json ? JSON.stringify(c.embedding_json) : null,
            JSON.stringify(c.metadata || {}), c.created_at]);
      }
    }
  }
  async listKnowledgeChunks(activeOnly = true) {
    return this.q(
      `SELECT c.*, d.title AS document_title, d.original_name, d.language, d.active
       FROM knowledge_chunks c JOIN knowledge_documents d ON d.id=c.document_id
       ${activeOnly ? 'WHERE d.active = TRUE' : ''}
       ORDER BY d.created_at DESC, c.chunk_index ASC`);
  }

  async searchKnowledgeChunks(queryEmbedding, limit = 40) {
    if (!this.vectorReady || !Array.isArray(queryEmbedding) || queryEmbedding.length !== this.vectorDimensions) return [];
    return this.q(
      `SELECT c.*, d.title AS document_title, d.original_name, d.language, d.active,
              (1 - (c.embedding_vec <=> $1::vector)) AS vector_score
       FROM knowledge_chunks c JOIN knowledge_documents d ON d.id=c.document_id
       WHERE d.active = TRUE AND c.embedding_vec IS NOT NULL
       ORDER BY c.embedding_vec <=> $1::vector
       LIMIT $2`,
      [`[${queryEmbedding.join(',')}]`, limit]);
  }

  // Full backup (binary file contents excluded to keep the export light)
  async dump(includeBinary = false) {
    const out = { exported_at: new Date().toISOString(), storage: 'postgres', includes_binary: !!includeBinary };
    out.users = await this.q('SELECT * FROM users');
    out.workspaces = await this.q('SELECT * FROM workspaces');
    out.files = includeBinary
      ? await this.q("SELECT id, workspace_id, original_name, stored_name, mime_type, size_bytes, uploaded_at, encode(COALESCE(content, file_data), 'base64') AS content_base64 FROM files")
      : await this.q('SELECT id, workspace_id, original_name, stored_name, mime_type, size_bytes, uploaded_at FROM files');
    out.analyses = await this.q('SELECT * FROM analyses');
    out.messages = await this.q('SELECT * FROM messages');
    out.outputs = includeBinary
      ? await this.q("SELECT id, workspace_id, type, format, title, file_name, content, provider, created_at, encode(file_data, 'base64') AS file_data_base64 FROM outputs")
      : await this.q('SELECT id, workspace_id, type, format, title, file_name, content, provider, created_at FROM outputs');
    out.notes = await this.q('SELECT * FROM notes');
    out.logs = await this.q('SELECT * FROM logs');
    out.knowledge_documents = await this.q('SELECT * FROM knowledge_documents');
    out.knowledge_chunks = await this.q('SELECT id, document_id, chunk_index, content, embedding_json, metadata, created_at FROM knowledge_chunks');
    return out;
  }
}

module.exports = PgStore;
