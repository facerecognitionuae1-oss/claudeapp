// Manus AI deck generation — creates a Manus task, polls in the background,
// downloads the finished .pptx and stores it on the output record.
const config = require('../config');
const store = require('../storage');

const API = 'https://api.manus.ai';

async function manusFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-manus-api-key': config.manus.key, ...(opts.headers || {}) },
  });
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
  const files = [];
  for (const ev of events) {
    for (const a of (ev?.assistant_message?.attachments || [])) {
      if (!a || !a.url) continue;
      const isPptx = a.type === 'slides'
        || /presentationml/i.test(a.content_type || '')
        || /\.pptx(?:$|\?)/i.test(a.url)
        || /\.pptx$/i.test(a.filename || '');
      if (isPptx) files.push({ url: a.url, name: (a.filename && /\.pptx$/i.test(a.filename)) ? a.filename : 'deck.pptx' });
    }
  }
  if (!files.length) files.push(...findPptx(events));
  return files;
}

function latestStatus(events) {
  const statusEvent = events.find(ev => ev?.status_update?.agent_status);
  return statusEvent?.status_update?.agent_status || 'running';
}

async function downloadFile(file) {
  let r = await fetch(file.url);
  if (!r.ok) {
    r = await fetch(file.url, { headers: { 'x-manus-api-key': config.manus.key } }).catch(() => r);
  }
  if (!r.ok) return null;
  return Buffer.from(await r.arrayBuffer());
}

async function createDeckTask(prompt, language, title) {
  const data = await manusFetch('/v2/task.create', {
    method: 'POST',
    body: JSON.stringify({
      message: { content: prompt },
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
  if (!manusConfigured() || !output || output.provider !== 'manus' || output.format !== 'pptx' || output.file_name) return output;
  const meta = parseMeta(output);
  const taskId = meta.manus_task_id;
  if (!taskId || !['processing', 'running', 'waiting', 'timeout', 'no_file'].includes(meta.status)) return output;

  const data = await manusFetch(`/v2/task.listMessages?task_id=${encodeURIComponent(taskId)}&order=desc&limit=200&slides_format=pptx`);
  const events = data.messages || data.events || data.data || [];
  const status = latestStatus(events);
  const nextMeta = { ...meta, manus_task_id: taskId, status, checked_at: new Date().toISOString() };

  if (status === 'stopped') {
    const files = attachmentFiles(events);
    if (files.length) {
      const buf = await downloadFile(files[0]);
      if (buf) {
        return store.updateOutput(output.id, {
          title: 'Briefing Deck (Manus)',
          file_name: files[0].name.endsWith('.pptx') ? files[0].name : 'deck.pptx',
          file_data: buf,
          content: JSON.stringify({ ...nextMeta, status: 'done' }),
        });
      }
    }
    return store.updateOutput(output.id, {
      title: 'Briefing Deck (Manus — no PPTX file returned, open task in Manus)',
      content: JSON.stringify({ ...nextMeta, status: 'no_file' }),
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

module.exports = { manusConfigured, createDeckTask, pollDeck, refreshManusOutput, refreshManusOutputs };
