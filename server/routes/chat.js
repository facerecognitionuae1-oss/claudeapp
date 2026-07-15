const express = require('express');
const { v4: uuid } = require('uuid');
const store = require('../storage');
const { requireAuth, requireWorkspace } = require('../middleware/auth');
const ai = require('../services/ai');
const { baseContext, chatSystem, detectLang } = require('../services/prompts');

const router = express.Router({ mergeParams: true });

const logAction = (user, action, wsId, detail) => {
  try {
    store.addLog({ id: require('uuid').v4(), user_id: user.id, username: user.username, action, workspace_id: wsId || null, detail: String(detail || '').slice(0, 400), created_at: new Date().toISOString() });
  } catch {}
};
router.use(requireAuth);

// POST /api/workspaces/:wsId/chat  { question, provider?, model?, mode?, language? }
router.post('/', requireWorkspace, async (req, res) => {
  const ws = req.workspace;
  const { question, provider, model } = req.body || {};
  if (!question || !question.trim()) return res.status(400).json({ error: 'Question required' });
  const mode = req.body?.mode || ws.mode;
  // The question's own language always wins: Arabic question → Arabic answer, anywhere.
  const language = req.body?.language || detectLang(question) || ws.language;

  const files = await store.listFiles(ws.id);
  const history = (await store.listMessages(ws.id)).slice(-6);
  const historyText = history.map(m => `${m.role.toUpperCase()}: ${String(m.content || '').slice(0, 700)}`).join('\n\n');

  const userMsg = await store.addMessage({
    id: uuid(), workspace_id: ws.id, role: 'user', content: question.trim(),
    provider: '', model: '', mode, created_at: new Date().toISOString(),
  });

  // Live web search runs only when the employee enables the composer globe.
  let webBlock = '';
  if (req.body?.web === true) {
    const { webSearch, formatSearch, searchConfigured } = require('../services/search');
    if (searchConfigured()) {
      const found = await webSearch(question.trim());
      webBlock = formatSearch(found, question.trim(), language);
    }
  }
  const system = chatSystem(mode, language, files.length > 0);
  const user = `${baseContext(ws, files, 2500, 9000)}${webBlock}

RECENT CONVERSATION:
${historyText || '(none)'}

EMPLOYEE QUESTION (answer in this question's language):
${question.trim()}`;

  if (req.body?.stream === true) {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    const write = obj => res.write(JSON.stringify(obj) + '\n');
    try {
      const out = await ai.stream({
        provider, model, system, user,
        onDelta: delta => write({ type: 'delta', delta }),
      });
      const answer = await store.addMessage({
        id: uuid(), workspace_id: ws.id, role: 'assistant', content: out.text,
        provider: out.provider, model: out.model, mode, created_at: new Date().toISOString(),
      });
      await store.updateWorkspace(ws.id, {});
      logAction(req.user, 'question', ws.id, (webBlock ? '[web] ' : '') + question.trim());
      write({ type: 'done', answer, fallbackError: out.fallbackError || '' });
    } catch (err) {
      write({ type: 'error', error: err.message || 'Chat failed' });
    }
    return res.end();
  }

  const out = await ai.chat({ provider, model, system, user });
  const answer = await store.addMessage({
    id: uuid(), workspace_id: ws.id, role: 'assistant', content: out.text,
    provider: out.provider, model: out.model, mode, created_at: new Date().toISOString(),
  });
  await store.updateWorkspace(ws.id, {});
  logAction(req.user, 'question', ws.id, (webBlock ? '[web] ' : '') + question.trim());
  res.status(201).json({ question: userMsg, answer, fallbackError: out.fallbackError });
});

module.exports = router;
