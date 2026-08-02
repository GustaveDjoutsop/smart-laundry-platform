const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { StripeProvider } = require('../src/core/payments/providers/stripeProvider');
const { computeHmacSha256Hex } = require('../src/core/payments/webhookSignature');

function makeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const response = responses.shift();
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body
    };
  };
  return { fetchImpl, calls };
}

function stripeSignatureHeader(secret, rawBody, timestamp = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${timestamp}.${rawBody}`;
  const v1 = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

test('StripeProvider isConfigured reflects secretKey presence', () => {
  const configured = new StripeProvider({ secretKey: 'sk_test', fetchImpl: async () => ({}) });
  const unconfigured = new StripeProvider({ fetchImpl: async () => ({}) });

  assert.equal(configured.isConfigured(), true);
  assert.equal(unconfigured.isConfigured(), false);
});

test('StripeProvider initiatePayment posts a Checkout Session request and returns the hosted checkout URL', async () => {
  const { fetchImpl, calls } = makeFetch([{ status: 200, body: { id: 'cs_test_abc123', url: 'https://checkout.stripe.com/c/pay/cs_test_abc123' } }]);

  const provider = new StripeProvider({
    secretKey: 'sk_test',
    successUrl: 'https://afromarket.example.com/payment-return',
    fetchImpl
  });

  const result = await provider.initiatePayment({
    amount: 27.4,
    currency: 'EUR',
    reference: 'AM-ORDER1',
    description: 'AfroMarket order AM-ORDER1',
    customerEmail: 'jane@example.com',
    customerName: 'Jane Doe'
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk_test');

  const body = calls[0].init.body;
  assert.match(body, /client_reference_id=AM-ORDER1/);
  assert.match(body, /customer_email=jane%40example\.com/);

  assert.equal(result.transactionId, 'cs_test_abc123');
  assert.equal(result.status, 'PENDING');
  assert.equal(result.checkoutUrl, 'https://checkout.stripe.com/c/pay/cs_test_abc123');
});

test('StripeProvider initiatePayment forwards idempotencyKey as the Idempotency-Key header', async () => {
  const { fetchImpl, calls } = makeFetch([{ status: 200, body: { id: 'cs_test_idem', url: 'https://checkout.stripe.com/c/pay/cs_test_idem' } }]);

  const provider = new StripeProvider({ secretKey: 'sk_test', successUrl: 'https://afromarket.example.com/return', fetchImpl });

  await provider.initiatePayment({
    amount: 10,
    currency: 'EUR',
    reference: 'AM-ORDER2',
    customerEmail: 'jane@example.com',
    idempotencyKey: 'idem-key-xyz'
  });

  assert.equal(calls[0].init.headers['Idempotency-Key'], 'idem-key-xyz');
});

test('StripeProvider initiatePayment rejects when customerEmail is missing', async () => {
  const provider = new StripeProvider({
    secretKey: 'sk_test',
    successUrl: 'https://afromarket.example.com/return',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) })
  });

  await assert.rejects(() => provider.initiatePayment({ amount: 10, currency: 'EUR', reference: 'x' }), /customerEmail/);
});

test('StripeProvider initiatePayment rejects when no success URL is configured', async () => {
  const provider = new StripeProvider({
    secretKey: 'sk_test',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) })
  });

  await assert.rejects(
    () => provider.initiatePayment({ amount: 10, currency: 'EUR', reference: 'x', customerEmail: 'jane@example.com' }),
    /success URL/
  );
});

test('StripeProvider initiatePayment rejects when currency is missing', async () => {
  const provider = new StripeProvider({
    secretKey: 'sk_test',
    successUrl: 'https://afromarket.example.com/return',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) })
  });

  await assert.rejects(
    () => provider.initiatePayment({ amount: 10, reference: 'x', customerEmail: 'jane@example.com' }),
    /currency/
  );
});

test('StripeProvider initiatePayment throws on a non-success API response', async () => {
  const { fetchImpl } = makeFetch([{ status: 400, body: { error: { message: 'Invalid amount' } } }]);

  const provider = new StripeProvider({ secretKey: 'sk_test', successUrl: 'https://afromarket.example.com/return', fetchImpl });

  await assert.rejects(
    () => provider.initiatePayment({ amount: -1, currency: 'EUR', reference: 'x', customerEmail: 'jane@example.com' }),
    /Stripe initiatePayment failed/
  );
});

test('StripeProvider checkStatus maps a paid session to COMPLETED', async () => {
  const { fetchImpl, calls } = makeFetch([{ status: 200, body: { id: 'cs_test_1', payment_status: 'paid' } }]);

  const provider = new StripeProvider({ secretKey: 'sk_test', fetchImpl });
  const result = await provider.checkStatus('cs_test_1');

  assert.match(calls[0].url, /\/checkout\/sessions\/cs_test_1$/);
  assert.equal(result.status, 'COMPLETED');
});

test('StripeProvider checkStatus maps an unpaid, non-expired session to PENDING', async () => {
  const { fetchImpl } = makeFetch([{ status: 200, body: { id: 'cs_test_2', payment_status: 'unpaid', status: 'open' } }]);

  const provider = new StripeProvider({ secretKey: 'sk_test', fetchImpl });
  const result = await provider.checkStatus('cs_test_2');

  assert.equal(result.status, 'PENDING');
});

test('StripeProvider checkStatus maps an expired session to FAILED', async () => {
  const { fetchImpl } = makeFetch([{ status: 200, body: { id: 'cs_test_3', payment_status: 'unpaid', status: 'expired' } }]);

  const provider = new StripeProvider({ secretKey: 'sk_test', fetchImpl });
  const result = await provider.checkStatus('cs_test_3');

  assert.equal(result.status, 'FAILED');
});

test('StripeProvider verifyWebhook accepts a correctly-signed payload and rejects a mismatched one', () => {
  const secret = 'whsec_test';
  const rawBody = '{"id":"evt_1"}';
  const provider = new StripeProvider({ secretKey: 'sk_test', webhookSecret: secret, fetchImpl: async () => ({}) });

  const goodHeader = stripeSignatureHeader(secret, rawBody);
  assert.equal(provider.verifyWebhook(rawBody, goodHeader), true);

  const badHeader = stripeSignatureHeader('wrong-secret', rawBody);
  assert.equal(provider.verifyWebhook(rawBody, badHeader), false);

  assert.equal(provider.verifyWebhook(rawBody, undefined), false);
});

test('StripeProvider verifyWebhook accepts a match against any v1 signature during a secret rotation (multiple v1= values, and tolerates whitespace after commas)', () => {
  const oldSecret = 'whsec_old';
  const newSecret = 'whsec_new';
  const rawBody = '{"id":"evt_rotation"}';
  const timestamp = Math.floor(Date.now() / 1000);

  const oldSig = crypto.createHmac('sha256', oldSecret).update(`${timestamp}.${rawBody}`).digest('hex');
  const newSig = crypto.createHmac('sha256', newSecret).update(`${timestamp}.${rawBody}`).digest('hex');
  // Stripe sends one v1= per active secret during rotation, with a space
  // after each comma - both must be tolerated.
  const header = `t=${timestamp}, v1=${oldSig}, v1=${newSig}`;

  const providerWithNewSecret = new StripeProvider({ secretKey: 'sk_test', webhookSecret: newSecret, fetchImpl: async () => ({}) });
  assert.equal(providerWithNewSecret.verifyWebhook(rawBody, header), true);

  const providerWithOldSecret = new StripeProvider({ secretKey: 'sk_test', webhookSecret: oldSecret, fetchImpl: async () => ({}) });
  assert.equal(providerWithOldSecret.verifyWebhook(rawBody, header), true);

  const providerWithUnrelatedSecret = new StripeProvider({ secretKey: 'sk_test', webhookSecret: 'whsec_unrelated', fetchImpl: async () => ({}) });
  assert.equal(providerWithUnrelatedSecret.verifyWebhook(rawBody, header), false);
});

test('StripeProvider verifyWebhook rejects a signature outside the replay-tolerance window', () => {
  const secret = 'whsec_test';
  const rawBody = '{"id":"evt_1"}';
  const provider = new StripeProvider({ secretKey: 'sk_test', webhookSecret: secret, fetchImpl: async () => ({}) });

  const oldTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1h old, well past the default 5min tolerance
  const staleHeader = stripeSignatureHeader(secret, rawBody, oldTimestamp);
  assert.equal(provider.verifyWebhook(rawBody, staleHeader), false);
});

test('StripeProvider parseWebhook extracts session id, client_reference_id, status, amount and eventId from a checkout.session.completed event', () => {
  const provider = new StripeProvider({ secretKey: 'sk_test', fetchImpl: async () => ({}) });

  const parsed = provider.parseWebhook({
    id: 'evt_123',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_abc123',
        client_reference_id: 'AM-ORDER1',
        payment_status: 'paid',
        amount_total: 2740
      }
    }
  });

  assert.equal(parsed.transactionId, 'cs_test_abc123');
  assert.equal(parsed.externalRef, 'AM-ORDER1');
  assert.equal(parsed.status, 'COMPLETED');
  assert.equal(parsed.amount, 27.4);
  assert.equal(parsed.eventId, 'evt_123');
});

test('computeHmacSha256Hex sanity check used by the Stripe signature helper', () => {
  const sig = computeHmacSha256Hex('secret', '1700000000.{}');
  assert.equal(typeof sig, 'string');
  assert.equal(sig.length, 64);
});
