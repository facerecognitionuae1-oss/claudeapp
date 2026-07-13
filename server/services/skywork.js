// Skywork AI deck production — official Skywork-Skills gateway (theme-gateway).
// Streams SSE progress from /ppt_write_stream and returns the finished PPTX.
// Uses raw node:https (NOT fetch) because Node fetch/undici enforces a ~5-minute
// body-idle timeout that kills long deck generations mid-stream.
// Docs: https://github.com/SkyworkAI/Skywork-Skills (skywork-ppt skill).
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const config = require('../config');

const GATEWAY = config.skywork.gatewayUrl;
const OVERALL_MS = Math.max(60 * 1000, Number(config.skywork.timeoutMs) || 30 * 60 * 1000);
const IDLE_MS = Math.max(60 * 1000, Number(config.skywork.idleMs) || 12 * 60 * 1000);

function skyworkConfigured() { return !!config.skywork.key; }

function decodeEventData(curData) {
  let raw = {};
  try { raw = curData ? JSON.parse(curData) : {}; } catch (e) { raw = {}; }
  let data = (raw && typeof raw === 'object' && 'data' in raw) ? raw.data : raw;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { data = {}; } }
  if (!data || typeof data !== 'object') data = {};
  return data;
}

// POST JSON and consume an SSE stream over raw http(s) — no hidden idle timeouts.
// Resolves { downloadUrl, sawActivity } or rejects with a descriptive error.
function ssePost(url, payload, headers, onProgress) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const body = JSON.stringify(payload);
    const req = lib.request(u, { method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } });

    let settled = false;
    let overall = null, idle = null;
    const clearTimers = () => { clearTimeout(overall); clearTimeout(idle); };
    const fail = (e) => { if (settled) return; settled = true; clearTimers(); try { req.destroy(); } catch (x) {} reject(e); };
    const ok = (v) => { if (settled) return; settled = true; clearTimers(); resolve(v); };

    const state = { downloadUrl: '', sawActivity: false };
    overall = setTimeout(() => fail(new Error(`Skywork timed out: no finished deck after ${Math.round(OVERALL_MS / 60000)} min`)), OVERALL_MS);
    const bumpIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(() => fail(new Error(`Skywork stream went silent for ${Math.round(IDLE_MS / 60000)} min - treating as failed`)), IDLE_MS);
    };

    req.on('error', (e) => fail(new Error('Skywork connection error: ' + e.message)));
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        let b = '';
        res.on('data', (c) => { b += c; });
        res.on('end', () => fail(new Error('Skywork HTTP ' + res.statusCode + ': ' + b.slice(0, 300))));
        return;
      }
      bumpIdle();
      res.setEncoding('utf8');
      let buf = '', curEvent = null, curData = null;

      const dispatch = () => {
        if (curEvent === null || curData === null) { curEvent = null; curData = null; return; }
        const data = decodeEventData(curData);
        const evName = curEvent;
        curEvent = null; curData = null;
        if (evName === 'phase') {
          state.sawActivity = true;
          if (onProgress) { try { onProgress({ progress: data.progress, stage: data.stage || data.phase, phase: data.phase }); } catch (e) {} }
          if (data.phase && data.phase !== 'ping') console.log('[skywork]', data.phase, data.status || '', data.page_num || '');
        } else if (evName === 'completionEvent') {
          if (data.phase === 'done') {
            state.downloadUrl = data.download_url || '';
            if (!state.downloadUrl) return fail(new Error('Skywork: completion event without download_url'));
          }
        } else if (evName === 'error') {
          const msg = data.message || JSON.stringify(data);
          if (/insufficient benefit|quota|credit/i.test(msg)) return fail(new Error('Skywork credits/plan exhausted: ' + msg));
          return fail(new Error('Skywork: ' + msg));
        }
      };

      res.on('data', (chunk) => {
        bumpIdle();
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, '');
          buf = buf.slice(idx + 1);
          if (line === '') dispatch();
          else if (line.startsWith('event:')) curEvent = line.slice(6).trim();
          else if (line.startsWith('data:')) curData = line.slice(5).trim();
        }
      });
      res.on('end', () => { dispatch(); ok(state); });
      res.on('error', (e) => fail(new Error('Skywork stream error: ' + e.message)));
    });
    req.end(body);
  });
}

// Plain buffer download over raw https (no fetch timeouts), follows redirects.
function download(url, depth) {
  depth = depth || 0;
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('Skywork download: too many redirects'));
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(u, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(new URL(res.headers.location, u).href, depth + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('Skywork file download failed: HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(5 * 60 * 1000, () => { req.destroy(new Error('Skywork download timed out')); });
  });
}

/**
 * Generate a finished PPTX via Skywork.
 * opts: { query, language ('English'|'Arabic'), reference, templateUrls[], onProgress }
 * Returns { buf, url }.
 */
async function generatePpt(opts) {
  if (typeof opts === 'string') opts = { query: opts };
  const { query, language = 'English', reference = '', templateUrls = [], onProgress } = opts;

  const payload = { query: String(query).slice(0, 8000), language, source_platform: '' };
  if (reference) payload.reference = String(reference).slice(0, 60000);
  let endpoint = '/ppt_write_stream';
  if (templateUrls.length) { endpoint = '/chat_pptx_process'; payload.template_urls = templateUrls; }

  const attempt = () => {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'Session-Id': crypto.randomUUID().replace(/-/g, '_'),
      'Language': language,
      'Authorization': 'Bearer ' + config.skywork.key,
    };
    return ssePost(GATEWAY + endpoint, payload, headers, onProgress);
  };

  let state;
  try {
    state = await attempt();
  } catch (e) {
    // Retry ONCE, but only if the failure happened before generation actually started
    // (connection-level problem — no credits were consumed yet). Never retry credit errors.
    const preStart = !/credits|benefit|quota/i.test(e.message) && /connection|HTTP 5|ECONN|ETIMEDOUT|EAI_AGAIN|socket/i.test(e.message);
    if (!preStart) throw e;
    console.warn('[skywork] connection failed before start, retrying once:', e.message);
    state = await attempt();
  }

  if (!state.downloadUrl) throw new Error('Skywork: stream ended without a finished file' + (state.sawActivity ? ' (generation started but never completed)' : ''));
  const buf = await download(state.downloadUrl);
  return { buf, url: state.downloadUrl };
}

/** Upload a file buffer to Skywork OSS (for template imitation / reference files). */
async function uploadOss(buf, filename, mime) {
  mime = mime || 'application/octet-stream';
  const boundary = crypto.randomUUID().replace(/-/g, '');
  const head = Buffer.from(
    '--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + filename + '"\r\nContent-Type: ' + mime + '\r\n\r\n'
  );
  const tail = Buffer.from('\r\n--' + boundary + '--\r\n');
  const res = await fetch(GATEWAY + '/upload_oss', {
    method: 'POST',
    headers: {
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
      'Authorization': 'Bearer ' + config.skywork.key,
    },
    body: Buffer.concat([head, buf, tail]),
  });
  const data = await res.json().catch(() => ({}));
  if (data.code !== 200 || !data.url) throw new Error('Skywork upload failed: ' + (data.msg || res.status));
  return data.url;
}

module.exports = { skyworkConfigured, generatePpt, uploadOss };
