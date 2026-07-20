const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const config = require('./config');
const store = require('./storage');
const ai = require('./services/ai');
const { requireAuth } = require('./middleware/auth');
const { makeRateLimit } = require('./middleware/rate-limit');

const app = express();
if (config.trustProxy) app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use('/api/auth/login', makeRateLimit({ windowMs: config.rateLimit.authWindowMs, max: config.rateLimit.authMax, keyPrefix: 'auth:' }));
app.use('/api', makeRateLimit({ windowMs: config.rateLimit.apiWindowMs, max: config.rateLimit.apiMax, keyPrefix: 'api:' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true, storage: config.databaseUrl ? 'postgres' : 'json' }));
app.get('/api/providers', requireAuth, (req, res) => res.json({ providers: ai.listProviders(), search: require('./services/search').searchConfigured() }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/knowledge', require('./routes/knowledge'));
app.use('/api/workspaces', require('./routes/workspaces'));
app.use('/api/workspaces/:wsId/files', require('./routes/files'));
app.use('/api/workspaces/:wsId/analysis', require('./routes/analysis'));
app.use('/api/workspaces/:wsId/chat', require('./routes/chat'));
app.use('/api/workspaces/:wsId/studio', require('./routes/studio'));

// SPA fallback — only for page routes; real file paths (with an extension) that
// weren't found by express.static must 404, not return index.html.
app.get(/^\/(?!api\/).*/, (req, res, next) => {
  if (req.path.includes('.')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File too large (max ${config.maxUploadMb} MB)` });
  res.status(500).json({ error: 'Internal server error' });
});

async function seedAdmin() {
  if ((await store.countUsers()) > 0) return;
  await store.createUser({
    id: uuid(),
    username: config.adminUsername.toLowerCase(),
    password_hash: await bcrypt.hash(config.adminPassword, 10),
    full_name: 'System Administrator',
    email: '', department: 'IT',
    role: 'admin', active: true,
    created_at: new Date().toISOString(),
  });
  console.log(`[seed] Admin account created: ${config.adminUsername} (change the password after first login)`);
}

(async () => {
  if (config.jwtSecret === 'dev-secret-change-me')
    console.warn('[security] JWT_SECRET is using the development default. Set a long random JWT_SECRET before production use.');
  if (config.adminPassword === 'Admin@1234')
    console.warn('[security] ADMIN_PASSWORD is using the development default. Change the admin password immediately.');
  await store.init();
  await seedAdmin();
  app.listen(config.port, () =>
    console.log(`UAEICP Employee Intelligence Workspace running on http://localhost:${config.port}`));
})().catch(err => { console.error('Startup failed:', err); process.exit(1); });
