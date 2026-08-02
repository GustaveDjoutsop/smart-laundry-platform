const { redisManager } = require('../redisManager');

const DEFAULT_TTL_SECONDS = 60 * 60 * 24; // 24h
// Event-dedup markers and the idempotency-key ref only need to outlive the
// payment record itself long enough to catch delayed retries/redeliveries -
// 30 days comfortably covers that without being a permanent commitment.
const EVENT_SEEN_TTL_SECONDS = 60 * 60 * 24 * 30;

function paymentKey({ botId, transactionId }) {
  return `payment:${botId}:${transactionId}`;
}

function paymentRefKey({ botId, externalRef }) {
  return `paymentRef:${botId}:${externalRef}`;
}

function paymentEventsKey({ botId, transactionId }) {
  return `payment_events:${botId}:${transactionId}`;
}

function eventSeenKey({ botId, provider, eventId }) {
  return `payment_event_seen:${botId}:${provider}:${eventId}`;
}

function idempotencyKeyRefKey({ botId, idempotencyKey }) {
  return `idempotencyKey:${botId}:${idempotencyKey}`;
}

class PaymentStore {
  constructor({ ttlSeconds } = {}) {
    this.ttlSeconds = typeof ttlSeconds === 'number' ? ttlSeconds : DEFAULT_TTL_SECONDS;
  }

  async upsertPayment(record) {
    const { botId, transactionId, externalRef } = record;
    if (!botId || !transactionId) throw new Error('PaymentStore requires botId and transactionId');

    const key = paymentKey({ botId, transactionId });
    await redisManager.setex(key, this.ttlSeconds, JSON.stringify(record));

    if (externalRef) {
      const refKey = paymentRefKey({ botId, externalRef });
      await redisManager.setex(refKey, this.ttlSeconds, String(transactionId));
    }
  }

  async getPayment({ botId, transactionId }) {
    const key = paymentKey({ botId, transactionId });
    const raw = await redisManager.get(key);
    return raw ? JSON.parse(raw) : null;
  }

  async getPaymentByExternalRef({ botId, externalRef }) {
    const refKey = paymentRefKey({ botId, externalRef });
    const transactionId = await redisManager.get(refKey);
    if (!transactionId) return null;
    return this.getPayment({ botId, transactionId });
  }

  // Append-only ledger: every state transition (initiated / status-polled /
  // completed / failed / refunded) is a new event, never an overwrite of a
  // single mutable row - "current status" stays cheap to read by also
  // maintaining the existing payment:{botId}:{transactionId} row as a
  // derived snapshot of the latest event, not the source of truth.
  async appendEvent({ botId, transactionId, eventId, eventType, provider, status, amount, currency, metadata, raw, source, ...rest }) {
    if (!botId || !transactionId) throw new Error('PaymentStore requires botId and transactionId');

    // Providers without a stable event id (CamPay) get a synthesized one -
    // coarser (dedupes an exact repeat of the same status, not a truly
    // unique delivery id) but still prevents a duplicate ledger entry
    // instead of silently relying on "the overwrite happens to be harmless."
    const dedupeId = eventId || `${provider || 'unknown'}:${transactionId}:${status || 'unknown'}`;
    const seenKey = eventSeenKey({ botId, provider: provider || 'unknown', eventId: dedupeId });
    const isNew = await redisManager.setnx(seenKey, '1', EVENT_SEEN_TTL_SECONDS);
    if (!isNew) {
      return { duplicate: true };
    }

    const occurredAt = new Date().toISOString();
    const event = {
      eventId: eventId || null,
      eventType: eventType || 'payment_status_updated',
      occurredAt,
      provider: provider || null,
      status: status || null,
      amount: amount != null ? amount : null,
      currency: currency || null,
      source: source || null,
      metadata: metadata && typeof metadata === 'object' ? metadata : null,
      raw: raw || null
    };

    const eventsKey = paymentEventsKey({ botId, transactionId });
    await redisManager.rpush(eventsKey, JSON.stringify(event));
    // Refresh the ledger's own TTL on every append, same retention window as
    // the event-seen dedup markers - without this the list would grow
    // forever in Redis (every other key here is TTL-bounded via setex).
    await redisManager.expire(eventsKey, EVENT_SEEN_TTL_SECONDS);

    const existing = await this.getPayment({ botId, transactionId });
    const previousStatus = existing ? existing.status : null;
    const snapshot = {
      ...(existing || {}),
      ...rest,
      botId,
      transactionId,
      provider: provider || (existing && existing.provider) || null,
      status: status || (existing && existing.status) || null,
      amount: amount != null ? amount : existing && existing.amount,
      currency: currency || (existing && existing.currency) || null,
      metadata: event.metadata || (existing && existing.metadata) || null,
      raw: event.raw || (existing && existing.raw) || null,
      updatedAt: occurredAt
    };
    await this.upsertPayment(snapshot);

    // previousStatus is the status *before* this append - callers need it to
    // detect a real transition (e.g. PENDING -> COMPLETED). Re-reading
    // getPayment() after this point would return the status this call just
    // wrote, making every transition look like "no change".
    return { duplicate: false, event, previousStatus };
  }

  async getEvents({ botId, transactionId }) {
    const raw = await redisManager.lrange(paymentEventsKey({ botId, transactionId }), 0, -1);
    return (raw || []).map((entry) => JSON.parse(entry));
  }

  async setIdempotencyRef({ botId, idempotencyKey, transactionId }) {
    if (!botId || !idempotencyKey || !transactionId) return;
    const key = idempotencyKeyRefKey({ botId, idempotencyKey });
    await redisManager.setex(key, EVENT_SEEN_TTL_SECONDS, String(transactionId));
  }

  async getPaymentByIdempotencyKey({ botId, idempotencyKey }) {
    const key = idempotencyKeyRefKey({ botId, idempotencyKey });
    const transactionId = await redisManager.get(key);
    if (!transactionId) return null;
    return this.getPayment({ botId, transactionId });
  }
}

module.exports = { PaymentStore };
