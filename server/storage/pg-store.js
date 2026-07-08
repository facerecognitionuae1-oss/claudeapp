// PostgreSQL persistence (used when DATABASE_URL is set).
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

class PgStore {
  constructor(cfg) {
    this.pool = new Pool({
      connectionString: cfg.databaseUrl,
      ssl: cfg.pgSsl ? { rejectUnauthorized: false } : false,
    });
  }
  async init() {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await this.pool.query(schema);
  }
  async q(text, params) { return (await this.pool.query(text, params)).rows; }

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
      `INSERT INTO workspaces (id, owner_id, title, brief, language, mode, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [w.id, w.owner_id, w.title, w.brief, w.language, w.mode, w.status, w.created_at, w.updated_at]);
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
      `INSERT INTO files (id, workspace_id, original_name, stored_name, mime_type, size_bytes, extracted_text, uploaded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [f.id, f.workspace_id, f.original_name, f.stored_name, f.mime_type, f.size_bytes, f.extracted_text, f.uploaded_at]);
    return f;
  }
  async listFiles(wsId) { return this.q('SELECT * FROM files WHERE workspace_id=$1 ORDER BY uploaded_at', [wsId]); }
  async getFile(id) { return (await this.q('SELECT * FROM files WHERE id=$1', [id]))[0] || null; }
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
      `INSERT INTO outputs (id, workspace_id, type, format, title, file_name, content, provider, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [o.id, o.workspace_id, o.type, o.format, o.title, o.file_name, o.content, o.provider, o.created_at]);
    return o;
  }
  async listOutputs(wsId) { return this.q('SELECT * FROM outputs WHERE workspace_id=$1 ORDER BY created_at DESC', [wsId]); }
  async getOutput(id) { return (await this.q('SELECT * FROM outputs WHERE id=$1', [id]))[0] || null; }

  // Notes
  async addNote(n) {
    await this.q(
      `INSERT INTO notes (id, workspace_id, author_id, content, created_at) VALUES ($1,$2,$3,$4,$5)`,
      [n.id, n.workspace_id, n.author_id, n.content, n.created_at]);
    return n;
  }
  async listNotes(wsId) { return this.q('SELECT * FROM notes WHERE workspace_id=$1 ORDER BY created_at DESC', [wsId]); }
  async deleteNote(id) { await this.q('DELETE FROM notes WHERE id=$1', [id]); }
}

module.exports = PgStore;
