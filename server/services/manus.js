// Manus AI deck generation — creates a Manus task, polls in the background,
// downloads the finished .pptx and stores it on the output record.
const config = require('../config');
const store = require('../storage');
const fs = require('fs');
const path = require('path');

const API = 'https://api.manus.ai';

async function manusFetch(path, opts = {}) {
  const { timeoutMs = 12000, ...fetchOpts } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(API + path, {
    ...fetchOpts,
    signal: controller.signal,
    headers: { 'Content-Type': 'application/json', 'x-manus-api-key': config.manus.key, ...(opts.headers || {}) },
  }).finally(() => clearTimeout(timer));
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(`Manus ${res.status}: ${data.error?.message || 'request failed'}`);
  return data;
}

function manusConfigured() { return !!config.manus.key; }

function parseMeta(output) {
  try { return JSON.parse(output?.content || '{}'); } catch { return {}; }
}

// Deep-scan any event payload for .pptx attachments.
function findPptx(obj, out = [], depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 12) return out;
  if (Array.isArray(obj)) { for (const o of obj) findPptx(o, out, depth + 1); return out; }
  const url = obj.url || obj.file_url || obj.download_url || obj.signed_url;
  const name = obj.filename || obj.file_name || obj.name || '';
  if (typeof url === 'string' && (/\.pptx(?:$|\?)/i.test(url) || /\.pptx$/i.test(String(name))))
    out.push({ url, name: String(name) || 'deck.pptx' });
  for (const k of Object.keys(obj)) findPptx(obj[k], out, depth + 1);
  return out;
}

function attachmentFiles(events) {
  const pptx = [];
  const slides = [];
  for (const ev of events) {
    for (const a of (ev?.assistant_message?.attachments || [])) {
      if (!a || !a.url) continue;
      const file = { url: a.url, name: (a.filename && /\.pptx$/i.test(a.filename)) ? a.filename : 'deck.pptx', contentType: a.content_type || '', type: a.type || '' };
      const isPptx = /presentationml/i.test(a.content_type || '')
        || /\.pptx(?:$|\?)/i.test(a.url)
        || /\.pptx$/i.test(a.filename || '');
      if (isPptx) pptx.push(file);
      else if (a.type === 'slides') slides.push(file);
    }
  }
  if (!pptx.length) pptx.push(...findPptx(events));
  return pptx.length ? pptx : slides;
}

function summarizeAttachments(events) {
  return (events || []).flatMap(ev => (ev?.assistant_message?.attachments || []).map(a => ({
    type: a?.type || '',
    filename: a?.filename || '',
    content_type: a?.content_type || '',
    has_url: !!a?.url,
  }))).slice(0, 20);
}

function latestStatus(events) {
  if (events.some(ev => ev?.status_update?.agent_status === 'stopped')) return 'stopped';
  if (events.some(ev => ev?.status_update?.agent_status === 'error')) return 'error';
  if (events.some(ev => ev?.status_update?.agent_status === 'waiting')) return 'waiting';
  const statusEvent = events.find(ev => ev?.status_update?.agent_status);
  return statusEvent?.status_update?.agent_status || 'running';
}

async function listTaskMessages(taskId) {
  const all = [];
  let cursor = '';
  for (let i = 0; i < 5; i++) {
    const qs = new URLSearchParams({
      task_id: taskId,
      order: 'desc',
      limit: '200',
      slides_format: 'pptx',
      verbose: 'true',
    });
    if (cursor) qs.set('cursor', cursor);
    const data = await manusFetch(`/v2/task.listMessages?${qs.toString()}`);
    const messages = data.messages || data.events || data.data || [];
    all.push(...messages);
    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }
  return all;
}

async function taskDetail(taskId) {
  const data = await manusFetch(`/v2/task.detail?task_id=${encodeURIComponent(taskId)}`);
  return data.task || null;
}

async function uploadFile(filePath, filename = path.basename(filePath)) {
  if (!fs.existsSync(filePath)) return null;
  const data = await manusFetch('/v2/file.upload', {
    method: 'POST',
    timeoutMs: 30000,
    body: JSON.stringify({ filename }),
  });
  if (!data.upload_url || !data.file?.id) throw new Error('Manus did not return an upload URL');
  const buffer = fs.readFileSync(filePath);
  const upload = await fetch(data.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: buffer,
  });
  if (!upload.ok) throw new Error(`Manus file upload failed: ${upload.status}`);
  return data.file.id;
}

async function uploadStyleReference() {
  const ref = path.join(__dirname, '..', 'assets', 'premium-deck-style-reference.pdf');
  try { return await uploadFile(ref, 'premium-deck-style-reference.pdf'); }
  catch (err) {
    console.warn('[manus] style reference upload failed:', err.message);
    return null;
  }
}

async function downloadFile(file) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let r = await fetch(file.url, {
      signal: controller.signal,
      headers: { Accept: 'application/vnd.openxmlformats-officedocument.presentationml.presentation, application/zip, */*' },
    }).finally(() => clearTimeout(timer));
    if (!r.ok) {
      const authed = new AbortController();
      const authedTimer = setTimeout(() => authed.abort(), 20000);
      r = await fetch(file.url, {
        signal: authed.signal,
        headers: {
          'x-manus-api-key': config.manus.key,
          Accept: 'application/vnd.openxmlformats-officedocument.presentationml.presentation, application/zip, */*',
        },
      }).catch(() => r).finally(() => clearTimeout(authedTimer));
    }
    if (!r.ok) return { error: `download ${r.status}`, contentType: r.headers.get('content-type') || '' };
    const contentType = r.headers.get('content-type') || '';
    const buffer = Buffer.from(await r.arrayBuffer());
    const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
    if (!isZip) return { error: 'downloaded attachment is not a PPTX/ZIP file', contentType, bytes: buffer.length };
    return { buffer, contentType, bytes: buffer.length };
  } catch (err) {
    return { error: err.name === 'AbortError' ? 'download timed out' : err.message };
  }
}

async function createDeckTask(prompt, language, title, attachments = []) {
  const content = [{ type: 'text', text: prompt }];
  for (const fileId of attachments.filter(Boolean)) content.push({ type: 'file', file_id: fileId });
  const data = await manusFetch('/v2/task.create', {
    method: 'POST',
    timeoutMs: 30000,
    body: JSON.stringify({
      message: { content },
      locale: language === 'ar' ? 'ar' : 'en',
      hide_in_task_list: true,
      interactive_mode: false,
      agent_profile: config.manus.profile,
      title: title || 'UAEICP briefing deck',
    }),
  });
  return { taskId: data.task_id, taskUrl: data.task_url };
}

async function refreshManusOutput(output) {
  if (!manusConfigured() || !output || output.format !== 'pptx' || output.file_name) return output;
  const meta = parseMeta(output);
  const taskId = meta.manus_task_id;
  if (!taskId || !['processing', 'running', 'waiting', 'timeout', 'no_file'].includes(meta.status)) return output;

  const [detail, events] = await Promise.all([
    taskDetail(taskId).catch(err => {
      console.warn('[manus] detail error:', err.message);
      return null;
    }),
    listTaskMessages(taskId),
  ]);
  const status = detail?.status || latestStatus(events);
  const nextMeta = { ...meta, manus_task_id: taskId, status, credit_usage: detail?.credit_usage, checked_at: new Date().toISOString() };

  if (status === 'stopped') {
    const files = attachmentFiles(events);
    if (files.length) {
      const downloaded = await downloadFile(files[0]);
      if (downloaded?.buffer) {
        return store.updateOutput(output.id, {
          title: 'Briefing Deck (Manus)',
          file_name: files[0].name.endsWith('.pptx') ? files[0].name : 'deck.pptx',
          file_data: downloaded.buffer,
          content: JSON.stringify({ ...nextMeta, status: 'done' }),
        });
      }
      return store.updateOutput(output.id, {
        title: 'Briefing Deck (Manus — PPTX download failed, open task in Manus)',
        content: JSON.stringify({ ...nextMeta, status: 'no_file', download_error: downloaded?.error || 'download failed', content_type: downloaded?.contentType || '', bytes: downloaded?.bytes || 0, attachments: summarizeAttachments(events) }),
      });
    }
    return store.updateOutput(output.id, {
      title: 'Briefing Deck (Manus — no PPTX file returned, open task in Manus)',
      content: JSON.stringify({ ...nextMeta, status: 'no_file', attachments: summarizeAttachments(events) }),
    });
  }

  if (status === 'error') {
    const error = events.find(e => e?.error_message)?.error_message?.content || '';
    return store.updateOutput(output.id, {
      title: 'Briefing Deck (Manus — generation failed)',
      content: JSON.stringify({ ...nextMeta, status: 'error', error }),
    });
  }

  if (status === 'waiting') {
    // Non-interactive tasks shouldn't wait, but if one does, try to nudge it forward.
    const ev = events.find(e => e?.status_update?.status_detail?.waiting_for_event_id);
    const d = ev?.status_update?.status_detail;
    if (d && d.waiting_for_event_type !== 'messageAskUser') {
      try {
        await manusFetch('/v2/task.confirmAction', {
          method: 'POST',
          body: JSON.stringify({ task_id: taskId, event_id: d.waiting_for_event_id, input: { accept: true } }),
        });
      } catch {}
    }
  }

  return store.updateOutput(output.id, { content: JSON.stringify(nextMeta) });
}

async function refreshManusOutputs(outputs) {
  return Promise.all((outputs || []).map(async output => {
    try { return await refreshManusOutput(output); }
    catch (err) {
      console.warn('[manus] refresh error:', err.message);
      return output;
    }
  }));
}

// Background poller: checks every 12s for up to ~15 minutes.
function pollDeck(taskId, outputId, wsId) {
  let attempts = 0;
  const tick = async () => {
    attempts += 1;
    try {
      const output = await store.getOutput(outputId);
      const refreshed = await refreshManusOutput(output);
      if (refreshed?.file_name || !['processing', 'running', 'waiting', 'timeout'].includes(parseMeta(refreshed).status)) {
        if (refreshed?.file_name) console.log(`[manus] deck ready for output ${outputId}`);
        return;
      }
    } catch (err) { console.warn('[manus] poll error:', err.message); }
    if (attempts < 75) setTimeout(tick, 12000);
    else {
      const output = await store.getOutput(outputId).catch(() => null);
      await store.updateOutput(outputId, {
        title: 'Briefing Deck (Manus — timed out)',
        content: JSON.stringify({ ...parseMeta(output), manus_task_id: taskId, status: 'timeout', checked_at: new Date().toISOString() }),
      }).catch(() => {});
    }
  };
  setTimeout(tick, 15000);
}

module.exports = { manusConfigured, createDeckTask, pollDeck, refreshManusOutput, refreshManusOutputs, uploadStyleReference };
