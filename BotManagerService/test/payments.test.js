const test = require('node:test');
const assert = require('node:assert/strict');

const { computeHmacSha256Hex, verifyHmacSha256Hex } = require('../src/core/payments/webhookSignature');
const { PaymentStore } = require('../src/core/payments/paymentStore');

test('verifyHmacSha256Hex verifies computed signature', () => {
  const secret = 's';
  const rawBody = Buffer.from('{"a":1}');
  const signatureHex = computeHmacSha256Hex(secret, rawBody);
  assert.equal(verifyHmacSha256Hex({ secret, rawBody, signatureHex }), true);
});

test('PaymentStore upsert + get works (fallback Redis)', async () => {
  const store = new PaymentStore({ ttlSeconds: 60 });
  const record = {
    botId: 'laundry',
    provider: 'campay',
    transactionId: 'tx1',
    externalRef: 'ref1',
    status: 'PENDING'
  };

  await store.upsertPayment(record);

  const got = await store.getPayment({ botId: 'laundry', transactionId: 'tx1' });
  assert.equal(got.transactionId, 'tx1');

  const gotByRef = await store.getPaymentByExternalRef({ botId: 'laundry', externalRef: 'ref1' });
  assert.equal(gotByRef.transactionId, 'tx1');
});

test('PaymentStore appendEvent builds an append-only ledger, not a single overwritten row', async () => {
  const store = new PaymentStore({ ttlSeconds: 60 });
  const botId = 'afromarket-ledger';
  const transactionId = 'tx-ledger-1';

  await store.appendEvent({ botId, transactionId, provider: 'stripe', eventType: 'payment_initiated', status: 'PENDING', source: 'initiate' });
  await store.appendEvent({
    botId,
    transactionId,
    provider: 'stripe',
    eventId: 'evt_1',
    eventType: 'payment_completed',
    status: 'COMPLETED',
    source: 'webhook'
  });

  const events = await store.getEvents({ botId, transactionId });
  assert.equal(events.length, 2);
  assert.equal(events[0].eventType, 'payment_initiated');
  assert.equal(events[1].eventType, 'payment_completed');

  // The "current status" row is a derived read-model of the latest event.
  const snapshot = await store.getPayment({ botId, transactionId });
  assert.equal(snapshot.status, 'COMPLETED');
});

test('PaymentStore appendEvent returns previousStatus reflecting the snapshot before this call writes the new status', async () => {
  const store = new PaymentStore({ ttlSeconds: 60 });
  const botId = 'afromarket-prevstatus';
  const transactionId = 'tx-prevstatus-1';

  const first = await store.appendEvent({ botId, transactionId, provider: 'stripe', eventType: 'payment_initiated', status: 'PENDING', source: 'initiate' });
  assert.equal(first.previousStatus, null);

  const second = await store.appendEvent({
    botId,
    transactionId,
    provider: 'stripe',
    eventId: 'evt_prevstatus',
    eventType: 'payment_completed',
    status: 'COMPLETED',
    source: 'webhook'
  });
  assert.equal(second.previousStatus, 'PENDING');

  // Confirms the snapshot itself is already COMPLETED by the time this
  // returns - callers must use the returned previousStatus, not re-read the
  // store, to detect the transition.
  const snapshot = await store.getPayment({ botId, transactionId });
  assert.equal(snapshot.status, 'COMPLETED');
});

test('PaymentStore appendEvent dedupes a redelivered webhook event by eventId - no duplicate ledger entry, no re-emit signal', async () => {
  const store = new PaymentStore({ ttlSeconds: 60 });
  const botId = 'afromarket-ledger-dedup';
  const transactionId = 'tx-ledger-2';

  const first = await store.appendEvent({
    botId,
    transactionId,
    provider: 'stripe',
    eventId: 'evt_dup',
    eventType: 'payment_completed',
    status: 'COMPLETED',
    source: 'webhook'
  });
  assert.equal(first.duplicate, false);

  const redelivered = await store.appendEvent({
    botId,
    transactionId,
    provider: 'stripe',
    eventId: 'evt_dup',
    eventType: 'payment_completed',
    status: 'COMPLETED',
    source: 'webhook'
  });
  assert.equal(redelivered.duplicate, true);

  const events = await store.getEvents({ botId, transactionId });
  assert.equal(events.length, 1);
});

test('PaymentStore idempotency key lookup returns the payment initiated under that key', async () => {
  const store = new PaymentStore({ ttlSeconds: 60 });
  const botId = 'afromarket-idem';
  const transactionId = 'tx-idem-1';

  await store.appendEvent({ botId, transactionId, provider: 'stripe', eventType: 'payment_initiated', status: 'PENDING', source: 'initiate' });
  await store.setIdempotencyRef({ botId, idempotencyKey: 'idem-abc', transactionId });

  const found = await store.getPaymentByIdempotencyKey({ botId, idempotencyKey: 'idem-abc' });
  assert.equal(found.transactionId, transactionId);

  const missing = await store.getPaymentByIdempotencyKey({ botId, idempotencyKey: 'no-such-key' });
  assert.equal(missing, null);
});
