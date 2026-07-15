const express = require('express');
const { v4: uuid } = require('uuid');
const store = require('../storage');
const { requireAuth, requireWorkspace } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const includeArchived = req.query.archived === '1';
  res.json({ workspaces: await store.listWorkspaces(req.user.id, includeArchived) });
});

router.post('/', async (req, res) => {
  const { title, brief, language, mode, kind } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Title required' });
  const now = new Date().toISOString();
  const ws = await store.createWorkspace({
    id: uuid(), owner_id: req.user.id, title: String(title).slice(0, 200),
    brief: brief || '', language: language === 'ar' ? 'ar' : 'en',
    mode: mode === 'unguarded' ? 'unguarded' : 'guarded',
    kind: kind === 'chat' ? 'chat' : kind === 'studio' ? 'studio' : 'analysis',
    status: 'active', created_at: now, updated_at: now,
  });
  res.status(201).json({ workspace: ws });
});

router.get('/:id', requireWorkspace, async (req, res) => {
  const ws = req.workspace;
  const [files, analyses, messages, outputs, notes] = await Promise.all([
    store.listFiles(ws.id), store.listAnalyses(ws.id), store.listMessages(ws.id),
    store.listOutputs(ws.id), store.listNotes(ws.id),
  ]);
  res.json({
    workspace: ws,
    files: files.map(({ extracted_text, ...f }) => ({ ...f, has_text: !!(extracted_text || '').trim() })),
    analyses, messages, outputs, notes,
  });
});

router.patch('/:id', requireWorkspace, async (req, res) => {
  const { title, brief, language, mode, status } = req.body || {};
  const patch = {};
  if (title !== undefined) patch.title = String(title).slice(0, 200);
  if (brief !== undefined) patch.brief = brief;
  if (language !== undefined) patch.language = language === 'ar' ? 'ar' : 'en';
  if (mode !== undefined) patch.mode = mode === 'unguarded' ? 'unguarded' : 'guarded';
  if (status !== undefined) patch.status = status === 'archived' ? 'archived' : 'active';
  res.json({ workspace: await store.updateWorkspace(req.workspace.id, patch) });
});

router.delete('/:id', requireWorkspace, async (req, res) => {
  await store.deleteWorkspace(req.workspace.id);
  res.json({ ok: true });
});

// Review notes
router.post('/:id/notes', requireWorkspace, async (req, res) => {
  const { content } = req.body || {};
  if (!content) return res.status(400).json({ error: 'Note content required' });
  const note = await store.addNote({
    id: uuid(), workspace_id: req.workspace.id, author_id: req.user.id,
    content, created_at: new Date().toISOString(),
  });
  res.status(201).json({ note });
});

router.delete('/:id/notes/:noteId', requireWorkspace, async (req, res) => {
  await store.deleteNote(req.params.noteId);
  res.json({ ok: true });
});

// Export full workspace report (markdown)
router.get('/:id/export', requireWorkspace, async (req, res) => {
  const ws = req.workspace;
  const [files, analyses, messages, outputs, notes] = await Promise.all([
    store.listFiles(ws.id), store.listAnalyses(ws.id), store.listMessages(ws.id),
    store.listOutputs(ws.id), store.listNotes(ws.id),
  ]);
  const inc = String(req.query.include || 'analysis,chat,outputs,notes').split(',');
  const want = k => inc.includes(k);
  const a = analyses[0];
  const result = a ? (typeof a.result === 'string' ? JSON.parse(a.result) : a.result) : null;
  const ar = ws.language === 'ar';
  const L = ar ? {
    title: 'تقرير مساحة العمل',
    disclaimer: 'مساحة عمل الذكاء المؤسسي لموظفي الهيئة - داخلي. يتطلب مراجعة بشرية ولا يغني عن الاستشارة القانونية أو اعتماد المسؤول المباشر.',
    created: 'تاريخ الإنشاء',
    mode: 'النمط',
    language: 'اللغة',
    status: 'الحالة',
    brief: 'الموجز',
    none: '_لا يوجد_',
    files: 'الملفات',
    latestAnalysis: 'آخر تحليل',
    executiveSummary: 'الملخص التنفيذي',
    reviewAngle: 'زاوية المراجعة',
    keyFindings: 'أبرز النتائج',
    evidence: 'الأدلة',
    contradictions: 'التعارضات',
    missingInfo: 'المعلومات الناقصة',
    risks: 'المخاطر والامتثال',
    improvements: 'التحسينات',
    priorities: 'أولويات الإجراء',
    followUps: 'أسئلة المتابعة',
    verification: 'يتطلب تحققاً بشرياً',
    chat: 'سجل الأسئلة والأجوبة',
    messages: 'رسائل',
    outputs: 'المخرجات المنشأة',
    notes: 'ملاحظات المراجعة البشرية',
    q: 'سؤال',
    a: 'إجابة',
    confidence: 'الثقة',
    speculative: '[افتراضي] ',
    langValue: 'العربية',
  } : {
    title: 'Workspace Report',
    disclaimer: 'UAEICP Employee Intelligence Workspace - INTERNAL. Requires human verification. Not a substitute for legal advice or supervisor approval.',
    created: 'Created',
    mode: 'Mode',
    language: 'Language',
    status: 'Status',
    brief: 'Brief',
    none: '_none_',
    files: 'Files',
    latestAnalysis: 'Latest Analysis',
    executiveSummary: 'Executive Summary',
    reviewAngle: 'Review Angle',
    keyFindings: 'Key Findings',
    evidence: 'Evidence',
    contradictions: 'Contradictions',
    missingInfo: 'Missing Information',
    risks: 'Risks & Compliance',
    improvements: 'Improvements',
    priorities: 'Action Priorities',
    followUps: 'Follow-up Questions',
    verification: 'Human Verification Required',
    chat: 'Q&A History',
    messages: 'messages',
    outputs: 'Generated Outputs',
    notes: 'Human Review Notes',
    q: 'Q',
    a: 'A',
    confidence: 'confidence',
    speculative: '[SPECULATIVE] ',
    langValue: 'English',
  };
  const modeLabels = ar ? { comprehensive: 'شامل', legal: 'قانوني', fraud: 'احتيال', policy: 'سياسات', operational: 'تشغيلي' } : {};
  const statusLabels = ar ? { draft: 'مسودة', active: 'نشط', archived: 'مؤرشف' } : {};
  const valueLabels = ar ? { high: 'عالٍ', medium: 'متوسط', low: 'منخفض', severe: 'مرتفع', critical: 'حرج' } : {};
  const clean = v => String(v || '')
    .replace(/\s*\[doc:[^\]]+\]/gi, '')
    .replace(/\s*_?\(confidence:\s*[^)]+\)_?/gi, '')
    .trim();
  const labelValue = v => valueLabels[String(v || '').toLowerCase()] || v || '';
  const modeLabel = modeLabels[ws.mode] || ws.mode;
  const statusLabel = statusLabels[ws.status] || ws.status;
  const lines = [
    `# ${L.title} - ${ws.title}`,
    `> ${L.disclaimer}`,
    ``, `**${L.created}:** ${ws.created_at}  `, `**${L.mode}:** ${modeLabel}  `, `**${L.language}:** ${ar ? L.langValue : ws.language}  `, `**${L.status}:** ${statusLabel}`,
    ``, `## ${L.brief}`, ws.brief || L.none,
    ``, `## ${L.files} (${files.length})`,
    ...files.map(f => `- ${f.original_name} (${Math.round((f.size_bytes || 0) / 1024)} KB)`),
  ];
  if (result && want('analysis')) {
    lines.push('', `## ${L.latestAnalysis}`, '', `### ${L.executiveSummary}`, clean(result.executive_summary),
      '', `### ${L.reviewAngle}`, clean(result.review_angle),
      '', `### ${L.keyFindings}`,
      ...(result.key_findings || []).map(k => `- ${k.speculative ? L.speculative : ''}${clean(k.finding)} _(${L.confidence}: ${labelValue(k.confidence)})_`),
      '', `### ${L.evidence}`,
      ...(result.evidence || []).map(e => `- ${clean(e.point)} ${e.citation || ''} _(${labelValue(e.confidence)})_`),
      '', `### ${L.contradictions}`, ...(result.contradictions || []).map(c => `- ${clean(c)}`),
      '', `### ${L.missingInfo}`, ...(result.missing_information || []).map(m => `- ${clean(m)}`),
      '', `### ${L.risks}`,
      ...(result.risks_compliance || []).map(r => `- **[${labelValue(r.severity)}]** ${clean(r.risk)} - ${clean(r.note)}`),
      '', `### ${L.improvements}`, ...(result.improvements || []).map(i => `- ${clean(i)}`),
      '', `### ${L.priorities}`,
      ...(result.action_priorities || []).sort((x, y) => x.priority - y.priority).map(p => `${p.priority}. ${clean(p.action)}`),
      '', `### ${L.followUps}`, ...(result.follow_up_questions || []).map(q => `- ${clean(q)}`),
      '', `### ${L.verification}`, ...(result.human_verification || []).map(h => `- ${clean(h)}`));
  }
  if (messages.length && want('chat')) {
    lines.push('', `## ${L.chat} (${messages.length} ${L.messages})`);
    for (const m of messages) lines.push('', `**${m.role === 'user' ? L.q : L.a}${m.model ? ` (${m.provider}/${m.model})` : ''}:**`, m.content);
  }
  if (outputs.length && want('outputs')) {
    lines.push('', `## ${L.outputs}`);
    for (const o of outputs) lines.push(`- [${o.type}] ${o.title} (${o.format}, ${o.created_at})`);
  }
  if (notes.length && want('notes')) {
    lines.push('', `## ${L.notes}`);
    for (const n of notes) lines.push(`- ${n.created_at}: ${n.content}`);
  }
  const md = lines.join('\n');
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="workspace-report-${ws.id.slice(0, 8)}.md"`);
  res.send(md);
});

module.exports = router;
