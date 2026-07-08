const express = require('express');
const { v4: uuid } = require('uuid');
const store = require('../storage');
const { requireAuth, requireWorkspace } = require('../middleware/auth');
const ai = require('../services/ai');
const { baseContext, chatSystem } = require('../services/prompts');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

// POST /api/workspaces/:wsId/chat  { question, provider?, model?, mode?, language? }
router.post('/', requireWorkspace, async (req, res) => {
  const ws = req.workspace;
  const { question, provider, model } = req.body || {};
  if (!question || !question.trim()) return res.status(400).json({ error: 'Question required' });
  const mode = req.body?.mode || ws.mode;
  // Arabic question → Arabic answer, regardless of workspace language.
  const isArabic = /[؀-ۿ]/.test(question);
  const language = req.body?.language || (isArabic ? 'ar' : ws.language);

  const files = await store.listFiles(ws.id);
  const history = (await store.listMessages(ws.id)).slice(-10);
  const historyText = history.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

  const userMsg = await store.addMessage({
    id: uuid(), workspace_id: ws.id, role: 'user', content: question.trim(),
    provider: '', model: '', mode, created_at: new Date().toISOString(),
  });

  const system = chatSystem(mode, language);
  const user = `${baseContext(ws, files)}

RECENT CONVERSATION:
${historyText || '(none)'}

EMPLOYEE QUESTION:
${question.trim()}`;

  const out = await ai.chat({ provider, model, system, user });
  const answer = await store.addMessage({
    id: uuid(), workspace_id: ws.id, role: 'assistant', content: out.text,
    provider: out.provider, model: out.model, mode, created_at: new Date().toISOString(),
  });
  await store.updateWorkspace(ws.id, {});
  res.status(201).json({ question: userMsg, answer, fallbackError: out.fallbackError });
});

module.exports = router;
