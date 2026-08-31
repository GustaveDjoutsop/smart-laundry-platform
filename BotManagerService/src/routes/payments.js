const express = require('express');

const { getPaymentService } = require('../core/payments/paymentService');
const { verifyHmacSha256Hex } = require('../core/payments/webhookSignature');
const { formatShippingAddress, formatPayerName, formatPayerContact, mapCaptureStatus } = require('../core/payments/providers/paypalProvider');
const { logger } = require('../utils/logger');

function getSignatureHeader(req) {
  const headerName = process.env.CAMPAY_WEBHOOK_SIGNATURE_HEADER || 'x-campay-signature';
  return req.get(headerName);
}

// Folds a successful PayPal capture response's payer/shipping/contact data
// into the payment record. Deliberately reads-merges-writes existing
// metadata rather than passing a fresh object to appendEvent -
// PaymentStore.appendEvent's metadata field replaces wholesale, not
// deep-merges, so passing only the new PayPal fields would silently drop
// the cart/name/address/etc. captured at initiatePayment time.
async function recordPaypalCapture({ botId, store, events, orderId, capture }) {
  const existing = await store.getPayment({ botId, transactionId: orderId });
  const existingMetadata = (existing && existing.metadata) || {};

  const captureRecord = capture.purchase_units && capture.purchase_units[0] && capture.purchase_units[0].payments
    ? capture.purchase_units[0].payments.captures && capture.purchase_units[0].payments.captures[0]
    : null;
  // A 2xx from /capture is only HTTP-level success - PayPal can still return
  // a capture that isn't COMPLETED yet (PENDING for e.g. eCheck clearing or
  // a risk review, DECLINED). Must not treat "the API call succeeded" as
  // "the money has moved" - that distinction is exactly what causes a
  // premature/unpaid order confirmation if skipped.
  const status = mapCaptureStatus(captureRecord && captureRecord.status);
  const amount = captureRecord && captureRecord.amount && captureRecord.amount.value != null ? Number(captureRecord.amount.value) : undefined;
  const currency = captureRecord && captureRecord.amount ? captureRecord.amount.currency_code : undefined;
  const shippingAddress = formatShippingAddress(
    capture.purchase_units && capture.purchase_units[0] && capture.purchase_units[0].shipping && capture.purchase_units[0].shipping.address
  );
  const payerName = formatPayerName(capture.payer);
  // Populates the order confirmation's "Contact:" line - previously nothing
  // extracted this at all, so it always rendered empty (see
  // afromarket-dual-completion-trigger-and-contact-field.md).
  const payerContact = formatPayerContact(capture.payer);

  const { duplicate, previousStatus } = await store.appendEvent({
    botId,
    transactionId: orderId,
    provider: 'paypal',
    // Deliberately its own namespace, distinct from the real
    // PAYMENT.CAPTURE.COMPLETED webhook's own event id (which arrives later,
    // as a separate delivery) - both get appended to the ledger, but
    // PaymentStatusWorker's isSameStatus guard means only the first one to
    // report COMPLETED actually triggers order processing, so this dual
    // signal is harmless, not a double-fulfillment risk.
    eventId: `capture-response:${(captureRecord && captureRecord.id) || orderId}`,
    eventType: status === 'COMPLETED' ? 'payment_completed' : status === 'FAILED' ? 'payment_failed' : 'payment_status_updated',
    status,
    amount,
    currency,
    externalRef: (capture.purchase_units && capture.purchase_units[0] && capture.purchase_units[0].reference_id) || null,
    // Recorded regardless of status - still useful once/if a later webhook
    // does resolve a PENDING capture to COMPLETED.
    metadata: { ...existingMetadata, paypalPayerName: payerName, paypalShippingAddress: shippingAddress, paypalPayerContact: payerContact },
    raw: capture,
    source: 'capture-response'
  });
  if (duplicate) return;

  events.emit('payment.status', {
    botId,
    provider: 'paypal',
    transactionId: orderId,
    status,
    previousStatus
  });
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
      const { duplicate, previousStatus } = await store.appendEvent({
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

      events.emit('payment.status', { ...normalized, previousStatus });

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

      const { duplicate, previousStatus } = await store.appendEvent({
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

      events.emit('payment.status', { ...normalized, previousStatus });

      return res.status(200).json({ ok: true });
    } catch (err) {
      return next(err);
    }
  });

  // Provider webhook (per-bot to preserve tenant isolation)
  router.post('/webhooks/paypal/:botId', async (req, res, next) => {
    try {
      const { gateway, store, events } = getPaymentService();
      const provider = gateway.getProvider('paypal');

      // Fail closed, same discipline as the Stripe route above - but PayPal's
      // verification is an async postback to PayPal's own API (see
      // paypalProvider.js's verifyWebhook), not a local sync check, so this
      // is explicitly awaited rather than following the generic pattern the
      // other two routes use.
      const signatureHeaders = {
        transmissionId: req.get('paypal-transmission-id'),
        transmissionTime: req.get('paypal-transmission-time'),
        certUrl: req.get('paypal-cert-url'),
        authAlgo: req.get('paypal-auth-algo'),
        transmissionSig: req.get('paypal-transmission-sig')
      };
      if (!provider || !(await provider.verifyWebhook(req.rawBody, signatureHeaders))) {
        logger.warn('PayPal webhook signature verification failed');
        return res.status(403).send('Forbidden');
      }

      const { botId } = req.params;
      const payload = req.body;
      const eventType = payload && payload.event_type;

      // PayPal never auto-captures a CAPTURE-intent order on buyer approval -
      // only the buyer's approval is signaled here. The capture call itself
      // is what actually moves the money and returns the payer/shipping data
      // PayPal collected (see recordPaypalCapture above); the real
      // PAYMENT.CAPTURE.COMPLETED webhook, handled below as its own later
      // delivery, then just confirms it independently.
      if (eventType === 'CHECKOUT.ORDER.APPROVED') {
        const orderId = payload.resource && payload.resource.id;
        if (!orderId) {
          logger.warn('PayPal CHECKOUT.ORDER.APPROVED webhook missing order id');
          return res.status(200).json({ ok: true });
        }

        const captured = await provider.captureOrder(orderId);
        if (!captured.ok) {
          // Not retried here - checkStatus's self-heal path (paypalProvider.js)
          // is the backstop PaymentStatusWorker's existing poll already drives.
          logger.warn('PayPal captureOrder failed after buyer approval', { orderId, error: captured.error });
          return res.status(200).json({ ok: true });
        }

        await recordPaypalCapture({ botId, store, events, orderId, capture: captured.data });
        return res.status(200).json({ ok: true });
      }

      if (typeof eventType !== 'string' || !eventType.startsWith('PAYMENT.CAPTURE.')) {
        return res.status(200).json({ ok: true });
      }

      const normalized = gateway.handleWebhook({ botId, provider: 'paypal', payload });

      if (!normalized.transactionId) {
        logger.warn('PayPal webhook missing transactionId');
        return res.status(200).json({ ok: true });
      }

      const { duplicate, previousStatus } = await store.appendEvent({
        botId,
        transactionId: normalized.transactionId,
        provider: 'paypal',
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

      events.emit('payment.status', { ...normalized, previousStatus });

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
