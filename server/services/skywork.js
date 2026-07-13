// Skywork AI deck production via the official theme-gateway streaming API.
const { v4: uuid } = require('uuid');
const config = require('../config');

const API = 'https://api-tools.skywork.ai/theme-gateway';

function skyworkConfigured() { return !!config.skywork.key; }

function parseEventData(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    let data = parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'data')
      ? parsed.data
      : parsed;
    if (typeof data === 'string') data = JSON.parse(data);
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

async function downloadPptx(downloadUrl) {
  const res = await fetch(downloadUrl, { headers: { Accept: 'application/vnd.openxmlformats-officedocument.presentationml.presentation, application/zip, */*' } });
  if (!res.ok) throw new Error(`Skywork file download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
  if (!isZip) throw new Error('Skywork download was not a PPTX/ZIP file');
  return buf;
}

async function generatePpt(query, language = 'en') {
  if (!skyworkConfigured()) throw new Error('SKYWORK_API_KEY is not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(60 * 1000, Number(config.skywork.timeoutMs) || 30 * 60 * 1000));
  const sessionId = uuid().replace(/-/g, '_');
  try {
    const res = await fetch(`${API}/ppt_write_stream`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${config.skywork.key}`,
        'Session-Id': sessionId,
        Language: language === 'ar' ? 'Arabic' : 'English',
      },
      body: JSON.stringify({
        query: String(query).slice(0, 12000),
        language: language === 'ar' ? 'Arabic' : 'English',
        source_platform: '',
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Skywork HTTP ${res.status}: ${text || 'request failed'}`);
    }
    if (!res.body) throw new Error('Skywork did not return a streaming response');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '';
    let eventData = '';
    let lastPhase = '';

    const consumeEvent = async () => {
      if (!eventType && !eventData) return null;
      const data = parseEventData(eventData);
      if (eventType === 'phase') lastPhase = data.phase || lastPhase;
      if (eventType === 'error') {
        const message = data.message || data.error || data.code || JSON.stringify(data) || 'Skywork generation failed';
        throw new Error(`Skywork generation failed: ${message}`);
      }
      if (eventType === 'completionEvent' && data.phase === 'done' && data.download_url) {
        return { buf: await downloadPptx(data.download_url), url: data.download_url };
      }
      return null;
    };

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const chunks = buffer.split(/\r?\n\r?\n/);
      buffer = chunks.pop() || '';
      for (const chunk of chunks) {
        eventType = '';
        eventData = '';
        for (const line of chunk.split(/\r?\n/)) {
          if (line.startsWith('event:')) eventType = line.slice(6).trim();
          else if (line.startsWith('data:')) eventData += line.slice(5).trim();
        }
        const result = await consumeEvent();
        if (result) return result;
      }
      if (done) break;
    }

    throw new Error(`Skywork stream ended before PPTX was ready${lastPhase ? ` (last phase: ${lastPhase})` : ''}`);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Skywork generation timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { skyworkConfigured, generatePpt };
