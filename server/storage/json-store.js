// Local JSON persistence (used when DATABASE_URL is not set).
const fs = require('fs');
const path = require('path');

class JsonStore {
  constructor(dataFile) {
    this.supportsBinaryStorage = false;
    this.file = dataFile;
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    if (fs.existsSync(dataFile)) {
      try { this.db = JSON.parse(fs.readFileSync(dataFile, 'utf8')); }
      catch { this.db = this._empty(); }
    } else this.db = this._empty();
    for (const k of ['users','workspaces','files','analyses','messages','outputs','notes','logs'])
      if (!Array.isArray(this.db[k])) this.db[k] = [];
  }
  _empty() { return { users: [], workspaces: [], files: [], analyses: [], messages: [], outputs: [], notes: [], logs: [] }; }
  _save() { fs.writeFileSync(this.file, JSON.stringify(this.db, null, 2)); }
  async init() {}

  // Users
  async createUser(u) { this.db.users.push(u); this._save(); return u; }
  async getUserByUsername(username) { return this.db.users.find(u => u.username === username) || null; }
  async getUserById(id) { return this.db.users.find(u => u.id === id) || null; }
  async listUsers() { return [...this.db.users].sort((a, b) => a.username.localeCompare(b.username)); }
  async updateUser(id, patch) {
    const u = this.db.users.find(x => x.id === id); if (!u) return null;
    Object.assign(u, patch); this._save(); return u;
  }
  async deleteUser(id) {
    this.db.users = this.db.users.filter(u => u.id !== id);
    const wsIds = this.db.workspaces.filter(w => w.owner_id === id).map(w => w.id);
    this.db.workspaces = this.db.workspaces.filter(w => w.owner_id !== id);
    this._cascade(wsIds); this._save();
  }
  async countUsers() { return this.db.users.length; }

  // Workspaces
  async createWorkspace(w) { this.db.workspaces.push(w); this._save(); return w; }
  async listWorkspaces(ownerId, includeArchived) {
    return this.db.workspaces
      .filter(w => w.owner_id === ownerId && (includeArchived || w.status !== 'archived'))
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  }
  async getWorkspace(id) { return this.db.workspaces.find(w => w.id === id) || null; }
  async updateWorkspace(id, patch) {
    const w = this.db.workspaces.find(x => x.id === id); if (!w) return null;
    Object.assign(w, patch, { updated_at: new Date().toISOString() }); this._save(); return w;
  }
  async deleteWorkspace(id) {
    this.db.workspaces = this.db.workspaces.filter(w => w.id !== id);
    this._cascade([id]); this._save();
  }
  _cascade(wsIds) {
    const s = new Set(wsIds);
    for (const k of ['files','analyses','messages','outputs','notes'])
      this.db[k] = this.db[k].filter(r => !s.has(r.workspace_id));
  }

  // Files
  async addFile(f) { this.db.files.push(f); this._save(); return f; }
  async listFiles(wsId) { return this.db.files.filter(f => f.workspace_id === wsId); }
  async getFile(id) { return this.db.files.find(f => f.id === id) || null; }
  async deleteFile(id) { this.db.files = this.db.files.filter(f => f.id !== id); this._save(); }

  // Analyses
  async addAnalysis(a) { this.db.analyses.push(a); this._save(); return a; }
  async listAnalyses(wsId) {
    return this.db.analyses.filter(a => a.workspace_id === wsId)
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }

  // Messages
  async addMessage(m) { this.db.messages.push(m); this._save(); return m; }
  async listMessages(wsId) {
    return this.db.messages.filter(m => m.workspace_id === wsId)
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  }

  // Outputs
  async addOutput(o) { this.db.outputs.push(o); this._save(); return o; }
  async listOutputs(wsId) {
    return this.db.outputs.filter(o => o.workspace_id === wsId)
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }
  async getOutput(id) { return this.db.outputs.find(o => o.id === id) || null; }

  // Notes
  async addNote(n) { this.db.notes.push(n); this._save(); return n; }
  async listNotes(wsId) {
    return this.db.notes.filter(n => n.workspace_id === wsId)
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }
  async deleteNote(id) { this.db.notes = this.db.notes.filter(n => n.id !== id); this._save(); }

  // Activity logs
  async addLog(l) { this.db.logs.push(l); if (this.db.logs.length > 5000) this.db.logs = this.db.logs.slice(-4000); this._save(); return l; }
  async listLogs(limit = 300) {
    return [...this.db.logs].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, limit);
  }
}

module.exports = JsonStore;
