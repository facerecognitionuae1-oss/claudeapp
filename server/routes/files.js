const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuid } = require('uuid');
const config = require('../config');
const store = require('../storage');
const { requireAuth, requireWorkspace } = require('../middleware/auth');
const { extractText } = require('../services/extract');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

fs.mkdirSync(config.uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.uploadDir),
    filename: (req, file, cb) => cb(null, `${uuid()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 20 },
});

// POST /api/workspaces/:wsId/files  (multipart, field "files")
router.post('/', requireWorkspace, upload.array('files', 20), async (req, res) => {
  const saved = [];
  for (const f of req.files || []) {
    const text = await extractText(f.path, f.mimetype, f.originalname);
    let content = null;
    try { content = fs.readFileSync(f.path); } catch {}
    const rec = await store.addFile({
      id: uuid(), workspace_id: req.workspace.id,
      original_name: f.originalname, stored_name: f.filename,
      mime_type: f.mimetype, size_bytes: f.size,
      extracted_text: text, content, uploaded_at: new Date().toISOString(),
    });
    const { extracted_text, content: _content, file_data, ...pub } = rec;
    saved.push({ ...pub, has_text: !!(text || '').trim() });
  }
  await store.updateWorkspace(req.workspace.id, {});
  res.status(201).json({ files: saved });
});

router.delete('/:fileId', requireWorkspace, async (req, res) => {
  const f = await store.getFile(req.params.fileId);
  if (f && f.workspace_id === req.workspace.id) {
    try { fs.unlinkSync(path.join(config.uploadDir, f.stored_name)); } catch {}
    await store.deleteFile(f.id);
  }
  res.json({ ok: true });
});

router.get('/:fileId/download', requireWorkspace, async (req, res) => {
  const f = await store.getFile(req.params.fileId);
  if (!f || f.workspace_id !== req.workspace.id) return res.status(404).json({ error: 'File not found' });
  // Prefer database copy (survives redeploys); fall back to disk.
  const data = await store.getFileContent(f.id);
  if (data && data.length) {
    res.setHeader('Content-Type', f.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
    return res.send(data);
  }
  res.download(path.join(config.uploadDir, f.stored_name), f.original_name);
});

module.exports = router;
