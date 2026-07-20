function makeRateLimit({ windowMs, max, keyPrefix = '' }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = `${keyPrefix}${req.ip || req.socket?.remoteAddress || 'unknown'}`;
    const rec = hits.get(key) || { count: 0, reset: now + windowMs };
    if (rec.reset <= now) {
      rec.count = 0;
      rec.reset = now + windowMs;
    }
    rec.count += 1;
    hits.set(key, rec);
    if (hits.size > 10000) {
      for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    }
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - rec.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(rec.reset / 1000)));
    if (rec.count > max) return res.status(429).json({ error: 'Too many requests. Please wait and try again.' });
    next();
  };
}

module.exports = { makeRateLimit };
