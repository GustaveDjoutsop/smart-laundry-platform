const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');

const { healthRouter } = require('./routes/health');
const { machinesRouter } = require('./routes/machines');
const { paymentsRouter } = require('./routes/payments');
const { whatsappRouter } = require('./routes/whatsappWebhook');
const { createRateLimiter } = require('./middleware/rateLimit');

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

  app.use('/api/health', healthRouter({ redisManager, mqttManager }));
  app.use('/api/machines', machinesRouter());
  app.use('/api/payments/webhooks', paymentsWebhookRateLimiter);
  app.use('/api/payments', paymentsRouter());
  app.use('/api/whatsapp/webhook', whatsappRateLimiter, whatsappRouter());

  app.use((err, req, res, next) => {
    // eslint-disable-next-line no-unused-vars
    const ignored = next;
    const status = err && err.status ? err.status : 500;
    res.status(status).json({ error: err && err.message ? err.message : 'Internal Server Error' });
  });

  return app;
}

module.exports = { createApp };
