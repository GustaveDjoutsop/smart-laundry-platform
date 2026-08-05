const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');

const { healthRouter } = require('./routes/health');
const { machinesRouter } = require('./routes/machines');
const { paymentsRouter } = require('./routes/payments');
const { billingRouter } = require('./routes/billing');
const { whatsappRouter } = require('./routes/whatsappWebhook');
const { createRateLimiter } = require('./middleware/rateLimit');
const { requireAdminToken } = require('./middleware/adminAuth');
const { logger } = require('./utils/logger');

function createApp({ redisManager, mqttManager } = {}) {
  const app = express();

  app.set('trust proxy', true);

  app.use(helmet());
  app.use(morgan(':method :url :status :res[content-length] - :response-time ms'));

  // WhatsApp webhooks can be JSON
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        // Needed for X-Hub-Signature-256 verification
        req.rawBody = buf;
      }
    })
  );

  const whatsappRateLimiter = createRateLimiter({
    windowMs: Number(process.env.RATE_LIMIT_WHATSAPP_WINDOW_MS || 60_000),
    maxRequests: Number(process.env.RATE_LIMIT_WHATSAPP_MAX || 120),
    keyPrefix: 'rl:whatsapp'
  });

  const paymentsWebhookRateLimiter = createRateLimiter({
    windowMs: Number(process.env.RATE_LIMIT_PAYMENTS_WEBHOOK_WINDOW_MS || 60_000),
    maxRequests: Number(process.env.RATE_LIMIT_PAYMENTS_WEBHOOK_MAX || 120),
    keyPrefix: 'rl:payments'
  });

  const billingWebhookRateLimiter = createRateLimiter({
    windowMs: Number(process.env.RATE_LIMIT_BILLING_WEBHOOK_WINDOW_MS || 60_000),
    maxRequests: Number(process.env.RATE_LIMIT_BILLING_WEBHOOK_MAX || 120),
    keyPrefix: 'rl:billing'
  });

  const billingAdminRateLimiter = createRateLimiter({
    windowMs: Number(process.env.RATE_LIMIT_BILLING_ADMIN_WINDOW_MS || 60_000),
    maxRequests: Number(process.env.RATE_LIMIT_BILLING_ADMIN_MAX || 30),
    keyPrefix: 'rl:billing-admin'
  });

  const billingAdminAuth = requireAdminToken({ token: process.env.BILLING_ADMIN_TOKEN, logger });

  app.use('/api/health', healthRouter({ redisManager, mqttManager }));
  app.use('/api/machines', machinesRouter());
  app.use('/api/payments/webhooks', paymentsWebhookRateLimiter);
  app.use('/api/payments', paymentsRouter());
  app.use('/api/billing/webhooks', billingWebhookRateLimiter);
  // Rate limiter/auth for admin routes is applied inside billingRouter() to
  // the specific non-webhook routes only - wrapping the whole /api/billing
  // prefix here would also throttle+auth-gate the webhook sub-path above at
  // the stricter admin limit, incorrectly 429ing a burst of legitimate
  // Stripe webhook deliveries.
  app.use('/api/billing', billingRouter({ adminAuthMiddleware: billingAdminAuth, adminRateLimiter: billingAdminRateLimiter }));
  app.use('/api/whatsapp/webhook', whatsappRateLimiter, whatsappRouter());

  // Stripe Checkout's success_url (STRIPE_SUCCESS_URL) lands the customer's
  // browser here right after paying. Purely cosmetic - the actual order
  // confirmation is driven by the Stripe webhook (see routes/payments.js)
  // and delivered back in WhatsApp, independent of whether this page loads.
  // Without it, the customer's browser tab shows a bare "Cannot GET" error
  // after a successful payment.
  app.get('/payment-return', (req, res) => {
    // Stripe's success_url is commonly hit with a `?session_id=...` query
    // param - no-store/noindex keeps that out of shared caches and search
    // indexes even though this page doesn't itself read or reflect it.
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex');
    res.status(200).type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Payment received</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f6f6f6; margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
      .card { background: #fff; padding: 2.5rem; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08); text-align: center; max-width: 360px; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #555; margin: 0; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1><span aria-hidden="true">✅</span> Payment received</h1>
      <p>You can close this tab now. We'll confirm your order right back in WhatsApp.</p>
    </div>
  </body>
</html>`);
  });

  app.use((err, req, res, next) => {
    // eslint-disable-next-line no-unused-vars
    const ignored = next;
    const status = err && err.status ? err.status : 500;
    res.status(status).json({ error: err && err.message ? err.message : 'Internal Server Error' });
  });

  return app;
}

module.exports = { createApp };
