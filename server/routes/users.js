const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const store = require('../storage');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const strip = u => { const { password_hash, ...rest } = u; return rest; };

router.get('/', async (req, res) => res.json({ users: (await store.listUsers()).map(strip) }));

router.post('/', async (req, res) => {
  const { username, password, fullName, email, department, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const uname = String(username).trim().toLowerCase();
  if (await store.getUserByUsername(uname)) return res.status(409).json({ error: 'Username already exists' });
  const user = await store.createUser({
    id: uuid(),
    username: uname,
    password_hash: await bcrypt.hash(password, 10),
    full_name: fullName || '',
    email: email || '',
    department: department || '',
    role: role === 'admin' ? 'admin' : 'employee',
    active: true,
    created_at: new Date().toISOString(),
  });
  res.status(201).json({ user: strip(user) });
});

router.patch('/:id', async (req, res) => {
  const target = await store.getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  const patch = {};
  const { fullName, email, department, role, active, password } = req.body || {};
  if (fullName !== undefined) patch.full_name = fullName;
  if (email !== undefined) patch.email = email;
  if (department !== undefined) patch.department = department;
  if (role !== undefined) patch.role = role === 'admin' ? 'admin' : 'employee';
  if (active !== undefined) patch.active = !!active;
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    patch.password_hash = await bcrypt.hash(password, 10);
  }
  if (target.id === req.user.id && patch.role === 'employee')
    return res.status(400).json({ error: 'You cannot demote your own admin account' });
  res.json({ user: strip(await store.updateUser(target.id, patch)) });
});

router.delete('/:id', async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
  await store.deleteUser(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
