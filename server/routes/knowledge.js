const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuid } = require('uuid');
const config = require('../config');
const store = require('../storage');
const { requireAuth } = require('../middleware/auth');
const { extractText } = require('../services/extract');
const { buildChunks } = require('../services/knowledge');

const router = express.Router();
router.use(requireAuth);

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
};

const kbDir = path.join(config.uploadDir, 'knowledge');
fs.mkdirSync(kbDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, kbDir),
    filename: (req, file, cb) => cb(null, `${uuid()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 10 },
});

router.get('/', requireAdmin, async (req, res) => {
  res.json({ documents: await store.listKnowledgeDocuments() });
});

router.post('/', requireAdmin, upload.array('files', 10), async (req, res) => {
  const docs = [];
  for (const f of req.files || []) {
    const text = await extractText(f.path, f.mimetype, f.originalname);
    const id = uuid();
    const chunks = await buildChunks(id, text);
    const doc = await store.addKnowledgeDocument({
      id,
      title: (req.body.title || f.originalname).trim(),
      original_name: f.originalname,
      stored_name: path.join('knowledge', f.filename),
      mime_type: f.mimetype,
      size_bytes: f.size,
      language: req.body.language || 'auto',
      active: true,
      chunk_count: chunks.length,
      created_by: req.user.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (chunks.length) await store.addKnowledgeChunks(chunks);
    await store.addLog({ id: uuid(), user_id: req.user.id, username: req.user.username, action: 'knowledge_upload', workspace_id: null, detail: `${f.originalname} · ${chunks.length} chunks`, created_at: new Date().toISOString() });
    docs.push(doc);
  }
  res.status(201).json({ documents: docs });
});

router.patch('/:id', requireAdmin, async (req, res) => {
  const doc = await store.updateKnowledgeDocument(req.params.id, { active: req.body.active !== false });
  res.json({ document: doc });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  await store.deleteKnowledgeDocument(req.params.id);
  await store.addLog({ id: uuid(), user_id: req.user.id, username: req.user.username, action: 'knowledge_delete', workspace_id: null, detail: req.params.id, created_at: new Date().toISOString() });
  res.json({ ok: true });
});

module.exports = router;
