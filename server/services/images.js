// AI image generation for slide decks — OpenAI gpt-image-1 with dall-e-3 fallback.
// Fails soft: returns null so decks always build even if generation fails.
const config = require('../config');

async function generateImage(prompt) {
  const key = config.providers.openai.key;
  if (!key) return null;
  const models = [process.env.IMAGE_MODEL || 'gpt-image-1', 'dall-e-3'];
  for (const model of models) {
    try {
      const body = { model, prompt: String(prompt).slice(0, 3500), n: 1, size: model === 'dall-e-3' ? '1792x1024' : '1536x1024' };
      if (model === 'dall-e-3') { body.response_format = 'b64_json'; body.quality = 'hd'; body.style = 'vivid'; }
      else body.quality = 'high';
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) { console.warn(`[images] ${model} ${res.status}: ${(await res.text()).slice(0, 200)}`); continue; }
      const data = await res.json();
      const b64 = data.data?.[0]?.b64_json;
      if (b64) return Buffer.from(b64, 'base64');
      const url = data.data?.[0]?.url;
      if (url) { const r2 = await fetch(url); if (r2.ok) return Buffer.from(await r2.arrayBuffer()); }
    } catch (err) { console.warn(`[images] ${model} failed: ${err.message}`); }
  }
  return null;
}

module.exports = { generateImage };
