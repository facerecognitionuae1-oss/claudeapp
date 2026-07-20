const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const store = require('../storage');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const logAction = (user, action, wsId, detail) => {
  try {
    store.addLog({ id: require('uuid').v4(), user_id: user.id, username: user.username, action, workspace_id: wsId || null, detail: String(detail || '').slice(0, 400), created_at: new Date().toISOString() });
  } catch {}
};

function publicUser(u) {
  const { password_hash, ...rest } = u;
  return rest;
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = await store.getUserByUsername(String(username).trim().toLowerCase());
  if (!user || !user.active) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: '12h' });
  logAction(user, 'login', null, '');
  if (config.authCookie) {
    res.cookie('auth_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.nodeEnv === 'production',
      maxAge: 12 * 60 * 60 * 1000,
    });
  }
  res.json({ token, user: publicUser(user) });
});

router.post('/logout', requireAuth, (req, res) => {
  if (config.authCookie) res.clearCookie('auth_token');
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const ok = await bcrypt.compare(currentPassword || '', req.user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Current password incorrect' });
  await store.updateUser(req.user.id, { password_hash: await bcrypt.hash(newPassword, 10) });
  res.json({ ok: true });
});

module.exports = router;
