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
