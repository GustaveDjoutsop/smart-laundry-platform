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

      // Dedupe by event id before appending to the ledger. Signature
      // verification above is CamPay's pre-existing, opt-in behavior (only
      // enforced when CAMPAY_WEBHOOK_SECRET is set, unlike Stripe's
      // fail-closed verifyWebhook below) - unchanged by this diff.
      const { duplicate } = await store.appendEvent({
        botId,
        transactionId: normalized.transactionId,
        provider: 'campay',
        eventId: normalized.eventId,
        eventType:
          normalized.status === 'COMPLETED' ? 'payment_completed' : normalized.status === 'FAILED' ? 'payment_failed' : 'payment_status_updated',
        status: normalized.status,
        amount: normalized.amount,
        externalRef: normalized.externalRef,
        raw: normalized.raw,
        source: 'webhook'
      });
      if (duplicate) return res.status(200).json({ ok: true, duplicate: true });

      events.emit('payment.status', normalized);

      return res.status(200).json({ ok: true });
    } catch (err) {
      return next(err);
    }
  });

  // Provider webhook (per-bot to preserve tenant isolation)
  router.post('/webhooks/stripe/:botId', async (req, res, next) => {
    try {
      const { gateway, store, events } = getPaymentService();
      const provider = gateway.getProvider('stripe');

      // Fail closed: verifyWebhook already returns false when webhookSecret
      // isn't configured, so a missing secret rejects every webhook instead of
      // silently accepting unverified payloads that could mark orders as paid.
      const signatureHeader = req.get('stripe-signature');
      if (!provider || !provider.verifyWebhook(req.rawBody, signatureHeader)) {
        logger.warn('Stripe webhook signature verification failed');
        return res.status(403).send('Forbidden');
      }

      const { botId } = req.params;
      const payload = req.body;

      const normalized = gateway.handleWebhook({ botId, provider: 'stripe', payload });

      if (!normalized.transactionId) {
        logger.warn('Stripe webhook missing transactionId');
        return res.status(200).json({ ok: true });
      }

      const { duplicate } = await store.appendEvent({
        botId,
        transactionId: normalized.transactionId,
        provider: 'stripe',
        eventId: normalized.eventId,
        eventType:
          normalized.status === 'COMPLETED' ? 'payment_completed' : normalized.status === 'FAILED' ? 'payment_failed' : 'payment_status_updated',
        status: normalized.status,
        amount: normalized.amount,
        externalRef: normalized.externalRef,
        raw: normalized.raw,
        source: 'webhook'
      });
      if (duplicate) return res.status(200).json({ ok: true, duplicate: true });

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
