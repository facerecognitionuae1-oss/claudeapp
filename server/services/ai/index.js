// Multi-provider AI router: OpenAI, Anthropic, Ollama (Qwen etc.), with an offline demo fallback.
const config = require('../../config');

async function callOpenAI(system, user, model) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.providers.openai.key}` },
    body: JSON.stringify({
      model: model || config.providers.openai.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      // no explicit temperature: newer OpenAI models only accept the default
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callOpenAIStream(system, user, model, onDelta) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.providers.openai.key}` },
    body: JSON.stringify({
      model: model || config.providers.openai.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      stream: true,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() || '';
    for (const part of parts) {
      for (const raw of part.split('\n')) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        const data = JSON.parse(payload);
        const delta = data.choices?.[0]?.delta?.content || '';
        if (delta) {
          text += delta;
          onDelta(delta);
        }
      }
    }
  }
  return text;
}

async function callAnthropic(system, user, model, images) {
  const content = [];
  for (const img of images || []) {
    content.push({ type: 'image', source: { type: 'base64', media_type: img.media_type || 'image/jpeg', data: img.data } });
  }
  content.push({ type: 'text', text: user });
  return callAnthropicRaw(system, content, model);
}

async function readSse(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let curEvent = 'message';
  let curData = '';
  const dispatch = () => {
    if (!curData) { curEvent = 'message'; return; }
    onEvent(curEvent, curData);
    curEvent = 'message';
    curData = '';
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '');
      if (line === '') { dispatch(); continue; }
      if (line.startsWith('event:')) curEvent = line.slice(6).trim();
      else if (line.startsWith('data:')) curData += line.slice(5).trim();
    }
  }
  dispatch();
}

async function callAnthropicRaw(system, content, model) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.providers.anthropic.key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || config.providers.anthropic.model,
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.content.map(b => b.text || '').join('');
}

async function callAnthropicStream(system, user, model, images, onDelta) {
  const content = [];
  for (const img of images || []) {
    content.push({ type: 'image', source: { type: 'base64', media_type: img.media_type || 'image/jpeg', data: img.data } });
  }
  content.push({ type: 'text', text: user });
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.providers.anthropic.key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || config.providers.anthropic.model,
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content }],
      stream: true,
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  let text = '';
  await readSse(res, (event, payload) => {
    if (!payload || payload === '[DONE]') return;
    const data = JSON.parse(payload);
    if (event === 'content_block_delta' && data.delta?.type === 'text_delta') {
      const delta = data.delta.text || '';
      if (delta) { text += delta; onDelta(delta); }
    } else if (event === 'error') {
      throw new Error(data.error?.message || 'Anthropic stream error');
    }
  });
  return text;
}

async function callOllama(system, user, model) {
  const res = await fetch(`${config.providers.ollama.url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || config.providers.ollama.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.message.content;
}

async function callOllamaStream(system, user, model, onDelta) {
  const res = await fetch(`${config.providers.ollama.url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || config.providers.ollama.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      stream: true,
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const data = JSON.parse(line);
      const delta = data.message?.content || '';
      if (delta) { text += delta; onDelta(delta); }
    }
  }
  return text;
}

function providerAvailable(name) {
  if (name === 'openai') return !!config.providers.openai.key;
  if (name === 'anthropic') return !!config.providers.anthropic.key;
  if (name === 'ollama') return !!config.providers.ollama.enabled;
  return false;
}

function listProviders() {
  return [
    { id: 'openai', label: 'OpenAI', model: config.providers.openai.model, configured: !!config.providers.openai.key },
    { id: 'anthropic', label: 'Anthropic / Claude', model: config.providers.anthropic.model, configured: !!config.providers.anthropic.key },
    { id: 'ollama', label: `Ollama (${config.providers.ollama.model})`, model: config.providers.ollama.model, configured: providerAvailable('ollama') },
    { id: 'demo', label: 'Demo (offline)', model: 'demo', configured: true },
  ];
}

// Deterministic offline responder so the app works with no keys.
function demoResponse(system, user) {
  const wantsJson = /Return ONLY valid JSON/i.test(system);
  const isPptx = /briefing decks/i.test(system);
  const excerpt = user.replace(/\s+/g, ' ').slice(0, 220);
  if (isPptx) {
    return JSON.stringify({
      title: 'Workspace Briefing (Demo)',
      subtitle: 'Generated in offline demo mode — configure an AI provider for real analysis',
      slides: [
        { title: 'Overview', bullets: ['Demo mode: no AI provider configured', 'Content is placeholder only', 'Configure OpenAI, Anthropic or Ollama in .env'], notes: 'Demo deck.' },
        { title: 'Material Received', bullets: [excerpt || 'No material'], notes: '' },
        { title: 'Next Steps', bullets: ['Add API key to .env', 'Restart server', 'Re-run generation'], notes: '' },
      ],
    });
  }
  if (wantsJson) {
    return JSON.stringify({
      executive_summary: 'DEMO MODE: No AI provider is configured, so this is a placeholder analysis. Configure OpenAI, Anthropic or Ollama in .env to get a real review. Material received: ' + (excerpt || 'none'),
      review_angle: 'Demo placeholder — completeness and readiness review.',
      key_findings: [{ finding: 'Demo mode active; connect a provider for real findings.', confidence: 'HIGH', speculative: false }],
      evidence: [{ point: 'System operating without AI provider.', citation: '[doc: system, near: "demo"]', confidence: 'HIGH' }],
      contradictions: [],
      missing_information: ['Real AI analysis (no provider key configured).'],
      risks_compliance: [{ risk: 'Do not act on demo output.', severity: 'HIGH', note: 'Placeholder content only.' }],
      improvements: ['Set OPENAI_API_KEY, ANTHROPIC_API_KEY or run Ollama locally.'],
      action_priorities: [{ action: 'Configure an AI provider in .env', priority: 1 }],
      follow_up_questions: ['Which provider will be used in production?'],
      human_verification: ['All content requires human review; this is demo output.'],
    });
  }
  return `**Answer**\nDemo mode — no AI provider configured, so this is a placeholder response.\n\n**Key points**\n- Your request was received (${excerpt ? '"' + excerpt + '..."' : 'empty'}).\n- Configure OpenAI, Anthropic or Ollama in \`.env\` to enable real answers.\n\n**Evidence**\n- None (offline demo). Confidence: HIGH that this is a placeholder.\n\n**Uncertainty**\n- Everything — this output contains no real analysis.\n\n**Next questions**\n- Which AI provider should this deployment use?`;
}

async function chat({ provider, model, system, user, images }) {
  const p = provider || 'demo';
  try {
    if (p === 'openai' && providerAvailable('openai')) return { text: await callOpenAI(system, user, model), provider: 'openai', model: model || config.providers.openai.model };
    if (p === 'anthropic' && providerAvailable('anthropic')) return { text: await callAnthropic(system, user, model, images), provider: 'anthropic', model: model || config.providers.anthropic.model };
    if (p === 'ollama' && providerAvailable('ollama')) return { text: await callOllama(system, user, model), provider: 'ollama', model: model || config.providers.ollama.model };
  } catch (err) {
    console.warn(`[ai] ${p} failed: ${err.message} — falling back to demo`);
    return { text: demoResponse(system, user), provider: 'demo', model: 'demo', fallbackError: err.message };
  }
  return { text: demoResponse(system, user), provider: 'demo', model: 'demo' };
}

async function stream({ provider, model, system, user, images, onDelta }) {
  const p = provider || 'demo';
  try {
    if (p === 'openai' && providerAvailable('openai')) {
      return { text: await callOpenAIStream(system, user, model, onDelta), provider: 'openai', model: model || config.providers.openai.model };
    }
    if (p === 'anthropic' && providerAvailable('anthropic')) {
      return { text: await callAnthropicStream(system, user, model, images, onDelta), provider: 'anthropic', model: model || config.providers.anthropic.model };
    }
    if (p === 'ollama' && providerAvailable('ollama')) {
      return { text: await callOllamaStream(system, user, model, onDelta), provider: 'ollama', model: model || config.providers.ollama.model };
    }
    const out = await chat({ provider, model, system, user, images });
    onDelta(out.text);
    return out;
  } catch (err) {
    console.warn(`[ai] ${p} stream failed: ${err.message} â€” falling back to demo`);
    const text = demoResponse(system, user);
    onDelta(text);
    return { text, provider: 'demo', model: 'demo', fallbackError: err.message };
  }
}

// Robust JSON extraction from model output.
function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(text.slice(start, end + 1)); } catch {} }
  return null;
}

module.exports = { chat, stream, listProviders, parseJson };
