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
  const lines = [
    `# Workspace Report — ${ws.title}`,
    `> UAEICP Employee Intelligence Workspace — INTERNAL. Requires human verification. Not a substitute for legal advice or supervisor approval.`,
    ``, `**Created:** ${ws.created_at}  `, `**Mode:** ${ws.mode}  `, `**Language:** ${ws.language}  `, `**Status:** ${ws.status}`,
    ``, `## Brief`, ws.brief || '_none_',
    ``, `## Files (${files.length})`,
    ...files.map(f => `- ${f.original_name} (${Math.round((f.size_bytes || 0) / 1024)} KB)`),
  ];
  if (result && want('analysis')) {
    lines.push('', '## Latest Analysis', '', `### Executive Summary`, result.executive_summary || '',
      '', `### Review Angle`, result.review_angle || '',
      '', `### Key Findings`,
      ...(result.key_findings || []).map(k => `- ${k.speculative ? '[SPECULATIVE] ' : ''}${k.finding} _(confidence: ${k.confidence})_`),
      '', `### Evidence`,
      ...(result.evidence || []).map(e => `- ${e.point} ${e.citation || ''} _(${e.confidence})_`),
      '', `### Contradictions`, ...(result.contradictions || []).map(c => `- ${c}`),
      '', `### Missing Information`, ...(result.missing_information || []).map(m => `- ${m}`),
      '', `### Risks & Compliance`,
      ...(result.risks_compliance || []).map(r => `- **[${r.severity}]** ${r.risk} — ${r.note || ''}`),
      '', `### Improvements`, ...(result.improvements || []).map(i => `- ${i}`),
      '', `### Action Priorities`,
      ...(result.action_priorities || []).sort((x, y) => x.priority - y.priority).map(p => `${p.priority}. ${p.action}`),
      '', `### Follow-up Questions`, ...(result.follow_up_questions || []).map(q => `- ${q}`),
      '', `### Human Verification Required`, ...(result.human_verification || []).map(h => `- ${h}`));
  }
  if (messages.length && want('chat')) {
    lines.push('', `## Q&A History (${messages.length} messages)`);
    for (const m of messages) lines.push('', `**${m.role === 'user' ? 'Q' : 'A'}${m.model ? ` (${m.provider}/${m.model})` : ''}:**`, m.content);
  }
  if (outputs.length && want('outputs')) {
    lines.push('', `## Generated Outputs`);
    for (const o of outputs) lines.push(`- [${o.type}] ${o.title} (${o.format}, ${o.created_at})`);
  }
  if (notes.length && want('notes')) {
    lines.push('', `## Human Review Notes`);
    for (const n of notes) lines.push(`- ${n.created_at}: ${n.content}`);
  }
  const md = lines.join('\n');
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="workspace-report-${ws.id.slice(0, 8)}.md"`);
  res.send(md);
});

module.exports = router;
