const express = require('express');

const { getBillingService } = require('../core/billing/billingService');
const { logger } = require('../utils/logger');

function billingRouter({ adminAuthMiddleware, adminRateLimiter } = {}) {
  const router = express.Router();
  // Session-creation/status routes fire real Stripe API calls and, for
  // portal-session, hand back a live link to manage a client's subscription
  // - callers must be an authenticated admin, not just anyone who knows a
  // botId slug. The webhook route below is authenticated separately (Stripe
  // signature), not via this middleware - applying these to it too would
  // 429/401 legitimate Stripe webhook deliveries.
  const requireAdmin = adminAuthMiddleware || ((req, res) => res.status(503).json({ error: 'Admin authentication is not configured' }));
  const adminGuards = adminRateLimiter ? [adminRateLimiter, requireAdmin] : [requireAdmin];

  router.post('/:botId/checkout-session', ...adminGuards, async (req, res, next) => {
    try {
      const { botId } = req.params;
      const { priceId, email, name } = req.body || {};

      const { gateway } = getBillingService();
      const result = await gateway.startSubscription({ botId, priceId, email, name });

      return res.json({ ok: true, ...result });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/:botId/portal-session', ...adminGuards, async (req, res, next) => {
    try {
      const { botId } = req.params;

      const { gateway } = getBillingService();
      const result = await gateway.createPortalSession({ botId });

      return res.json({ ok: true, ...result });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:botId/status', ...adminGuards, async (req, res, next) => {
    try {
      const { botId } = req.params;

      const { gateway } = getBillingService();
      const billing = await gateway.getStatus({ botId });

      return res.json({ ok: true, billing });
    } catch (err) {
      return next(err);
    }
  });

  // Billing subscription webhook, registered as its own Stripe Dashboard
  // endpoint (customer.subscription.*, invoice.*) - separate from the
  // consumer-payments checkout.session.* webhook in routes/payments.js, and
  // signed with its own secret (SANDBOX_WEBHOOK_SECRET).
  router.post('/webhooks/stripe/:botId', async (req, res, next) => {
    try {
      const { gateway } = getBillingService();
      const provider = gateway.provider;

      // Fail closed: verifyWebhook returns false when webhookSecret isn't
      // configured, so a missing secret rejects every webhook instead of
      // silently accepting unverified payloads that could mark a client's
      // subscription active without payment.
      const signatureHeader = req.get('stripe-signature');
      if (!provider || !provider.verifyWebhook(req.rawBody, signatureHeader)) {
        logger.warn('Stripe billing webhook signature verification failed');
        return res.status(403).send('Forbidden');
      }

      const { botId } = req.params;
      const payload = req.body;

      const result = await gateway.handleWebhook({ botId, payload });

      return res.status(200).json({ ok: true, duplicate: Boolean(result.duplicate) });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { billingRouter };
