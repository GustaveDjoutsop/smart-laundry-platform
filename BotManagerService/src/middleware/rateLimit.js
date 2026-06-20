function nowMs() {
  return Date.now();
}

function getClientIp(req) {
  // Express sets req.ip based on trust proxy.
  return String(req.ip || req.connection?.remoteAddress || 'unknown');
}

function createRateLimiter({ windowMs, maxRequests, keyPrefix, nowFn } = {}) {
  const windowMillis = Number(windowMs || 60_000);
  const max = Number(maxRequests || 60);
  const prefix = String(keyPrefix || 'rl');
  const now = nowFn || nowMs;

  const buckets = new Map();

  function cleanupExpired() {
    const ts = now();
    for (const [key, bucket] of buckets.entries()) {
      if (!bucket || typeof bucket.resetAt !== 'number' || bucket.resetAt <= ts) {
        buckets.delete(key);
      }
    }
  }

  return function rateLimitMiddleware(req, res, next) {
    cleanupExpired();

    const ts = now();
    const ip = getClientIp(req);
    const key = `${prefix}:${ip}`;

    const existing = buckets.get(key);
    if (!existing || existing.resetAt <= ts) {
      buckets.set(key, { count: 1, resetAt: ts + windowMillis });
      return next();
    }

    existing.count += 1;

    if (existing.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - ts) / 1000));
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error: 'Too Many Requests', retryAfterSeconds });
    }

    return next();
  };
}

module.exports = { createRateLimiter };
