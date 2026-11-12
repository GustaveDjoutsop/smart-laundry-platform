const express = require('express');

const { getPaymentService } = require('../core/payments/paymentService');
const { verifyHmacSha256Hex } = require('../core/payments/webhookSignature');
const { formatShippingAddress, formatPayerName, formatPayerContact, mapCaptureStatus } = require('../core/payments/providers/paypalProvider');
const { isTerminalStatus } = require('../core/payments/paymentTypes');
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

  const { duplicate, blocked, capturedAfterDeath, previousStatus } = await store.appendEvent({
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
    // does resolve a PENDING capture to COMPLETED. On a refused (blocked)
    // write the store keeps these only where the record does not already
    // have them, so they can never overwrite the order's own metadata.
    metadata: { ...existingMetadata, paypalPayerName: payerName, paypalShippingAddress: shippingAddress, paypalPayerContact: payerContact },
    raw: capture,
    source: 'capture-response'
  });
  if (duplicate) return { blocked: false };

  // PaymentStore refused the transition because the payment was already
  // terminal. Logged at error level, not warn: the capture response in hand
  // means PayPal moved money for a payment this service considers dead, which
  // is a human's problem to settle (refund or honour), not a routine skip.
  if (blocked) {
    if (capturedAfterDeath) {
      logger.error('PayPal capture recorded for a payment that had already failed; order NOT confirmed, queued for manual review', {
        botId,
        orderId,
        terminalStatus: previousStatus,
        amount,
        currency
      });
    } else {
      logger.info('Ignoring a repeat PayPal capture response for an already-paid payment', { botId, orderId });
    }

    return { blocked: true, capturedAfterDeath };
  }

  events.emit('payment.status', {
    botId,
    provider: 'paypal',
    transactionId: orderId,
    status,
    previousStatus
  });

  return { blocked: false };
}

// adminAuthMiddleware/adminRateLimiter guard the non-webhook routes below.
// Both are optional only so existing callers/tests can build a webhook-only
// router; when they are absent the guarded routes fail closed rather than
// serving payment records to anyone who can reach the service.
function paymentsRouter({ adminAuthMiddleware, adminRateLimiter } = {}) {
  const router = express.Router();

  const failClosed = (_req, res) => res.status(503).json({ error: 'Admin authentication is not configured' });
  const adminAuth = adminAuthMiddleware || failClosed;
  const adminLimiter = adminRateLimiter || ((_req, _res, next) => next());

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
      const { duplicate, blocked, capturedAfterDeath, previousStatus } = await store.appendEvent({
        botId,
        transactionId: normalized.transactionId,
        provider: 'campay',
        eventId: normalized.eventId,
        eventType:
          normalized.status === 'COMPLETED' ? 'payment_completed' : normalized.status === 'FAILED' ? 'payment_failed' : 'payment_status_updated',
        status: normalized.status,
        amount: normalized.amount,
        // Carried through so a reconciliation entry states which currency the
        // money moved in - PayPal's capture resource has it, and an entry an
        // operator has to act on must not say "39.94" of nothing.
        currency: normalized.currency,
        externalRef: normalized.externalRef,
        raw: normalized.raw,
        source: 'webhook'
      });
      if (duplicate) return res.status(200).json({ ok: true, duplicate: true });

      // The payment was already terminal, so PaymentStore refused to mark it
      // successful. Nothing is emitted either way: no order confirmation, no
      // "payment received" message.
      if (blocked) {
        if (capturedAfterDeath) {
          // Money moved for a payment the customer was told had failed.
          logger.error('Webhook reported a completed payment that had already failed; queued for manual review', {
            botId,
            provider: normalized.provider,
            transactionId: normalized.transactionId,
            terminalStatus: previousStatus,
            amount: normalized.amount,
            currency: normalized.currency
          });
        } else {
          // The ordinary second completion signal for an already-paid order.
          logger.info('Ignoring a repeat completion signal for an already-paid payment', {
            botId,
            provider: normalized.provider,
            transactionId: normalized.transactionId
          });
        }

        return res.status(200).json({
          ok: true,
          blocked: capturedAfterDeath ? 'payment_already_failed' : 'payment_already_completed'
        });
      }

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

      const { duplicate, blocked, capturedAfterDeath, previousStatus } = await store.appendEvent({
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

      // The payment was already terminal, so PaymentStore refused to mark it
      // successful. Nothing is emitted either way: no order confirmation, no
      // "payment received" message.
      if (blocked) {
        if (capturedAfterDeath) {
          // Money moved for a payment the customer was told had failed.
          logger.error('Webhook reported a completed payment that had already failed; queued for manual review', {
            botId,
            provider: normalized.provider,
            transactionId: normalized.transactionId,
            terminalStatus: previousStatus,
            amount: normalized.amount
          });
        } else {
          // The ordinary second completion signal for an already-paid order.
          logger.info('Ignoring a repeat completion signal for an already-paid payment', {
            botId,
            provider: normalized.provider,
            transactionId: normalized.transactionId
          });
        }

        return res.status(200).json({
          ok: true,
          blocked: capturedAfterDeath ? 'payment_already_failed' : 'payment_already_completed'
        });
      }

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

        // First line of defence: don't call PayPal's capture endpoint at all
        // for a payment that is already terminal - whether it timed out
        // (FAILED/TIMEOUT, so the customer was told it failed) or has already
        // been paid (COMPLETED, so capturing again risks a second charge and
        // a duplicate order). PayPal Orders v2 has no cancel/void endpoint,
        // so the approval link stays live on PayPal's side until the order
        // expires by itself; refusing here is the only control we have.
        // PaymentStore.appendEvent is the second line, covering the paths
        // that reach a COMPLETED status without passing through here.
        // Consults the durable terminal marker as well as the snapshot: the
        // snapshot is gone after 24h while PayPal keeps the order approvable,
        // and a reversal can demote it out of terminal. Blocking here is what
        // stops the capture happening at all, so it must not be the weaker
        // of the two checks.
        const existingPayment = await store.getPayment({ botId, transactionId: orderId });
        const markedTerminal = store.getTerminalRecord
          ? await store.getTerminalRecord({ botId, transactionId: orderId })
          : null;
        const terminalStatus =
          existingPayment && isTerminalStatus(existingPayment.status)
            ? existingPayment.status
            : markedTerminal && isTerminalStatus(markedTerminal.status)
              ? markedTerminal.status
              : null;

        if (terminalStatus) {
          logger.warn('PayPal CHECKOUT.ORDER.APPROVED received for already-terminal payment; skipping capture', {
            orderId,
            status: terminalStatus,
            failureReason: (existingPayment && existingPayment.failureReason) || 'unknown'
          });
          return res.status(200).json({ ok: true, skipped: 'payment_already_terminal' });
        }

        const captured = await provider.captureOrder(orderId);
        if (!captured.ok) {
          // Not retried here - checkStatus's self-heal path (paypalProvider.js)
          // is the backstop PaymentStatusWorker's existing poll already drives.
          logger.warn('PayPal captureOrder failed after buyer approval', { orderId, error: captured.error });
          return res.status(200).json({ ok: true });
        }

        const recorded = await recordPaypalCapture({ botId, store, events, orderId, capture: captured.data });
        if (recorded && recorded.blocked) {
          return res.status(200).json({
            ok: true,
            blocked: recorded.capturedAfterDeath ? 'payment_already_failed' : 'payment_already_completed'
          });
        }

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

      const { duplicate, blocked, capturedAfterDeath, previousStatus } = await store.appendEvent({
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

      // The payment was already terminal, so PaymentStore refused to mark it
      // successful. Nothing is emitted either way: no order confirmation, no
      // "payment received" message.
      if (blocked) {
        if (capturedAfterDeath) {
          // Money moved for a payment the customer was told had failed.
          logger.error('Webhook reported a completed payment that had already failed; queued for manual review', {
            botId,
            provider: normalized.provider,
            transactionId: normalized.transactionId,
            terminalStatus: previousStatus,
            amount: normalized.amount
          });
        } else {
          // The ordinary second completion signal for an already-paid order.
          logger.info('Ignoring a repeat completion signal for an already-paid payment', {
            botId,
            provider: normalized.provider,
            transactionId: normalized.transactionId
          });
        }

        return res.status(200).json({
          ok: true,
          blocked: capturedAfterDeath ? 'payment_already_failed' : 'payment_already_completed'
        });
      }

      events.emit('payment.status', { ...normalized, previousStatus });

      return res.status(200).json({ ok: true });
    } catch (err) {
      return next(err);
    }
  });

  // Ops: payments a provider captured after this service had already declared
  // them terminal. Each entry is money that moved for an order the bot never
  // confirmed - the queue a human works through to refund or honour it.
  // Admin-authenticated: it is a list of live transaction ids, which is also
  // the only thing protecting the per-transaction route below.
  router.get('/:botId/captured-after-terminal', adminLimiter, adminAuth, async (req, res, next) => {
    try {
      const { botId } = req.params;
      const { store } = getPaymentService();
      const entries = await store.getCapturedAfterTerminal({ botId });
      return res.json({ ok: true, count: entries.length, entries });
    } catch (err) {
      return next(err);
    }
  });

  // Operator lookups. These return the raw payment record, which DOES carry
  // PII (customerPhone, and for PayPal metadata.paypalPayerName /
  // paypalPayerContact / paypalShippingAddress) - an earlier comment here
  // claimed otherwise. Until now they were protected only by transaction-id
  // unguessability; admin auth replaces that, since the route above hands out
  // exactly those ids.
  router.get('/:botId/transactions/:transactionId', adminLimiter, adminAuth, async (req, res, next) => {
    try {
      const { botId, transactionId } = req.params;
      const { store } = getPaymentService();
      const payment = await store.getPayment({ botId, transactionId });
      return res.json({ ok: true, payment });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:botId/external/:externalRef', adminLimiter, adminAuth, async (req, res, next) => {
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
