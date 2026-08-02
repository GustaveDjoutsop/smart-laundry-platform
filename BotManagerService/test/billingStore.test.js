const test = require('node:test');
const assert = require('node:assert/strict');

const { BillingStore } = require('../src/core/billing/billingStore');

test('BillingStore upsertBilling + getBilling round-trips and merges patches over the existing record', async () => {
  const store = new BillingStore();
  const botId = 'billing-store-bot-1';

  await store.upsertBilling(botId, { stripeCustomerId: 'cus_1' });
  await store.upsertBilling(botId, { stripeSubscriptionId: 'sub_1', status: 'ACTIVE' });

  const record = await store.getBilling(botId);
  assert.equal(record.stripeCustomerId, 'cus_1');
  assert.equal(record.stripeSubscriptionId, 'sub_1');
  assert.equal(record.status, 'ACTIVE');
});

test('BillingStore getBilling returns null for a bot with no billing record', async () => {
  const store = new BillingStore();
  const record = await store.getBilling('billing-store-bot-never-seen');
  assert.equal(record, null);
});

test('BillingStore appendBillingEvent + getBillingEvents round-trips in append order', async () => {
  const store = new BillingStore();
  const botId = 'billing-store-bot-ledger';

  await store.appendBillingEvent(botId, { eventId: 'evt_1', eventType: 'invoice.paid', status: 'ACTIVE' });
  await store.appendBillingEvent(botId, { eventId: 'evt_2', eventType: 'customer.subscription.updated', status: 'PAST_DUE' });

  const events = await store.getBillingEvents(botId);
  assert.equal(events.length, 2);
  assert.equal(events[0].eventId, 'evt_1');
  assert.equal(events[1].eventId, 'evt_2');
});

test('BillingStore getBillingEvents requires botId - guards against a falsy caller silently querying a shared "billing_events:undefined" key', async () => {
  const store = new BillingStore();
  await assert.rejects(() => store.getBillingEvents(), /requires botId/);
});

test('BillingStore markEventSeen returns true the first time and false on redelivery', async () => {
  const store = new BillingStore();
  const botId = 'billing-store-bot-dedup';

  const first = await store.markEventSeen({ botId, eventId: 'evt_dup_1' });
  assert.equal(first, true);

  const redelivered = await store.markEventSeen({ botId, eventId: 'evt_dup_1' });
  assert.equal(redelivered, false);

  const differentEvent = await store.markEventSeen({ botId, eventId: 'evt_dup_2' });
  assert.equal(differentEvent, true);
});
