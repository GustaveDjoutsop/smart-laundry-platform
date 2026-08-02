const { normalizeSubscriptionStatus } = require('./billingTypes');

class BillingGateway {
  constructor({ provider, store, events, logger } = {}) {
    this.provider = provider;
    this.store = store;
    this.events = events;
    this.logger = logger;
  }

  async startSubscription({ botId, priceId, email, name } = {}) {
    if (!botId) throw new Error('startSubscription requires botId');
    if (!priceId) throw new Error('startSubscription requires priceId');
    if (!email) throw new Error('startSubscription requires email');

    const existing = await this.store.getBilling(botId);

    // A subscription only ever gets a stripeSubscriptionId once the webhook
    // confirms it (see handleWebhook below) - so an existing one, still in a
    // non-terminal state, means this bot is already being billed. Without
    // this guard, a retried/duplicated call here creates a second real,
    // separately-billed Stripe subscription that this store can't even
    // track (it only holds one stripeSubscriptionId/status pair per botId),
    // so the extra subscription keeps charging the client with zero
    // visibility outside the Stripe Dashboard.
    if (existing && existing.stripeSubscriptionId && existing.status !== 'CANCELED') {
      throw new Error(
        `Bot "${botId}" already has a subscription (status: ${existing.status}) - use the Billing Portal to manage it instead of starting a new one`
      );
    }

    let customerId = existing && existing.stripeCustomerId;

    if (!customerId) {
      // A stable, botId-derived Idempotency-Key (not a random one per call)
      // means two racing requests for the same bot - both reading `existing`
      // as empty before either write lands - resolve to the same Stripe
      // Customer instead of creating two. See billingGateway.test.js's
      // concurrent-call coverage.
      const customer = await this.provider.createCustomer({ email, name, botId, idempotencyKey: `billing-customer-${botId}` });
      customerId = customer.id;
    }

    const session = await this.provider.createSubscriptionCheckoutSession({ customerId, priceId, botId });
    await this.store.upsertBilling(botId, { stripeCustomerId: customerId, priceId });

    return { checkoutUrl: session.url, sessionId: session.id };
  }

  async createPortalSession({ botId } = {}) {
    if (!botId) throw new Error('createPortalSession requires botId');

    const record = await this.store.getBilling(botId);
    if (!record || !record.stripeCustomerId) {
      throw new Error(`No Stripe customer on file for bot "${botId}" - start a subscription first`);
    }

    const session = await this.provider.createPortalSession({ customerId: record.stripeCustomerId });
    return { url: session.url };
  }

  async getStatus({ botId } = {}) {
    if (!botId) throw new Error('getStatus requires botId');
    return this.store.getBilling(botId);
  }

  async handleWebhook({ botId, payload } = {}) {
    if (!botId) throw new Error('handleWebhook requires botId');

    const parsed = this.provider.parseWebhook(payload);
    if (!parsed.eventId) {
      this.logger && this.logger.warn && this.logger.warn('Stripe billing webhook missing event id', { botId, eventType: parsed.eventType });
      return { duplicate: false, applied: false };
    }

    const isNew = await this.store.markEventSeen({ botId, eventId: parsed.eventId });
    if (!isNew) return { duplicate: true, applied: false };

    // A valid signature only proves the payload came from Stripe, not that
    // it belongs to this :botId. The customer/subscription relationship is
    // always established synchronously in startSubscription *before* any
    // webhook can arrive, so a record with no stripeCustomerId on file, or
    // one whose stripeCustomerId disagrees with the event, means this event
    // does not belong to this bot - reject rather than let a misrouted or
    // replayed-to-a-different-URL event corrupt another tenant's billing
    // record.
    // Logged at error level (not warn): the webhook route still returns 200
    // to Stripe either way (a non-200 would just make Stripe retry a payload
    // that will never become valid), so this log line is the only signal
    // that a misrouted/replayed/tenant-crossed event was rejected - it must
    // not blend in with routine warnings.
    const existing = await this.store.getBilling(botId);
    if (!existing || !existing.stripeCustomerId) {
      this.logger && this.logger.error && this.logger.error('Stripe billing webhook rejected: no billing record on file for botId', { botId, eventType: parsed.eventType });
      return { duplicate: false, applied: false, rejected: 'no_billing_record' };
    }
    if (parsed.customerId && parsed.customerId !== existing.stripeCustomerId) {
      this.logger && this.logger.error && this.logger.error('Stripe billing webhook rejected: customerId does not match botId', { botId, eventType: parsed.eventType });
      return { duplicate: false, applied: false, rejected: 'tenant_mismatch' };
    }

    // Trust Stripe's current subscription state over whatever status this
    // particular event happened to carry - a redelivered or out-of-order
    // event (e.g. a delayed invoice.payment_failed arriving after a newer
    // customer.subscription.updated(active)) would otherwise regress status.
    // Falls back to the event's own embedded status only if the live lookup
    // itself fails.
    let status = parsed.status;
    if (parsed.subscriptionId) {
      try {
        const subscription = await this.provider.retrieveSubscription(parsed.subscriptionId);
        status = normalizeSubscriptionStatus(subscription.status);
      } catch (err) {
        this.logger && this.logger.warn && this.logger.warn('Stripe billing webhook: retrieveSubscription failed, applying event status as-is', {
          botId,
          subscriptionId: parsed.subscriptionId,
          error: err && err.message
        });
      }
    }

    const patch = {};
    if (parsed.subscriptionId) patch.stripeSubscriptionId = parsed.subscriptionId;
    if (status) patch.status = status;

    if (Object.keys(patch).length === 0) {
      return { duplicate: false, applied: false };
    }

    const record = await this.store.upsertBilling(botId, patch);
    await this.store.appendBillingEvent(botId, { eventId: parsed.eventId, eventType: parsed.eventType, status, subscriptionId: parsed.subscriptionId });

    if (this.events && this.events.emit) {
      this.events.emit('billing.status', { botId, ...record, eventType: parsed.eventType });
    }

    return { duplicate: false, applied: true, record };
  }
}

module.exports = { BillingGateway };
