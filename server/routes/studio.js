const express = require('express');
const path = require('path');
const { v4: uuid } = require('uuid');
const config = require('../config');
const store = require('../storage');
const { requireAuth, requireWorkspace } = require('../middleware/auth');
const ai = require('../services/ai');
const { baseContext, studioSystem, pptxSystem, STUDIO_TYPES } = require('../services/prompts');
const { buildDeck } = require('../services/pptx');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

router.get('/types', (req, res) => {
  res.json({
    types: Object.entries(STUDIO_TYPES).map(([id, t]) => ({ id, title: t.title })).concat([{ id: 'pptx', title: 'PowerPoint Briefing Deck' }]),
  });
});

// POST /api/workspaces/:wsId/studio  { type, format?, provider?, model?, instructions? }
router.post('/', requireWorkspace, async (req, res) => {
  const ws = req.workspace;
  const { type, provider, model, instructions } = req.body || {};
  const format = req.body?.format || (type === 'pptx' ? 'pptx' : 'md');
  const language = req.body?.language || ws.language;
  const mode = req.body?.mode || ws.mode;
  const files = await store.listFiles(ws.id);
  const context = baseContext(ws, files) + (instructions ? `\n\nADDITIONAL INSTRUCTIONS FROM EMPLOYEE:\n${instructions}` : '');

  if (type === 'pptx') {
    const out = await ai.chat({ provider, model, system: pptxSystem(language), user: context + '\n\nDesign the briefing deck now.' });
    const spec = ai.parseJson(out.text);
    if (!spec || !Array.isArray(spec.slides))
      return res.status(502).json({ error: 'Model returned an invalid deck specification', raw: out.text.slice(0, 1500) });
    const fileBase = `deck-${ws.id.slice(0, 8)}-${Date.now()}`;
    const fileName = await buildDeck(spec, fileBase, language === 'ar');
    const output = await store.addOutput({
      id: uuid(), workspace_id: ws.id, type: 'pptx', format: 'pptx',
      title: spec.title || 'Briefing Deck', file_name: fileName,
      content: JSON.stringify(spec), provider: out.provider, created_at: new Date().toISOString(),
    });
    return res.status(201).json({ output, fallbackError: out.fallbackError });
  }

  const t = STUDIO_TYPES[type];
  if (!t) return res.status(400).json({ error: 'Unknown output type' });
  const out = await ai.chat({ provider, model, system: studioSystem(type, mode, language), user: context + '\n\nGenerate the document now.' });

  let content = out.text;
  if (format === 'json') content = JSON.stringify({ type, title: t.title, generated_at: new Date().toISOString(), body_markdown: out.text }, null, 2);
  const output = await store.addOutput({
    id: uuid(), workspace_id: ws.id, type, format,
    title: t.title, file_name: '', content,
    provider: out.provider, created_at: new Date().toISOString(),
  });
  res.status(201).json({ output, fallbackError: out.fallbackError });
});

// Download a generated output
router.get('/:outputId/download', requireWorkspace, async (req, res) => {
  const o = await store.getOutput(req.params.outputId);
  if (!o || o.workspace_id !== req.workspace.id) return res.status(404).json({ error: 'Output not found' });
  if (o.format === 'pptx' && o.file_name)
    return res.download(path.join(config.generatedDir, o.file_name), o.file_name);
  const ext = o.format === 'json' ? 'json' : o.format === 'txt' ? 'txt' : 'md';
  const mime = o.format === 'json' ? 'application/json' : 'text/markdown';
  res.setHeader('Content-Type', `${mime}; charset=utf-8`);
  res.setHeader('Content-Disposition', `attachment; filename="${o.type}-${o.id.slice(0, 8)}.${ext}"`);
  res.send(o.content);
});

module.exports = router;
