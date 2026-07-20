const { v4: uuid } = require('uuid');
const config = require('../config');
const store = require('../storage');

const TASHKEEL_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;

function chunkText(text, max = 1400, overlap = 180) {
  const clean = String(text || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  const paras = clean.split(/\n\s*\n/);
  const chunks = [];
  let cur = '';
  for (const p of paras) {
    if ((cur + '\n\n' + p).length <= max) cur = cur ? cur + '\n\n' + p : p;
    else {
      if (cur) chunks.push(cur);
      cur = p.length > max ? p.slice(0, max) : p;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.map((c, i) => i && overlap ? chunks[i - 1].slice(-overlap) + '\n' + c : c).slice(0, 600);
}

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(TASHKEEL_RE, '')
    .replace(/\u0640/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function terms(s) {
  return normalizeText(s).match(/[\p{L}\p{N}]{2,}/gu) || [];
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

function fuzzyHit(term, bodyTerms) {
  if (bodyTerms.has(term)) return true;
  if (term.length < 5) return false;
  const maxDist = term.length > 8 ? 2 : 1;
  for (const b of bodyTerms) {
    if (Math.abs(term.length - b.length) > maxDist) continue;
    if (levenshtein(term, b) <= maxDist) return true;
  }
  return false;
}

function keywordScore(query, text) {
  const q = [...new Set(terms(query))];
  if (!q.length) return 0;
  const bodyTerms = new Set(terms(text));
  let hit = 0;
  for (const t of q) if (fuzzyHit(t, bodyTerms)) hit += 1;
  return hit / q.length;
}

async function embed(text) {
  if (!config.providers.openai.key) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.providers.openai.key}` },
      body: JSON.stringify({ model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small', input: String(text).slice(0, 8000) }),
    });
    if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}`);
    const data = await res.json();
    return data.data?.[0]?.embedding || null;
  } catch (err) {
    console.warn('[knowledge] embedding failed:', err.message);
    return null;
  }
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / ((Math.sqrt(na) * Math.sqrt(nb)) || 1);
}

async function buildChunks(documentId, text) {
  const parts = chunkText(text);
  const chunks = [];
  for (let i = 0; i < parts.length; i++) {
    chunks.push({
      id: uuid(),
      document_id: documentId,
      chunk_index: i,
      content: parts[i],
      embedding_json: await embed(parts[i]),
      metadata: { normalized_preview: normalizeText(parts[i]).slice(0, 300) },
      created_at: new Date().toISOString(),
    });
  }
  return chunks;
}

async function retrieve(question, limit = 5) {
  const normalizedQuestion = normalizeText(question);
  const qEmb = await embed(`${question}\n${normalizedQuestion}`);
  let candidates = [];
  if (qEmb && typeof store.searchKnowledgeChunks === 'function') {
    try { candidates = await store.searchKnowledgeChunks(qEmb, Math.max(40, limit * 8)); }
    catch (err) { console.warn('[knowledge] pgvector search skipped:', err.message); }
  }
  if (!candidates.length) candidates = await store.listKnowledgeChunks(true);
  if (!candidates.length) return { chunks: [], block: '' };

  const scored = candidates.map(c => {
    const emb = typeof c.embedding_json === 'string' ? JSON.parse(c.embedding_json) : c.embedding_json;
    const vector = Number(c.vector_score || 0) || (qEmb && emb ? cosine(qEmb, emb) : 0);
    const lexical = keywordScore(`${question}\n${normalizedQuestion}`, `${c.content} ${c.document_title || ''} ${c.original_name || ''}`);
    return { ...c, score: vector ? (vector * 0.75 + lexical * 0.25) : lexical };
  }).filter(c => c.score > 0.02)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const block = scored.length ? '\n\nPRIVATE COMPANY KNOWLEDGE BASE (approved internal material; use silently in Balanced mode):\n'
    + scored.map((c, i) => `KB${i + 1} - ${c.document_title || c.original_name}\n${String(c.content).slice(0, 1400)}`).join('\n\n') : '';
  return { chunks: scored, block };
}

module.exports = { buildChunks, retrieve, normalizeText };
