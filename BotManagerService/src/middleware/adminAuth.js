const { safeEqual } = require('../core/payments/webhookSignature');

// Fail closed: an unconfigured token rejects every request instead of
// silently letting anyone create real Stripe customers/subscriptions or
// fetch a live Billing Portal link for an arbitrary botId slug.
function requireAdminToken({ token, logger, headerName = 'authorization' } = {}) {
  return function adminAuthMiddleware(req, res, next) {
    if (!token) {
      logger && logger.warn && logger.warn('Admin-authenticated route called with no admin token configured - rejecting');
      return res.status(503).json({ error: 'Admin authentication is not configured' });
    }

    const header = req.get(headerName);
    const presented = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;

    if (!presented || !safeEqual(presented, token)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    return next();
  };
}

module.exports = { requireAdminToken };
