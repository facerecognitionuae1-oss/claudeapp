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

// Background poller: checks every 20s for up to ~20 minutes.
function pollDeck(taskId, outputId, wsId) {
  let attempts = 0;
  const tick = async () => {
    attempts += 1;
    try {
      // slides_format=pptx is essential: without it Manus returns slides as HTML
      const data = await manusFetch(`/v2/task.listMessages?task_id=${encodeURIComponent(taskId)}&order=desc&limit=50&slides_format=pptx`);
      const events = data.events || data.messages || data.data || [];
      let status = 'running';
      for (const ev of events) {
        const s = ev?.status_update?.agent_status;
        if (s) { status = s; break; }
      }
      if (status === 'stopped') {
        // Documented shape: assistant_message.attachments[] = {type, filename, url, content_type}
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
        if (files.length) {
          const r = await fetch(files[0].url);
          if (r.ok) {
            const buf = Buffer.from(await r.arrayBuffer());
            await store.updateOutput(outputId, {
              title: 'Briefing Deck (Manus)', file_name: files[0].name.endsWith('.pptx') ? files[0].name : 'deck.pptx',
              file_data: buf, content: JSON.stringify({ manus_task_id: taskId, status: 'done' }),
            });
            console.log(`[manus] deck ready for output ${outputId}`);
            return;
          }
        }
        await store.updateOutput(outputId, {
          title: 'Briefing Deck (Manus — no file returned, open task in Manus)',
          content: JSON.stringify({ manus_task_id: taskId, status: 'no_file' }),
        });
        return;
      }
      if (status === 'error') {
        await store.updateOutput(outputId, {
          title: 'Briefing Deck (Manus — generation failed)',
          content: JSON.stringify({ manus_task_id: taskId, status: 'error' }),
        });
        return;
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
    } catch (err) { console.warn('[manus] poll error:', err.message); }
    if (attempts < 75) setTimeout(tick, 12000);
    else await store.updateOutput(outputId, {
      title: 'Briefing Deck (Manus — timed out)',
      content: JSON.stringify({ manus_task_id: taskId, status: 'timeout' }),
    }).catch(() => {});
  };
  setTimeout(tick, 15000);
}

module.exports = { manusConfigured, createDeckTask, pollDeck };
