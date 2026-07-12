const express = require('express');
const path = require('path');
const { v4: uuid } = require('uuid');
const config = require('../config');
const store = require('../storage');
const { requireAuth, requireWorkspace } = require('../middleware/auth');
const ai = require('../services/ai');
const { baseContext, studioSystem, pptxSystem, infographicSystem, contentPlanSystem, deckArtSystem, STUDIO_TYPES, detectLang } = require('../services/prompts');
const { buildDeck } = require('../services/pptx');

const REF_PDF = path.join(__dirname, '..', 'reference', 'deck-reference.pdf');
const REF_PAGES_DIR = path.join(__dirname, '..', 'reference', 'pages');
function loadReferencePages(max = 3) {
  try {
    const fsx = require('fs');
    return fsx.readdirSync(REF_PAGES_DIR).filter(f => /\.(jpe?g|png)$/i.test(f)).sort().slice(0, max)
      .map(f => ({ data: fsx.readFileSync(path.join(REF_PAGES_DIR, f)).toString('base64'), media_type: f.endsWith('.png') ? 'image/png' : 'image/jpeg' }));
  } catch { return []; }
}

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
    const { skyworkConfigured, generatePpt } = require('../services/skywork');
    const useManus = manusConfigured();
    // Engine preference: PPT_ENGINE env forces one; otherwise Skywork > Manus > Claude.
    const forced = config.pptEngine;
    const engine = (forced === 'skywork' && skyworkConfigured()) ? 'skywork'
      : (forced === 'manus' && useManus) ? 'manus'
      : (forced === 'claude') ? 'claude'
      : skyworkConfigured() ? 'skywork' : useManus ? 'manus' : 'claude';
    const pipeLabel = engine === 'skywork' ? 'GPT+Claude+Skywork' : engine === 'manus' ? 'GPT+Claude+Manus' : 'GPT+Claude';

    // Respond IMMEDIATELY — the multi-AI pipeline runs in the background so nothing can time out.
    const output = await store.addOutput({
      id: uuid(), workspace_id: ws.id, type: 'pptx', format: 'pptx',
      title: `Briefing Deck (${pipeLabel} — generating…)`, file_name: '',
      content: JSON.stringify({ status: 'processing', pipeline: pipeLabel }),
      provider: pipeLabel, created_at: new Date().toISOString(),
    });
    logAction(req.user, 'generate', ws.id, 'pptx · ' + pipeLabel.toLowerCase());
    res.status(201).json({ output, processing: true });

    setImmediate(async () => {
      try {
        // Stage 1 (GPT): content architecture. Stage 2 (Claude): art direction.
        const contentProvider = cfg.providers.openai.key ? 'openai' : (cfg.providers.anthropic.key ? 'anthropic' : provider);
        const designProvider = cfg.providers.anthropic.key ? 'anthropic' : contentProvider;
        const plan = await ai.chat({
          provider: contentProvider,
          system: contentPlanSystem(language, focused, hasFiles, 'deck'),
          user: context.slice(0, 90000) + '\n\nWrite the slide-by-slide content plan now.',
        });
        const refPages = designProvider === 'anthropic' ? loadReferencePages(3) : [];
        const art = await ai.chat({
          provider: designProvider,
          system: deckArtSystem(language),
          images: refPages,
          user: (refPages.length ? 'The attached images are slides from a REFERENCE deck. They are a CRAFT BENCHMARK ONLY: match their level of finish, density, layering and typographic care — do NOT copy their topic, text, colors or layouts.\n\n' : '')
            + 'CONTENT PLAN:\n' + plan.text.slice(0, 25000) + '\n\nSOURCE MATERIAL EXCERPT:\n' + context.slice(0, 25000) + '\n\nWrite the complete art direction now.',
        });
        const pipelineBrief = 'SLIDE-BY-SLIDE CONTENT PLAN (follow exactly):\n' + plan.text.slice(0, 25000)
          + '\n\nART DIRECTION (follow exactly):\n' + art.text.slice(0, 25000);

        // Stage 3 — production. Use Skywork only when selected, then fall through on failure.
        if (engine === 'skywork') {
          try {
            const skQuery = `Create a stunning, premium, agency-keynote-quality PowerPoint presentation in ${language === 'ar' ? 'Arabic' : 'English'} (12+ slides). Every slide fully designed: rich layouts, imagery, icons, stat callouts — dense and polished, never sparse. End with a References slide listing sources. ${focused ? 'Cover ONLY the points in the slide plan.' : ''}

SLIDE-BY-SLIDE PLAN (follow exactly):
${plan.text.slice(0, 3600)}

STYLE DIRECTION:
${art.text.slice(0, 1500)}`;
            const { buf } = await generatePpt(skQuery);
            const fileName = `deck-${ws.id.slice(0, 8)}-${Date.now()}.pptx`;
            try { require('fs').writeFileSync(path.join(config.generatedDir, fileName), buf); } catch {}
            await store.updateOutput(output.id, {
              title: 'Briefing Deck', file_name: fileName,
              content: JSON.stringify({ engine: 'skywork', status: 'done' }), file_data: buf,
            });
            console.log('[pipeline] Skywork deck ready:', output.id);
            return;
          } catch (e) {
            console.warn('[pipeline] Skywork failed, falling back:', e.message);
            if (!useManus && !cfg.providers.anthropic.key) throw e;
          }
        }

        if (useManus && engine !== 'claude') {
          // Stage 3a (Manus): full production from the pre-made briefs.
          const deckPrompt = `You are the PRODUCTION stage of a three-AI pipeline. A content strategist and an art director have already done their work below. EXECUTE their plan and art direction EXACTLY — every slide, every fact, the palette, typography, motifs and per-slide imagery. Do not redesign; realize their vision at the highest possible craft: cinematic full-bleed backgrounds, layered panels with elegant frames, glowing iconography, perfect visual hierarchy. Every slide fully designed with imagery — nothing plain.

LANGUAGE: the entire deck must be in ${language === 'ar' ? 'Arabic' : 'English'}.
SPEED: all research and design decisions are already made below — do NOT conduct web research; go straight to production.
DELIVERABLE: the final editable .pptx file, with speaker notes, ending with a References slide.

${pipelineBrief}

SOURCE MATERIAL (for fact checking only):
${context.slice(0, 40000)}`;
          // Attach the style-reference PDF (craft benchmark, not source material)
          let refIds = [];
          try {
            const fsx = require('fs');
            if (fsx.existsSync(REF_PDF)) {
              const { uploadFile } = require('../services/manus');
              refIds = [await uploadFile(fsx.readFileSync(REF_PDF), 'style-reference.pdf')];
            }
          } catch (e) { console.warn('[pipeline] reference upload failed:', e.message); }
          const finalPrompt = refIds.length
            ? deckPrompt + '\n\nSTYLE REFERENCE: the attached PDF shows the REQUIRED level of craft — density, layered composition, framed panels, iconography, typographic care, overall finish. Match that LEVEL. Do NOT copy its topic, text, colors or exact layouts; this deck has its own subject and its own theme from the art direction above.'
            : deckPrompt;
          const { taskId, taskUrl } = await createDeckTask(finalPrompt, language, ('UAEICP deck — ' + ws.title).slice(0, 80), refIds);
          await store.updateOutput(output.id, {
            content: JSON.stringify({ status: 'processing', pipeline: pipeLabel, manus_task_id: taskId, manus_task_url: taskUrl }),
          });
          pollDeck(taskId, output.id, ws.id);
          return;
        }

        // Stage 3b (Claude + renderer): execute the briefs with always-on imagery.
        const execProvider = cfg.providers.anthropic.key ? 'anthropic' : contentProvider;
        const out = await ai.chat({
          provider: execProvider, model,
          system: pptxSystem(language, focused, hasFiles),
          user: pipelineBrief + '\n\nSOURCE MATERIAL:\n' + context.slice(0, 30000) + '\n\nBuild the deck JSON now, following the plan and art direction exactly.',
        });
        const spec = ai.parseJson(out.text);
        if (!spec || !Array.isArray(spec.slides)) throw new Error('deck specification unparseable');

        const images = {};
        if (cfg.providers.openai.key) {
          const { generateImage } = require('../services/images');
          const styleSuffix = (spec.theme?.image_style ? ` Style: ${spec.theme.image_style}.` : '')
            + ' Ultra-detailed, premium editorial quality, cinematic lighting, layered depth, professional composition.';
          const jobs = [];
          if (spec.image) jobs.push(['cover', spec.image]);
          (spec.slides || []).forEach((sl2, i2) => { if (sl2.image && jobs.length < 6) jobs.push(['s' + i2, sl2.image]); });
          const done = await Promise.all(jobs.map(async ([k, p]) => [k, await generateImage(p + styleSuffix)]));
          for (const [k, buf] of done) if (buf) images[k] = buf;
        }

        const fileBase = `deck-${ws.id.slice(0, 8)}-${Date.now()}`;
        const fileName = await buildDeck(spec, fileBase, language === 'ar', images);
        let fileData = null;
        try { fileData = require('fs').readFileSync(path.join(config.generatedDir, fileName)); } catch {}
        await store.updateOutput(output.id, {
          title: spec.title || 'Briefing Deck', file_name: fileName,
          content: JSON.stringify(spec), file_data: fileData,
        });
        console.log('[pipeline] deck ready:', output.id);
      } catch (err) {
        console.warn('[pipeline] failed:', err.message);
        await store.updateOutput(output.id, {
          title: 'Briefing Deck — pipeline failed: ' + String(err.message).slice(0, 90),
          content: JSON.stringify({ status: 'error' }),
        }).catch(() => {});
      }
    });
    return;
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
  let o = await store.getOutput(req.params.outputId);
  if (!o || o.workspace_id !== req.workspace.id) return res.status(404).json({ error: 'Output not found' });
  if (o.format === 'pptx') {
    try {
      const meta = JSON.parse(o.content || '{}');
      if (meta.manus_task_id && !o.file_name) {
        const { refreshManusOutput } = require('../services/manus');
        o = await refreshManusOutput(o);
      }
    } catch (err) {
      if (err.message) return res.status(502).json({ error: `Could not refresh Manus output: ${err.message}` });
    }
    const data = await store.getOutputFile(o.id);
    if (data && data.length) {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.setHeader('Content-Disposition', `attachment; filename="${o.file_name || 'deck.pptx'}"`);
      return res.send(data);
    }
    if (o.file_name) return res.download(path.join(config.generatedDir, o.file_name), o.file_name);
    try {
      const meta = JSON.parse(o.content || '{}');
      if (meta.manus_task_id) {
        // On-demand recovery: ask Manus right now and grab the deck if it's finished.
        const { fetchDeckNow } = require('../services/manus');
        const chk = await fetchDeckNow(meta.manus_task_id).catch(() => null);
        if (chk && chk.status === 'ready' && chk.buf) {
          await store.updateOutput(o.id, {
            title: 'Briefing Deck', file_name: chk.name,
            file_data: chk.buf, content: JSON.stringify({ ...meta, status: 'done' }),
          });
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
          res.setHeader('Content-Disposition', `attachment; filename="${chk.name}"`);
          return res.send(chk.buf);
        }
        if (chk && (chk.status === 'running' || chk.status === 'waiting'))
          return res.status(409).json({ error: 'Still generating — try again in a few minutes.' });
        return res.status(409).json({ error: 'Not ready yet — try again shortly.' });
      }
      if (meta.status === 'processing') return res.status(409).json({ error: 'The deck is still being generated — try again shortly.' });
    } catch (e) { if (e && e.statusSent) throw e; }
    return res.status(404).json({ error: 'Deck file not found' });
  }
  const ext = o.format === 'json' ? 'json' : o.format === 'txt' ? 'txt' : o.format === 'svg' ? 'svg' : 'md';
  const mime = o.format === 'json' ? 'application/json' : o.format === 'svg' ? 'image/svg+xml' : 'text/markdown';
  res.setHeader('Content-Type', `${mime}; charset=utf-8`);
  res.setHeader('Content-Disposition', `attachment; filename="${o.type}-${o.id.slice(0, 8)}.${ext}"`);
  res.send(o.content);
});

module.exports = router;
