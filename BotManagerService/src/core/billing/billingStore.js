const { redisManager } = require('../redisManager');

// Billing records outlive payment records - a subscription is a standing
// relationship, not a single transaction, so it has no TTL (unlike
// PaymentStore's 24h default). Event-dedup markers still expire; they only
// need to outlive Stripe's own webhook retry window.
const EVENT_SEEN_TTL_SECONDS = 60 * 60 * 24 * 30;

function billingKey(botId) {
  return `billing:${botId}`;
}

function billingEventsKey(botId) {
  return `billing_events:${botId}`;
}

function eventSeenKey({ botId, eventId }) {
  return `billing_event_seen:${botId}:${eventId}`;
}

class BillingStore {
  async getBilling(botId) {
    if (!botId) throw new Error('BillingStore requires botId');
    const raw = await redisManager.get(billingKey(botId));
    return raw ? JSON.parse(raw) : null;
  }

  async upsertBilling(botId, patch) {
    if (!botId) throw new Error('BillingStore requires botId');

    const existing = await this.getBilling(botId);
    const record = {
      botId,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      status: null,
      priceId: null,
      ...(existing || {}),
      ...patch,
      updatedAt: new Date().toISOString()
    };

    await redisManager.set(billingKey(botId), JSON.stringify(record));
    return record;
  }

  // Returns true the first time a given event id is seen for this botId,
  // false on any redelivery - mirrors PaymentStore.appendEvent's dedup guard.
  async markEventSeen({ botId, eventId }) {
    if (!botId || !eventId) return true;
    return redisManager.setnx(eventSeenKey({ botId, eventId }), '1', EVENT_SEEN_TTL_SECONDS);
  }

  // Append-only audit trail of every applied webhook event, separate from
  // the upsertBilling snapshot above - needed to reconstruct *why* a status
  // changed (which Stripe event, when) for billing disputes, mirroring
  // PaymentStore.appendEvent/getEvents.
  async appendBillingEvent(botId, event) {
    if (!botId) throw new Error('BillingStore requires botId');

    const key = billingEventsKey(botId);
    await redisManager.rpush(key, JSON.stringify({ ...event, occurredAt: new Date().toISOString() }));
    await redisManager.expire(key, EVENT_SEEN_TTL_SECONDS);
  }

  async getBillingEvents(botId) {
    const raw = await redisManager.lrange(billingEventsKey(botId), 0, -1);
    return (raw || []).map((entry) => JSON.parse(entry));
  }
}

module.exports = { BillingStore };
