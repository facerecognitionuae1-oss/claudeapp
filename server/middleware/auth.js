const jwt = require('jsonwebtoken');
const config = require('../config');
const store = require('../storage');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (parseCookies(req.headers.cookie || '').auth_token || null);
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = await store.getUserById(payload.sub);
    if (!user || !user.active) return res.status(401).json({ error: 'Account not found or disabled' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// Workspace ownership guard (admins can access all)
async function requireWorkspace(req, res, next) {
  const ws = await store.getWorkspace(req.params.wsId || req.params.id);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (ws.owner_id !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Not your workspace' });
  req.workspace = ws;
  next();
}

function parseCookies(header) {
  return String(header || '').split(';').reduce((out, part) => {
    const idx = part.indexOf('=');
    if (idx > -1) out[decodeURIComponent(part.slice(0, idx).trim())] = decodeURIComponent(part.slice(idx + 1).trim());
    return out;
  }, {});
}

module.exports = { requireAuth, requireAdmin, requireWorkspace };
