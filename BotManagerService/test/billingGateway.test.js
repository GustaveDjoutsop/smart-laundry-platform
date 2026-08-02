const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { BillingGateway } = require('../src/core/billing/billingGateway');
const { BillingStore } = require('../src/core/billing/billingStore');

function fakeProvider(overrides = {}) {
  return {
    createCustomer: async ({ email, botId }) => ({ id: `cus_${botId}`, email }),
    createSubscriptionCheckoutSession: async ({ customerId }) => ({ id: 'cs_1', url: `https://checkout.stripe.com/c/pay/for-${customerId}` }),
    createPortalSession: async ({ customerId }) => ({ url: `https://billing.stripe.com/session/for-${customerId}` }),
    retrieveSubscription: async (subscriptionId) => ({ id: subscriptionId, status: 'active' }),
    parseWebhook: () => ({ eventId: 'evt_1', eventType: 'invoice.paid', customerId: 'cus_x', subscriptionId: 'sub_x', status: 'ACTIVE' }),
    ...overrides
  };
}

test('startSubscription creates a Stripe customer once and reuses it on a second checkout session', async () => {
  let createCustomerCalls = 0;
  const provider = fakeProvider({
    createCustomer: async ({ botId }) => {
      createCustomerCalls += 1;
      return { id: `cus_${botId}` };
    }
  });
  const store = new BillingStore();
  const gateway = new BillingGateway({ provider, store, events: new EventEmitter() });

  const botId = 'billing-gateway-bot-1';
  const first = await gateway.startSubscription({ botId, priceId: 'price_pro', email: 'owner@example.com' });
  assert.match(first.checkoutUrl, /for-cus_billing-gateway-bot-1/);

  const second = await gateway.startSubscription({ botId, priceId: 'price_pro', email: 'owner@example.com' });
  assert.match(second.checkoutUrl, /for-cus_billing-gateway-bot-1/);

  assert.equal(createCustomerCalls, 1);

  const record = await store.getBilling(botId);
  assert.equal(record.stripeCustomerId, `cus_${botId}`);
  assert.equal(record.priceId, 'price_pro');
});

test('startSubscription passes a stable, botId-derived Idempotency-Key so a race between two concurrent calls collapses at Stripe, not just in the local store', async () => {
  const seenIdempotencyKeys = [];
  const provider = fakeProvider({
    createCustomer: async ({ botId, idempotencyKey }) => {
      seenIdempotencyKeys.push(idempotencyKey);
      return { id: `cus_${botId}` };
    }
  });
  const store = new BillingStore();
  const gateway = new BillingGateway({ provider, store, events: new EventEmitter() });
  const botId = 'billing-gateway-bot-idem';

  // Simulate two requests racing before either write to the store has
  // landed: both read `existing` as empty and both call createCustomer.
  await Promise.all([
    gateway.startSubscription({ botId, priceId: 'price_pro', email: 'owner@example.com' }),
    gateway.startSubscription({ botId, priceId: 'price_pro', email: 'owner@example.com' })
  ]);

  assert.equal(seenIdempotencyKeys.length, 2);
  assert.equal(seenIdempotencyKeys[0], `billing-customer-${botId}`);
  assert.equal(seenIdempotencyKeys[1], `billing-customer-${botId}`);
});

test('startSubscription rejects when the bot already has a subscription in a non-terminal state - prevents a retry/duplicate call from creating a second real, separately-billed subscription', async () => {
  const store = new BillingStore();
  const botId = 'billing-gateway-bot-already-active';
  await store.upsertBilling(botId, { stripeCustomerId: 'cus_existing', stripeSubscriptionId: 'sub_existing', status: 'ACTIVE' });

  let checkoutSessionCalls = 0;
  const provider = fakeProvider({ createSubscriptionCheckoutSession: async () => { checkoutSessionCalls += 1; return { id: 'cs', url: 'https://x' }; } });
  const gateway = new BillingGateway({ provider, store, events: new EventEmitter() });

  await assert.rejects(
    () => gateway.startSubscription({ botId, priceId: 'price_pro', email: 'owner@example.com' }),
    /already has a subscription/
  );
  assert.equal(checkoutSessionCalls, 0);
});

test('startSubscription allows starting a new subscription once the previous one is CANCELED', async () => {
  const store = new BillingStore();
  const botId = 'billing-gateway-bot-resubscribe';
  await store.upsertBilling(botId, { stripeCustomerId: 'cus_existing', stripeSubscriptionId: 'sub_old', status: 'CANCELED' });

  const gateway = new BillingGateway({ provider: fakeProvider(), store, events: new EventEmitter() });
  const result = await gateway.startSubscription({ botId, priceId: 'price_pro', email: 'owner@example.com' });

  assert.match(result.checkoutUrl, /for-cus_existing/);
});

test('startSubscription rejects when required fields are missing', async () => {
  const gateway = new BillingGateway({ provider: fakeProvider(), store: new BillingStore(), events: new EventEmitter() });
  await assert.rejects(() => gateway.startSubscription({ priceId: 'price_pro', email: 'a@example.com' }), /botId/);
  await assert.rejects(() => gateway.startSubscription({ botId: 'x', email: 'a@example.com' }), /priceId/);
  await assert.rejects(() => gateway.startSubscription({ botId: 'x', priceId: 'price_pro' }), /email/);
});

test('createPortalSession rejects when no Stripe customer exists yet for the bot', async () => {
  const gateway = new BillingGateway({ provider: fakeProvider(), store: new BillingStore(), events: new EventEmitter() });
  await assert.rejects(() => gateway.createPortalSession({ botId: 'billing-gateway-bot-never-subscribed' }), /No Stripe customer on file/);
});

test('createPortalSession succeeds once a customer is on file', async () => {
  const store = new BillingStore();
  const botId = 'billing-gateway-bot-2';
  await store.upsertBilling(botId, { stripeCustomerId: 'cus_2' });

  const gateway = new BillingGateway({ provider: fakeProvider(), store, events: new EventEmitter() });
  const result = await gateway.createPortalSession({ botId });
  assert.match(result.url, /for-cus_2/);
});

test('handleWebhook rejects an event for a botId with no billing record on file - webhooks confirm an existing relationship, they never create one', async () => {
  const gateway = new BillingGateway({ provider: fakeProvider(), store: new BillingStore(), events: new EventEmitter() });
  const result = await gateway.handleWebhook({ botId: 'billing-gateway-bot-never-subscribed', payload: {} });

  assert.equal(result.applied, false);
  assert.equal(result.rejected, 'no_billing_record');
});

test('handleWebhook does not mark a rejected event as seen - a valid redelivery of the same eventId can still be applied once the billing record exists', async () => {
  // Regression guard: dedup must happen AFTER the tenant checks, not before.
  // If the first (rejected) delivery permanently marked the eventId as
  // "seen", Stripe's later redelivery of that same, now-valid event would
  // be dropped as a duplicate forever - the subscription update could never
  // be applied even after the underlying issue (missing billing record) is
  // fixed.
  const store = new BillingStore();
  const botId = 'billing-gateway-bot-redelivery';
  const provider = fakeProvider({
    parseWebhook: () => ({ eventId: 'evt_redelivered', eventType: 'invoice.paid', customerId: 'cus_x', subscriptionId: 'sub_x', status: 'ACTIVE' })
  });
  const gateway = new BillingGateway({ provider, store, events: new EventEmitter() });

  const firstAttempt = await gateway.handleWebhook({ botId, payload: {} });
  assert.equal(firstAttempt.applied, false);
  assert.equal(firstAttempt.rejected, 'no_billing_record');

  // The underlying issue is now fixed - the bot has a matching billing record.
  await store.upsertBilling(botId, { stripeCustomerId: 'cus_x' });

  const redelivery = await gateway.handleWebhook({ botId, payload: {} });
  assert.equal(redelivery.duplicate, false);
  assert.equal(redelivery.applied, true);
  assert.equal(redelivery.record.status, 'ACTIVE');
});

test('handleWebhook rejects an event whose customerId does not match the botId\'s billing record - prevents cross-tenant corruption from a misrouted or replayed webhook', async () => {
  const store = new BillingStore();
  const botId = 'billing-gateway-bot-tenant-a';
  await store.upsertBilling(botId, { stripeCustomerId: 'cus_tenant_a' });

  const provider = fakeProvider({
    parseWebhook: () => ({ eventId: 'evt_wrong_tenant', eventType: 'invoice.paid', customerId: 'cus_tenant_b', subscriptionId: 'sub_b', status: 'ACTIVE' })
  });
  const gateway = new BillingGateway({ provider, store, events: new EventEmitter() });

  const result = await gateway.handleWebhook({ botId, payload: {} });
  assert.equal(result.applied, false);
  assert.equal(result.rejected, 'tenant_mismatch');

  const record = await store.getBilling(botId);
  assert.equal(record.stripeSubscriptionId, null);
});

test('handleWebhook applies the parsed patch once the botId already has a matching customer on file, and emits billing.status', async () => {
  const store = new BillingStore();
  const events = new EventEmitter();
  const botId = 'billing-gateway-bot-3';
  await store.upsertBilling(botId, { stripeCustomerId: 'cus_x' });

  const emitted = [];
  events.on('billing.status', (payload) => emitted.push(payload));

  const gateway = new BillingGateway({ provider: fakeProvider(), store, events });
  const result = await gateway.handleWebhook({ botId, payload: {} });

  assert.equal(result.duplicate, false);
  assert.equal(result.applied, true);
  assert.equal(result.record.stripeCustomerId, 'cus_x');
  assert.equal(result.record.stripeSubscriptionId, 'sub_x');
  assert.equal(result.record.status, 'ACTIVE');

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].botId, botId);
  assert.equal(emitted[0].eventType, 'invoice.paid');

  const ledger = await store.getBillingEvents(botId);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].eventId, 'evt_1');
});

test('handleWebhook trusts the live subscription status from retrieveSubscription over the event payload\'s own status - an out-of-order invoice.payment_failed does not regress an already-active subscription', async () => {
  const store = new BillingStore();
  const botId = 'billing-gateway-bot-ordering';
  await store.upsertBilling(botId, { stripeCustomerId: 'cus_x', status: 'ACTIVE' });

  // The event itself claims PAST_DUE (a delayed invoice.payment_failed),
  // but Stripe's live subscription state (fetched via retrieveSubscription)
  // says the subscription is actually active again by now.
  const provider = fakeProvider({
    parseWebhook: () => ({ eventId: 'evt_stale', eventType: 'invoice.payment_failed', customerId: 'cus_x', subscriptionId: 'sub_x', status: 'PAST_DUE' }),
    retrieveSubscription: async () => ({ id: 'sub_x', status: 'active' })
  });
  const gateway = new BillingGateway({ provider, store, events: new EventEmitter() });

  const result = await gateway.handleWebhook({ botId, payload: {} });
  assert.equal(result.record.status, 'ACTIVE');
});

test('handleWebhook falls back to the event\'s own status when retrieveSubscription itself fails, instead of dropping the update', async () => {
  const store = new BillingStore();
  const botId = 'billing-gateway-bot-fallback';
  await store.upsertBilling(botId, { stripeCustomerId: 'cus_x' });

  const provider = fakeProvider({
    parseWebhook: () => ({ eventId: 'evt_fallback', eventType: 'customer.subscription.updated', customerId: 'cus_x', subscriptionId: 'sub_x', status: 'PAST_DUE' }),
    retrieveSubscription: async () => {
      throw new Error('Stripe billing request failed (path=/subscriptions/sub_x, status=500)');
    }
  });
  const gateway = new BillingGateway({ provider, store, events: new EventEmitter() });

  const result = await gateway.handleWebhook({ botId, payload: {} });
  assert.equal(result.applied, true);
  assert.equal(result.record.status, 'PAST_DUE');
});

test('handleWebhook dedupes a redelivered event by eventId - no second store write, no re-emit', async () => {
  const store = new BillingStore();
  const events = new EventEmitter();
  const botId = 'billing-gateway-bot-4';
  await store.upsertBilling(botId, { stripeCustomerId: 'cus_x' });

  let emitCount = 0;
  events.on('billing.status', () => {
    emitCount += 1;
  });

  const gateway = new BillingGateway({ provider: fakeProvider(), store, events });

  const first = await gateway.handleWebhook({ botId, payload: {} });
  assert.equal(first.duplicate, false);

  const redelivered = await gateway.handleWebhook({ botId, payload: {} });
  assert.equal(redelivered.duplicate, true);

  assert.equal(emitCount, 1);
});

test('handleWebhook treats an event with no eventId as a no-op instead of throwing', async () => {
  const provider = fakeProvider({ parseWebhook: () => ({ eventId: null, eventType: 'ping', customerId: null, subscriptionId: null, status: null }) });
  const gateway = new BillingGateway({ provider, store: new BillingStore(), events: new EventEmitter() });

  const result = await gateway.handleWebhook({ botId: 'billing-gateway-bot-5', payload: {} });
  assert.equal(result.duplicate, false);
  assert.equal(result.applied, false);
});
