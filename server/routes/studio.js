const express = require('express');
const path = require('path');
const { v4: uuid } = require('uuid');
const config = require('../config');
const store = require('../storage');
const { requireAuth, requireWorkspace } = require('../middleware/auth');
const ai = require('../services/ai');
const { baseContext, studioSystem, pptxSystem, infographicSystem, contentPlanSystem, deckArtSystem, arabicSlideQualityRule, STUDIO_TYPES, detectLang } = require('../services/prompts');
const { buildDeck, sanitizePptxArabicBuffer } = require('../services/pptx');

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
const titleText = (language, en, ar) => language === 'ar' ? ar : en;
const compactTitle = s => String(s || '').replace(/\s+/g, ' ').replace(/[^\p{L}\p{N}\s&()_\-–—:،]/gu, '').trim();
const isGenericDeckTitle = s => /^(briefing deck|powerpoint briefing deck|deck|presentation|عرض تقديمي|عرض)$/i.test(compactTitle(s));
const deckTitleFromRequest = (language, instructions, ws, lastUser) => {
  const source = compactTitle(instructions || lastUser?.content || ws.brief || ws.title);
  if (!source) return titleText(language, 'Briefing Deck', 'عرض تقديمي');
  const clipped = source.length > 58 ? source.slice(0, 58).trim() + '…' : source;
  return language === 'ar' ? `عرض: ${clipped}` : `${clipped} Deck`;
};
const safeFileBase = s => {
  const base = compactTitle(s)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return base || 'deck';
};
const deckFileBase = (title, ws) => `${safeFileBase(title)}-${ws.id.slice(0, 8)}-${Date.now()}`;
const attachmentHeader = (name, fallback = 'download') => {
  const clean = String(name || fallback).replace(/[\r\n]/g, ' ').trim() || fallback;
  const ascii = clean.replace(/[^\x20-\x7E]/g, '_').replace(/["\\;]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
};
const studioTitle = (type, language) => {
  if (language !== 'ar') return STUDIO_TYPES[type]?.title || type;
  return {
    memo: 'مذكرة داخلية',
    checklist: 'قائمة تحقق للخدمة',
    case_summary: 'ملخص الحالة',
    policy_comparison: 'مقارنة السياسات',
    legal_review: 'مذكرة مراجعة قانونية وامتثال',
    revised_draft: 'مسودة منقحة',
    report: 'تقرير تحليل',
  }[type] || STUDIO_TYPES[type]?.title || type;
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
  const language = req.body?.language || detectLang(instructions) || (lastUser ? detectLang(lastUser.content) : null) || ws.language;
  const loadWebBlock = async () => {
    const { webSearch, formatSearch, searchConfigured } = require('../services/search');
    if (!searchConfigured()) return '';
    const q = (instructions || ws.brief || ws.title || '').trim().slice(0, 300);
    const found = await webSearch(q);
    return formatSearch(found, q, language);
  };
  // Keep normal Studio web-enhancement behind the globe. PPT fetches current
  // web context later in the background so the UI gets an immediate response.
  const webBlock = (req.body?.web === true && type !== 'pptx') ? await loadWebBlock() : '';
  const kbQuery = [instructions, ws.title, ws.brief, lastUser?.content, files.map(f => f.original_name).join(' ')].filter(Boolean).join('\n').slice(0, 1600);
  const kb = await require('../services/knowledge').retrieve(kbQuery, 8);
  const context = baseContext(ws, files) + kb.block + webBlock
    + (convo ? `\n\nCONVERSATION TRANSCRIPT (treat as source material — capture its key questions, answers and conclusions):\n${convo}` : '')
    + (instructions
      ? `\n\nEMPLOYEE ADDITIONAL INSTRUCTIONS (HIGHEST PRIORITY — follow exactly, respond in their language):\n${instructions}`
      : '');

  // Claude is recommended for slide structure: prefer it for decks when configured.
  const cfg = require('../config');
  // Presentations & infographics need the strongest design model: always use Claude when configured.
  const useProvider = ((type === 'pptx' || type === 'infographic') && cfg.providers.anthropic.key) ? 'anthropic' : provider;

  if (type === 'pptx') {
    const { manusConfigured, createDeckTask, pollDeck } = require('../services/manus');
    const { skyworkConfigured, generatePpt } = require('../services/skywork');
    const useManus = manusConfigured();
    // Engine preference: PPT_ENGINE env forces one; otherwise Skywork > Manus > Claude.
    const forced = (process.env.PPT_ENGINE || '').toLowerCase();
    const engine = (forced === 'skywork' && skyworkConfigured()) ? 'skywork'
      : (forced === 'manus' && useManus) ? 'manus'
      : (forced === 'claude') ? 'claude'
      : skyworkConfigured() ? 'skywork' : useManus ? 'manus' : 'claude';
    const pipeLabel = engine === 'skywork' ? 'GPT+Claude+Skywork' : engine === 'manus' ? 'GPT+Claude+Manus' : 'GPT+Claude';
    const requestedDeckTitle = deckTitleFromRequest(language, instructions, ws, lastUser);

    // Respond IMMEDIATELY — the multi-AI pipeline runs in the background so nothing can time out.
    const output = await store.addOutput({
      id: uuid(), workspace_id: ws.id, type: 'pptx', format: 'pptx',
      title: `${requestedDeckTitle} (${pipeLabel} — ${titleText(language, 'generating…', 'قيد الإنشاء…')})`, file_name: '',
      content: JSON.stringify({ status: 'processing', pipeline: pipeLabel }),
      provider: pipeLabel, created_at: new Date().toISOString(),
    });
    logAction(req.user, 'generate', ws.id, 'pptx · ' + pipeLabel.toLowerCase());
    res.status(201).json({ output, processing: true });

    setImmediate(async () => {
      try {
        let deckContext = context;
        try {
          const liveBlock = await loadWebBlock();
          if (liveBlock) deckContext += liveBlock;
        } catch (e) {
          console.warn('[pipeline] web context skipped:', e.message);
        }
        // Stage 1 (GPT): content architecture. Stage 2 (Claude): art direction.
        const contentProvider = cfg.providers.openai.key ? 'openai' : (cfg.providers.anthropic.key ? 'anthropic' : provider);
        const designProvider = cfg.providers.anthropic.key ? 'anthropic' : contentProvider;
        const plan = await ai.chat({
          provider: contentProvider,
          system: contentPlanSystem(language, focused, hasFiles, 'deck'),
          user: deckContext.slice(0, 90000) + '\n\nWrite the slide-by-slide content plan now.',
        });
        // Stage 3 — production. Try Skywork first when selected; fall through on failure.
        // Skywork gets the employee's request as-is plus researched facts — full creative
        // freedom over structure, design, layout and slide count.
        if (engine === 'skywork') {
          try {
            const skLang = language === 'ar' ? 'Arabic' : 'English';
            const rtlRule = language === 'ar'
              ? 'ARABIC FINAL TEXT QA: no harakat/tashkeel; clean RTL Arabic; short readable phrases; keep UAEICP/ICP as standalone acronyms only.'
              : '';
            const visualMandate = `Create a premium, image-rich 16:9 PowerPoint deck in ${skLang}. Use high-end generated visuals or designed illustrations on every substantive slide: hero devices, government service interfaces, abstract security/data networks, UAE identity motifs, layered icon cards, and cinematic backgrounds. Balance information and visuals: not sparse, not cramped. For Arabic, use simple clean Modern Standard Arabic, no harakat/tashkeel, no decorative Arabic marks, no broken mixed-direction phrases, and no overlapping text.`;
            const skQuery = `${(instructions || ws.brief || ws.title || 'Briefing deck').trim().slice(0, 1200)} — ${visualMandate}${focused ? ' Cover only the points requested above.' : ''}`;
            const skReference = 'VISUAL QUALITY TARGET:\nMatch the polished image-rich style of a premium Skywork presentation: large generated hero visual, dark refined panels, gold/accent icon cards, clean readable typography, and purposeful slide composition.\n\nBACKGROUND RESEARCH (use freely for facts and data — structure and design are entirely up to you):\n' + plan.text.slice(0, 28000)
              + '\n\nSOURCE MATERIAL:\n' + deckContext.slice(0, 28000);
            let lastProgressWrite = 0;
            const { buf } = await generatePpt({
              query: skQuery,
              language: skLang,
              reference: skReference + (rtlRule ? '\n\n' + rtlRule : ''),
              onProgress: ({ progress, stage }) => {
                const now = Date.now();
                if (now - lastProgressWrite < 15000) return; // throttle DB writes
                lastProgressWrite = now;
                store.updateOutput(output.id, {
                  content: JSON.stringify({ status: 'processing', pipeline: pipeLabel, progress: progress || '', stage: stage || '' }),
                }).catch(() => {});
              },
            });
            const cleanBuf = await sanitizePptxArabicBuffer(buf, language === 'ar');
            const fileName = `${deckFileBase(requestedDeckTitle, ws)}.pptx`;
            try { require('fs').writeFileSync(path.join(config.generatedDir, fileName), cleanBuf); } catch {}
            await store.updateOutput(output.id, {
              title: requestedDeckTitle, file_name: fileName,
              content: JSON.stringify({ engine: 'skywork', status: 'done' }), file_data: cleanBuf,
            });
            console.log('[pipeline] Skywork deck ready:', output.id);
            return;
          } catch (e) {
            console.warn('[pipeline] Skywork failed, falling back:', e.message);
            if (!useManus && !cfg.providers.anthropic.key) throw e;
          }
        }

        // Stage 2 (Claude): art direction — only needed for the Manus/Claude production paths.
        const refPages = designProvider === 'anthropic' ? loadReferencePages(3) : [];
        const art = await ai.chat({
          provider: designProvider,
          system: deckArtSystem(language),
          images: refPages,
          user: (refPages.length ? 'The attached images are slides from a REFERENCE deck. They are a CRAFT BENCHMARK ONLY: match their level of finish, density, layering and typographic care — do NOT copy their topic, text, colors or layouts.\n\n' : '')
            + 'CONTENT PLAN:\n' + plan.text.slice(0, 25000) + '\n\nSOURCE MATERIAL EXCERPT:\n' + deckContext.slice(0, 25000) + '\n\nWrite the complete art direction now.',
        });
        const pipelineBrief = 'SLIDE-BY-SLIDE CONTENT PLAN (follow exactly):\n' + plan.text.slice(0, 25000)
          + '\n\nART DIRECTION (follow exactly):\n' + art.text.slice(0, 25000);

        if (useManus && engine !== 'claude') {
          // Stage 3a (Manus): full production from the pre-made briefs.
          const deckPrompt = `You are the PRODUCTION stage of a three-AI pipeline. A content strategist and an art director have already done their work below. EXECUTE their plan and art direction EXACTLY — every slide, every fact, the palette, typography, motifs and per-slide imagery. Do not redesign; realize their vision at the highest possible craft: cinematic full-bleed backgrounds, layered panels with elegant frames, glowing iconography, perfect visual hierarchy. Every slide fully designed with imagery — nothing plain.

LANGUAGE: the entire deck must be in ${language === 'ar' ? 'Arabic' : 'English'}.
${arabicSlideQualityRule(language)}
SPEED: all research and design decisions are already made below — do NOT conduct web research; go straight to production.
DELIVERABLE: the final editable .pptx file, with speaker notes, ending with a References slide.

${pipelineBrief}

SOURCE MATERIAL (for fact checking only):
${deckContext.slice(0, 40000)}`;
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
          const { taskId, taskUrl } = await createDeckTask(finalPrompt, language, requestedDeckTitle.slice(0, 80), refIds);
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
          user: pipelineBrief + '\n\nSOURCE MATERIAL:\n' + deckContext.slice(0, 30000) + '\n\nBuild the deck JSON now, following the plan and art direction exactly.',
        });
        const spec = ai.parseJson(out.text);
        if (!spec || !Array.isArray(spec.slides)) throw new Error('deck specification unparseable');

        const images = {};
        {
          // Slide imagery: Skywork Design first (premium designed visuals), OpenAI as fallback.
          const { skyworkConfigured: skDesignOk, generateDesign } = require('../services/skywork');
          const styleSuffix = (spec.theme?.image_style ? ` Style: ${spec.theme.image_style}.` : '')
            + ' Ultra-detailed, premium editorial quality, cinematic lighting, layered depth, professional composition. No words, letters or logos in the image.';
          const jobs = [];
          if (spec.image) jobs.push(['cover', spec.image]);
          (spec.slides || []).forEach((sl2, i2) => {
            if (jobs.length >= 12) return;
            const prompt = sl2.image || `${sl2.title || 'UAEICP briefing slide'}: premium editorial background, abstract government technology visual, layered depth, cinematic lighting`;
            jobs.push(['s' + i2, prompt]);
          });
          if (skDesignOk() && jobs.length) {
            const done = await Promise.all(jobs.map(async ([k, pr]) => {
              try { const { buf } = await generateDesign({ prompt: pr + styleSuffix, aspectRatio: '16:9', resolution: '1K' }); return [k, buf]; }
              catch (e) { console.warn('[pipeline] Skywork design image failed:', e.message); return [k, null]; }
            }));
            for (const [k, buf] of done) if (buf) images[k] = buf;
          }
          if (cfg.providers.openai.key && jobs.some(([k]) => !images[k])) {
            const { generateImage } = require('../services/images');
            const missing = jobs.filter(([k]) => !images[k]);
            const done = await Promise.all(missing.map(async ([k, pr]) => [k, await generateImage(pr + styleSuffix)]));
            for (const [k, buf] of done) if (buf) images[k] = buf;
          }
        }

        const finalTitle = isGenericDeckTitle(spec.title) ? requestedDeckTitle : (compactTitle(spec.title) || requestedDeckTitle);
        const fileBase = deckFileBase(finalTitle, ws);
        const fileName = await buildDeck(spec, fileBase, language === 'ar', images);
        let fileData = null;
        try { fileData = require('fs').readFileSync(path.join(config.generatedDir, fileName)); } catch {}
        await store.updateOutput(output.id, {
          title: finalTitle, file_name: fileName,
          content: JSON.stringify(spec), file_data: fileData,
        });
        console.log('[pipeline] deck ready:', output.id);
      } catch (err) {
        console.warn('[pipeline] failed:', err.message);
        await store.updateOutput(output.id, {
          title: titleText(language, 'Briefing Deck — pipeline failed: ', 'فشل إنشاء العرض التقديمي: ') + String(err.message).slice(0, 90),
          content: JSON.stringify({ status: 'error' }),
        }).catch(() => {});
      }
    });
    return;
  }

  if (type === 'infographic') {
    const { skyworkConfigured: skOk, generateDesign } = require('../services/skywork');
    if (skOk()) {
      // Skywork Design produces a real designed PNG. Runs in background like decks.
      const output = await store.addOutput({
        id: uuid(), workspace_id: ws.id, type: 'infographic', format: 'png',
        title: `${titleText(language, 'Infographic', 'إنفوجرافيك')} (GPT+Skywork — ${titleText(language, 'generating…', 'قيد الإنشاء…')})`, file_name: '',
        content: JSON.stringify({ status: 'processing', pipeline: 'GPT+Skywork' }),
        provider: 'GPT+Skywork', created_at: new Date().toISOString(),
      });
      logAction(req.user, 'generate', ws.id, 'infographic \u00b7 skywork');
      res.status(201).json({ output, processing: true });

      setImmediate(async () => {
        try {
          const contentProvider = cfg.providers.openai.key ? 'openai' : (cfg.providers.anthropic.key ? 'anthropic' : provider);
          const plan = await ai.chat({
            provider: contentProvider,
            system: contentPlanSystem(language, focused, hasFiles, 'infographic'),
            user: context.slice(0, 90000) + '\n\nWrite the infographic content plan now.',
          });
          const prompt = `A polished, professional single-page infographic${language === 'ar' ? ' in Arabic \u2014 ALL text in Arabic, right-to-left layout' : ' in English'}. ${(instructions || ws.brief || ws.title || '').trim().slice(0, 400)}
Design a complete modern infographic: bold headline, clear sections, big stat numbers with labels, simple icons, flow arrows where relevant, cohesive contemporary palette, generous spacing. Render all text accurately and legibly. Content to include:
${plan.text.slice(0, 3500)}`;
          const { buf } = await generateDesign({ prompt, aspectRatio: '3:4', resolution: '2K' });
          const fileName = `infographic-${ws.id.slice(0, 8)}-${Date.now()}.png`;
          try { require('fs').writeFileSync(path.join(config.generatedDir, fileName), buf); } catch {}
          await store.updateOutput(output.id, {
            title: titleText(language, 'Infographic', 'إنفوجرافيك'), file_name: fileName,
            content: JSON.stringify({ engine: 'skywork-design', status: 'done' }), file_data: buf,
          });
          console.log('[pipeline] Skywork infographic ready:', output.id);
        } catch (err) {
          console.warn('[pipeline] Skywork infographic failed, falling back to SVG:', err.message);
          try {
            const out = await ai.chat({ provider: useProvider || provider, model, system: infographicSystem(language, focused, hasFiles), user: context + '\n\nGenerate the infographic SVG now.' });
            await store.updateOutput(output.id, { title: titleText(language, 'Infographic', 'إنفوجرافيك'), format: 'svg', content: out.text });
          } catch (e2) {
            await store.updateOutput(output.id, {
              title: titleText(language, 'Infographic — failed: ', 'فشل إنشاء الإنفوجرافيك: ') + String(err.message).slice(0, 80),
              content: JSON.stringify({ status: 'error' }),
            }).catch(() => {});
          }
        }
      });
      return;
    }
  }

  const t = STUDIO_TYPES[type];
  if (!t) return res.status(400).json({ error: 'Unknown output type' });
  const out = await ai.chat({ provider: useProvider || provider, model, system: studioSystem(type, mode, language, focused, hasFiles), user: context + '\n\nGenerate the document now.' });

  let content = out.text;
  const localizedTitle = studioTitle(type, language);
  if (format === 'json') content = JSON.stringify({ type, title: localizedTitle, generated_at: new Date().toISOString(), body_markdown: out.text }, null, 2);
  const output = await store.addOutput({
    id: uuid(), workspace_id: ws.id, type, format,
    title: localizedTitle, file_name: '', content,
    provider: out.provider, created_at: new Date().toISOString(),
  });
  logAction(req.user, 'generate', ws.id, `${type} · ${format}`);
  res.status(201).json({ output, fallbackError: out.fallbackError });
});

// Download a generated output
router.get('/:outputId/download', requireWorkspace, async (req, res) => {
  const o = await store.getOutput(req.params.outputId);
  if (!o || o.workspace_id !== req.workspace.id) return res.status(404).json({ error: 'Output not found' });
  if (o.format === 'png') {
    const data = await store.getOutputFile(o.id);
    if (data && data.length) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', attachmentHeader(o.file_name || 'infographic.png', 'infographic.png'));
      return res.send(data);
    }
    if (o.file_name) return res.download(path.join(config.generatedDir, o.file_name), o.file_name);
    try {
      const meta = JSON.parse(o.content || '{}');
      if (meta.status === 'processing') return res.status(409).json({ error: 'Still generating \u2014 try again shortly.' });
    } catch {}
    return res.status(404).json({ error: 'Image not found' });
  }
  if (o.format === 'pptx') {
    const data = await store.getOutputFile(o.id);
    if (data && data.length) {
      const cleanData = await sanitizePptxArabicBuffer(data, req.workspace.language === 'ar');
      if (cleanData !== data && req.workspace.language === 'ar') {
        store.updateOutput(o.id, { file_data: cleanData }).catch(() => {});
      }
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.setHeader('Content-Disposition', attachmentHeader(o.file_name || `${safeFileBase(o.title || 'deck')}.pptx`, 'deck.pptx'));
      return res.send(cleanData);
    }
    if (o.file_name) {
      const diskPath = path.join(config.generatedDir, o.file_name);
      if (req.workspace.language === 'ar') {
        try {
          const cleanData = await sanitizePptxArabicBuffer(require('fs').readFileSync(diskPath), true);
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
          res.setHeader('Content-Disposition', attachmentHeader(o.file_name, 'deck.pptx'));
          return res.send(cleanData);
        } catch {}
      }
      return res.download(diskPath, o.file_name);
    }
    try {
      const meta = JSON.parse(o.content || '{}');
      if (meta.manus_task_id) {
        // On-demand recovery: ask Manus right now and grab the deck if it's finished.
        const { fetchDeckNow } = require('../services/manus');
        const chk = await fetchDeckNow(meta.manus_task_id).catch(() => null);
        if (chk && chk.status === 'ready' && chk.buf) {
          const recoveredTitle = o.title && !/generating|قيد الإنشاء|timed out/i.test(o.title) ? o.title : deckTitleFromRequest(req.workspace.language, '', req.workspace, null);
          const recoveredName = `${safeFileBase(recoveredTitle)}.pptx`;
          const cleanBuf = await sanitizePptxArabicBuffer(chk.buf, req.workspace.language === 'ar');
          await store.updateOutput(o.id, {
            title: recoveredTitle, file_name: recoveredName,
            file_data: cleanBuf, content: JSON.stringify({ ...meta, status: 'done' }),
          });
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
          res.setHeader('Content-Disposition', attachmentHeader(recoveredName, 'deck.pptx'));
          return res.send(cleanBuf);
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
  res.setHeader('Content-Disposition', attachmentHeader(`${o.type}-${o.id.slice(0, 8)}.${ext}`));
  res.send(o.content);
});

module.exports = router;
