// Skywork AI deck production — single call, returns a finished PPT file URL.
const config = require('../config');

function skyworkConfigured() { return !!config.skywork.key; }

async function generatePpt(query) {
  const u = new URL('https://api-cn.tiangong.cn/infra/tool/generate_file');
  u.searchParams.set('api_key', config.skywork.key);
  u.searchParams.set('query', String(query).slice(0, 6000));
  u.searchParams.set('file_type', 'ppt');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15 * 60 * 1000); // generous — generation is synchronous
  try {
    const res = await fetch(u, { method: 'POST', signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (data.code !== 200 || !data.data?.url) throw new Error('Skywork: ' + (data.message || ('HTTP ' + res.status)));
    const f = await fetch(data.data.url);
    if (!f.ok) throw new Error('Skywork file download failed: ' + f.status);
    return { buf: Buffer.from(await f.arrayBuffer()), url: data.data.url };
  } finally { clearTimeout(timer); }
}

module.exports = { skyworkConfigured, generatePpt };
