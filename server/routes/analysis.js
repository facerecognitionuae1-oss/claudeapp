const express = require('express');
const { v4: uuid } = require('uuid');
const store = require('../storage');
const { requireAuth, requireWorkspace } = require('../middleware/auth');
const ai = require('../services/ai');
const { baseContext, analysisSystem, detectLang } = require('../services/prompts');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

// POST /api/workspaces/:wsId/analysis  { provider?, model?, mode?, language? }
router.post('/', requireWorkspace, async (req, res) => {
  const ws = req.workspace;
  const { provider, model } = req.body || {};
  const mode = req.body?.mode || ws.mode;
  const files = await store.listFiles(ws.id);
  if (!files.length && !(ws.brief || '').trim())
    return res.status(400).json({ error: 'Upload files or write a brief before running analysis' });
  // Brief-only workspaces: follow the brief's language automatically.
  const language = req.body?.language
    || (files.length ? ws.language : (detectLang(ws.brief) || ws.language));

  const system = analysisSystem(mode, language, files.length > 0);
  const user = baseContext(ws, files) + '\n\nRun the full structured review now.';
  const out = await ai.chat({ provider, model, system, user });
  const result = ai.parseJson(out.text);
  if (!result) return res.status(502).json({ error: 'Model returned unparseable output', raw: out.text.slice(0, 2000) });

  const analysis = await store.addAnalysis({
    id: uuid(), workspace_id: ws.id, mode, provider: out.provider, model: out.model,
    result, created_at: new Date().toISOString(),
  });
  await store.updateWorkspace(ws.id, { mode });
  res.status(201).json({ analysis, fallbackError: out.fallbackError });
});

module.exports = router;
