const express = require('express');

const { getPaymentService } = require('../core/payments/paymentService');
const { verifyHmacSha256Hex } = require('../core/payments/webhookSignature');
const { logger } = require('../utils/logger');

function getSignatureHeader(req) {
  const headerName = process.env.CAMPAY_WEBHOOK_SIGNATURE_HEADER || 'x-campay-signature';
  return req.get(headerName);
}

function paymentsRouter() {
  const router = express.Router();

  // Provider webhook (per-bot to preserve tenant isolation)
  router.post('/webhooks/campay/:botId', async (req, res, next) => {
    try {
      const secret = process.env.CAMPAY_WEBHOOK_SECRET || null;
      if (secret) {
        const signatureHeader = getSignatureHeader(req);
        if (!signatureHeader) return res.status(403).send('Forbidden');

        const ok = verifyHmacSha256Hex({
          secret,
          rawBody: req.rawBody,
          signatureHex: String(signatureHeader).replace(/^sha256=/, '')
        });

        if (!ok) {
          logger.warn('CamPay webhook signature verification failed');
          return res.status(403).send('Forbidden');
        }
      }

      const { botId } = req.params;
      const payload = req.body;

      const { gateway, store, events } = getPaymentService();
      const normalized = gateway.handleWebhook({ botId, provider: 'campay', payload });

      if (!normalized.transactionId) {
        logger.warn('CamPay webhook missing transactionId');
        return res.status(200).json({ ok: true });
      }

      const existing = await store.getPayment({ botId, transactionId: normalized.transactionId });
      await store.upsertPayment({
        ...(existing || {}),
        ...normalized
      });

      events.emit('payment.status', normalized);

      return res.status(200).json({ ok: true });
    } catch (err) {
      return next(err);
    }
  });

  // Debug helpers (safe: no PII)
  router.get('/:botId/transactions/:transactionId', async (req, res, next) => {
    try {
      const { botId, transactionId } = req.params;
      const { store } = getPaymentService();
      const payment = await store.getPayment({ botId, transactionId });
      return res.json({ ok: true, payment });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:botId/external/:externalRef', async (req, res, next) => {
    try {
      const { botId, externalRef } = req.params;
      const { store } = getPaymentService();
      const payment = await store.getPaymentByExternalRef({ botId, externalRef });
      return res.json({ ok: true, payment });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { paymentsRouter };
