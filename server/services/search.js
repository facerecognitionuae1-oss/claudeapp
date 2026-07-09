// Live web search — Tavily (recommended) or Brave. Fails soft: returns null when
// unconfigured or on error, so every feature still works without it.
const config = require('../config');

async function tavily(query) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: config.search.tavily, query: String(query).slice(0, 380), max_results: 6, include_answer: true, search_depth: 'advanced' }),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  const data = await res.json();
  return {
    answer: data.answer || '',
    results: (data.results || []).map(r => ({ title: r.title, url: r.url, content: (r.content || '').slice(0, 900) })),
  };
}

async function brave(query) {
  const res = await fetch('https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(String(query).slice(0, 380)) + '&count=6', {
    headers: { 'X-Subscription-Token': config.search.brave, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Brave ${res.status}`);
  const data = await res.json();
  return {
    answer: '',
    results: (data.web?.results || []).map(r => ({ title: r.title, url: r.url, content: (r.description || '').slice(0, 900) })),
  };
}

function searchConfigured() { return !!(config.search.tavily || config.search.brave); }

async function webSearch(query) {
  if (!query || !searchConfigured()) return null;
  try {
    const out = config.search.tavily ? await tavily(query) : await brave(query);
    if (!out.results.length && !out.answer) return null;
    return out;
  } catch (err) {
    console.warn('[search] failed:', err.message);
    return null;
  }
}

// Ready-to-inject context block.
function formatSearch(out, query) {
  if (!out) return '';
  const lines = out.results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}\n   ${r.content}`).join('\n');
  return `\n\nLIVE WEB SEARCH RESULTS (query: "${query}", retrieved ${new Date().toISOString().slice(0, 10)}):
${out.answer ? 'Summary: ' + out.answer + '\n' : ''}${lines}
Use these for current, real-world facts. Cite them ONLY in the final References section as: Web — Title (URL). Treat them as unverified secondary sources.`;
}

module.exports = { webSearch, formatSearch, searchConfigured };
