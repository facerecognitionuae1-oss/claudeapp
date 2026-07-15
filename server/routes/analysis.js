const express = require('express');
const { v4: uuid } = require('uuid');
const store = require('../storage');
const { requireAuth, requireWorkspace } = require('../middleware/auth');
const ai = require('../services/ai');
const { baseContext, analysisSystem, detectLang } = require('../services/prompts');

const router = express.Router({ mergeParams: true });

const logAction = (user, action, wsId, detail) => {
  try {
    store.addLog({ id: require('uuid').v4(), user_id: user.id, username: user.username, action, workspace_id: wsId || null, detail: String(detail || '').slice(0, 400), created_at: new Date().toISOString() });
  } catch {}
};
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

  // Live web search runs automatically whenever a search key is configured.
  let webBlock = '';
  if (req.body?.web === true) {
    const { webSearch, formatSearch, searchConfigured } = require('../services/search');
    if (searchConfigured()) {
      const q = (ws.brief || '').trim().slice(0, 300) || ws.title;
      const found = await webSearch(q);
      webBlock = formatSearch(found, q, language);
    }
  }
  const kbQuery = [ws.title, ws.brief, files.map(f => f.original_name).join(' ')].filter(Boolean).join('\n').slice(0, 1000);
  const kb = await require('../services/knowledge').retrieve(kbQuery, 6);
  const system = analysisSystem(mode, language, files.length > 0);
  const user = baseContext(ws, files) + kb.block + webBlock + '\n\nRun the full structured review now.';
  const out = await ai.chat({ provider, model, system, user });
  const result = ai.parseJson(out.text);
  if (!result) return res.status(502).json({ error: 'Model returned unparseable output', raw: out.text.slice(0, 2000) });

  const analysis = await store.addAnalysis({
    id: uuid(), workspace_id: ws.id, mode, provider: out.provider, model: out.model,
    result, created_at: new Date().toISOString(),
  });
  await store.updateWorkspace(ws.id, { mode });
  logAction(req.user, 'analysis', ws.id, `${mode} · ${out.provider} · ${ws.title}`);
  res.status(201).json({ analysis, fallbackError: out.fallbackError });
});

module.exports = router;
