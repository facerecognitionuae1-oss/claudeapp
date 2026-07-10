const express = require('express');
const path = require('path');
const { v4: uuid } = require('uuid');
const config = require('../config');
const store = require('../storage');
const { requireAuth, requireWorkspace } = require('../middleware/auth');
const ai = require('../services/ai');
const { baseContext, studioSystem, pptxSystem, infographicSystem, STUDIO_TYPES, detectLang } = require('../services/prompts');
const { buildDeck } = require('../services/pptx');

const router = express.Router({ mergeParams: true });

const logAction = (user, action, wsId, detail) => {
  try {
    store.addLog({ id: require('uuid').v4(), user_id: user.id, username: user.username, action, workspace_id: wsId || null, detail: String(detail || '').slice(0, 400), created_at: new Date().toISOString() });
  } catch {}
};
router.use(requireAuth);

router.get('/types', (req, res) => {
  res.json({
    types: Object.entries(STUDIO_TYPES).map(([id, t]) => ({ id, title: t.title })).concat([{ id: 'pptx', title: 'PowerPoint Briefing Deck' }]),
  });
});

// POST /api/workspaces/:wsId/studio  { type, format?, provider?, model?, instructions?, scope? }
router.post('/', requireWorkspace, async (req, res) => {
  const ws = req.workspace;
  const { type, provider, model } = req.body || {};
  const instructions = (req.body?.instructions || '').trim();
  const focused = req.body?.scope === 'focused' && !!instructions;
  const format = req.body?.format || (type === 'pptx' ? 'pptx' : 'md');
  // Instructions language wins; otherwise workspace language.
  const mode = req.body?.mode || ws.mode;
  const files = await store.listFiles(ws.id);
  const hasFiles = files.length > 0;
  // Q&A transcript is source material too — lets users build decks/documents from a conversation.
  const messages = await store.listMessages(ws.id);
  const convo = messages.slice(-40).map(m => `${m.role === 'user' ? 'EMPLOYEE' : 'ASSISTANT'}: ${m.content}`).join('\n\n');
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  // Live web search runs automatically whenever a search key is configured.
  let webBlock = '';
  {
    const { webSearch, formatSearch, searchConfigured } = require('../services/search');
    if (searchConfigured()) {
      const q = (instructions || ws.brief || ws.title || '').trim().slice(0, 300);
      const found = await webSearch(q);
      webBlock = formatSearch(found, q);
    }
  }
  const context = baseContext(ws, files) + webBlock
    + (convo ? `\n\nCONVERSATION TRANSCRIPT (treat as source material — capture its key questions, answers and conclusions):\n${convo}` : '')
    + (instructions
      ? `\n\nEMPLOYEE ADDITIONAL INSTRUCTIONS (HIGHEST PRIORITY — follow exactly, respond in their language):\n${instructions}`
      : '');

  const language = req.body?.language || detectLang(instructions) || (lastUser ? detectLang(lastUser.content) : null) || ws.language;
  // Claude is recommended for slide structure: prefer it for decks when configured.
  const cfg = require('../config');
  // Presentations & infographics need the strongest design model: always use Claude when configured.
  const useProvider = ((type === 'pptx' || type === 'infographic') && cfg.providers.anthropic.key) ? 'anthropic' : provider;

  if (type === 'pptx') {
    const { manusConfigured, createDeckTask, pollDeck } = require('../services/manus');
    if (manusConfigured()) {
      // Manus generates the complete deck asynchronously (typically 5-15 minutes).
      const deckPrompt = `Create a stunning, modern, professional PowerPoint (.pptx) presentation for an employee of the UAE Federal Authority for Identity, Citizenship, Customs & Port Security (UAEICP). Internal use.

LANGUAGE: the entire deck must be in ${language === 'ar' ? 'Arabic' : 'English'}.
DESIGN: if the material below states design wishes (colors, mood, style), follow them exactly. If the subject is UAEICP/ICP/UAE government identity, use a refined modern UAE federal identity (charcoal, gold B68A35, warm white, restrained flag accents). Otherwise invent a distinctive premium theme. Eye-popping but professional — agency-keynote level.
SPEED: work as fast as possible. ${(hasFiles || context.includes('LIVE WEB SEARCH RESULTS')) ? 'All source material is ALREADY PROVIDED below — do NOT conduct additional web research; go straight to structuring and designing.' : 'Do only brief, focused research on the topic — no deep multi-source investigation.'} Target 10-14 slides unless the employee requests otherwise.
CONTENT: base it on the material below${hasFiles ? '' : ' and your knowledge of the topic'}. ${focused ? 'FOCUSED SCOPE: build ONLY around the points in the employee instructions.' : ''} No citations on content slides; end with a References slide listing sources. Include speaker notes.
DELIVERABLE: the final editable .pptx file.

MATERIAL:
${context.slice(0, 60000)}`;
      const { taskId, taskUrl } = await createDeckTask(deckPrompt, language, `UAEICP deck — ${ws.title}`.slice(0, 80));
      const output = await store.addOutput({
        id: uuid(), workspace_id: ws.id, type: 'pptx', format: 'pptx',
        title: 'Briefing Deck (Manus — generating, 5-15 min…)', file_name: '',
        content: JSON.stringify({ manus_task_id: taskId, manus_task_url: taskUrl, status: 'processing' }),
        provider: 'manus', created_at: new Date().toISOString(),
      });
      pollDeck(taskId, output.id, ws.id);
      logAction(req.user, 'generate', ws.id, 'pptx · manus');
      return res.status(201).json({ output, processing: true });
    }
    const out = await ai.chat({ provider: useProvider, model, system: pptxSystem(language, focused, hasFiles), user: context + '\n\nDesign the briefing deck now.' });
    const spec = ai.parseJson(out.text);
    if (!spec || !Array.isArray(spec.slides))
      return res.status(502).json({ error: 'Model returned an invalid deck specification', raw: out.text.slice(0, 1500) });

    // Optional AI imagery — only when the user explicitly enabled it (uses OpenAI credits).
    const images = {};
    if (req.body?.withImages && cfg.providers.openai.key) {
      const { generateImage } = require('../services/images');
      const styleSuffix = (spec.theme?.image_style ? ` Style: ${spec.theme.image_style}.` : '')
        + ' Ultra-detailed, premium editorial quality, cinematic lighting, professional composition, high-end 3D render aesthetic.';
      const jobs = [];
      if (spec.image) jobs.push(['cover', spec.image]);
      (spec.slides || []).forEach((sl2, i2) => { if (sl2.image && jobs.length < 4) jobs.push(['s' + i2, sl2.image]); });
      const done = await Promise.all(jobs.map(async ([k, p]) => [k, await generateImage(p + styleSuffix)]));
      for (const [k, buf] of done) if (buf) images[k] = buf;
    }

    const fileBase = `deck-${ws.id.slice(0, 8)}-${Date.now()}`;
    const fileName = await buildDeck(spec, fileBase, language === 'ar', images);
    let fileData = null;
    try { fileData = require('fs').readFileSync(path.join(config.generatedDir, fileName)); } catch {}
    const output = await store.addOutput({
      id: uuid(), workspace_id: ws.id, type: 'pptx', format: 'pptx',
      title: spec.title || 'Briefing Deck', file_name: fileName,
      content: JSON.stringify(spec), file_data: fileData,
      provider: out.provider, created_at: new Date().toISOString(),
    });
    logAction(req.user, 'generate', ws.id, `pptx · ${spec.title || ''}`);
    const { file_data, ...pub } = output;
    return res.status(201).json({ output: pub, fallbackError: out.fallbackError });
  }

  if (type === 'infographic') {
    const out = await ai.chat({ provider: useProvider || provider, model, system: infographicSystem(language, focused, hasFiles), user: context + '\n\nDesign the infographic now.' });
    const m = out.text.match(/<svg[\s\S]*<\/svg>/i);
    if (!m) return res.status(502).json({ error: 'Model returned invalid SVG', raw: out.text.slice(0, 1500) });
    const output = await store.addOutput({
      id: uuid(), workspace_id: ws.id, type: 'infographic', format: 'svg',
      title: language === 'ar' ? 'إنفوجرافيك' : 'Infographic', file_name: '',
      content: m[0], provider: out.provider, created_at: new Date().toISOString(),
    });
    logAction(req.user, 'generate', ws.id, 'infographic · svg');
    return res.status(201).json({ output, fallbackError: out.fallbackError });
  }

  const t = STUDIO_TYPES[type];
  if (!t) return res.status(400).json({ error: 'Unknown output type' });
  const out = await ai.chat({ provider: useProvider || provider, model, system: studioSystem(type, mode, language, focused, hasFiles), user: context + '\n\nGenerate the document now.' });

  let content = out.text;
  if (format === 'json') content = JSON.stringify({ type, title: t.title, generated_at: new Date().toISOString(), body_markdown: out.text }, null, 2);
  const output = await store.addOutput({
    id: uuid(), workspace_id: ws.id, type, format,
    title: t.title, file_name: '', content,
    provider: out.provider, created_at: new Date().toISOString(),
  });
  logAction(req.user, 'generate', ws.id, `${type} · ${format}`);
  res.status(201).json({ output, fallbackError: out.fallbackError });
});

// Download a generated output
router.get('/:outputId/download', requireWorkspace, async (req, res) => {
  const o = await store.getOutput(req.params.outputId);
  if (!o || o.workspace_id !== req.workspace.id) return res.status(404).json({ error: 'Output not found' });
  if (o.format === 'pptx') {
    const data = await store.getOutputFile(o.id);
    if (data && data.length) {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.setHeader('Content-Disposition', `attachment; filename="${o.file_name || 'deck.pptx'}"`);
      return res.send(data);
    }
    if (o.file_name) return res.download(path.join(config.generatedDir, o.file_name), o.file_name);
    try {
      const meta = JSON.parse(o.content || '{}');
      if (meta.status === 'processing') return res.status(409).json({ error: 'Manus is still generating this deck (usually 5-15 minutes). Try again shortly.' });
    } catch {}
    return res.status(404).json({ error: 'Deck file not found' });
  }
  const ext = o.format === 'json' ? 'json' : o.format === 'txt' ? 'txt' : o.format === 'svg' ? 'svg' : 'md';
  const mime = o.format === 'json' ? 'application/json' : o.format === 'svg' ? 'image/svg+xml' : 'text/markdown';
  res.setHeader('Content-Type', `${mime}; charset=utf-8`);
  res.setHeader('Content-Disposition', `attachment; filename="${o.type}-${o.id.slice(0, 8)}.${ext}"`);
  res.send(o.content);
});

module.exports = router;
