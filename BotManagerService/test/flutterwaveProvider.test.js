const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { FlutterwaveProvider } = require('../src/core/payments/providers/flutterwaveProvider');

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

test('FlutterwaveProvider isConfigured reflects secretKey presence', () => {
  const configured = new FlutterwaveProvider({ secretKey: 'FLWSECK_TEST', fetchImpl: async () => ({}) });
  const unconfigured = new FlutterwaveProvider({ fetchImpl: async () => ({}) });

  assert.equal(configured.isConfigured(), true);
  assert.equal(unconfigured.isConfigured(), false);
});

test('FlutterwaveProvider initiatePayment posts a hosted-checkout request and returns the payment link', async () => {
  const { fetchImpl, calls } = makeFetch([
    { status: 200, body: { status: 'success', data: { link: 'https://checkout.flutterwave.com/v3/hosted/pay/abc123' } } }
  ]);

  const provider = new FlutterwaveProvider({
    secretKey: 'FLWSECK_TEST',
    redirectUrl: 'https://afromarket.example.com/payment-return',
    fetchImpl
  });

  const result = await provider.initiatePayment({
    amount: 27.4,
    currency: 'EUR',
    reference: 'AM-ORDER1',
    description: 'AfroMarket order AM-ORDER1',
    customerEmail: 'jane@example.com',
    customerName: 'Jane Doe',
    phoneNumber: '+491701234567'
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.flutterwave.com/v3/payments');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer FLWSECK_TEST');

  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.tx_ref, 'AM-ORDER1');
  assert.equal(payload.amount, 27.4);
  assert.equal(payload.currency, 'EUR');
  assert.equal(payload.redirect_url, 'https://afromarket.example.com/payment-return');
  assert.equal(payload.customer.email, 'jane@example.com');
  assert.equal(payload.customer.name, 'Jane Doe');

  assert.equal(result.transactionId, 'AM-ORDER1');
  assert.equal(result.status, 'PENDING');
  assert.equal(result.checkoutUrl, 'https://checkout.flutterwave.com/v3/hosted/pay/abc123');
});

test('FlutterwaveProvider initiatePayment rejects when customerEmail is missing', async () => {
  const provider = new FlutterwaveProvider({
    secretKey: 'FLWSECK_TEST',
    redirectUrl: 'https://afromarket.example.com/payment-return',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ status: 'success', data: {} }) })
  });

  await assert.rejects(
    () => provider.initiatePayment({ amount: 10, reference: 'x', phoneNumber: '+491701234567' }),
    /customerEmail/
  );
});

test('FlutterwaveProvider initiatePayment rejects when no redirectUrl is configured', async () => {
  const provider = new FlutterwaveProvider({
    secretKey: 'FLWSECK_TEST',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ status: 'success', data: {} }) })
  });

  await assert.rejects(
    () => provider.initiatePayment({ amount: 10, reference: 'x', customerEmail: 'jane@example.com' }),
    /redirectUrl/
  );
});

test('FlutterwaveProvider initiatePayment throws on a non-success API response', async () => {
  const { fetchImpl } = makeFetch([{ status: 400, body: { status: 'error', message: 'Invalid amount' } }]);

  const provider = new FlutterwaveProvider({
    secretKey: 'FLWSECK_TEST',
    redirectUrl: 'https://afromarket.example.com/payment-return',
    fetchImpl
  });

  await assert.rejects(
    () => provider.initiatePayment({ amount: -1, reference: 'x', customerEmail: 'jane@example.com' }),
    /Flutterwave initiatePayment failed/
  );
});

test('FlutterwaveProvider checkStatus maps SUCCESSFUL to COMPLETED', async () => {
  const { fetchImpl, calls } = makeFetch([
    { status: 200, body: { status: 'success', data: { status: 'successful', tx_ref: 'AM-ORDER1' } } }
  ]);

  const provider = new FlutterwaveProvider({ secretKey: 'FLWSECK_TEST', fetchImpl });
  const result = await provider.checkStatus('AM-ORDER1');

  assert.match(calls[0].url, /\/transactions\/verify_by_reference\?tx_ref=AM-ORDER1$/);
  assert.equal(result.transactionId, 'AM-ORDER1');
  assert.equal(result.status, 'COMPLETED');
});

test('FlutterwaveProvider checkStatus maps a pending status through unchanged', async () => {
  const { fetchImpl } = makeFetch([{ status: 200, body: { status: 'success', data: { status: 'pending' } } }]);

  const provider = new FlutterwaveProvider({ secretKey: 'FLWSECK_TEST', fetchImpl });
  const result = await provider.checkStatus('AM-ORDER2');

  assert.equal(result.status, 'PENDING');
});

test('FlutterwaveProvider verifyWebhook accepts a matching verif-hash and rejects a mismatched one', () => {
  const provider = new FlutterwaveProvider({
    secretKey: 'FLWSECK_TEST',
    webhookSecretHash: 'my-dashboard-secret',
    fetchImpl: async () => ({})
  });

  assert.equal(provider.verifyWebhook({}, 'my-dashboard-secret'), true);
  assert.equal(provider.verifyWebhook({}, 'wrong-secret'), false);
  assert.equal(provider.verifyWebhook({}, undefined), false);
});

test('FlutterwaveProvider verifyWebhook is not fooled by a timing-unsafe length mismatch', () => {
  const provider = new FlutterwaveProvider({
    secretKey: 'FLWSECK_TEST',
    webhookSecretHash: crypto.randomBytes(32).toString('hex'),
    fetchImpl: async () => ({})
  });

  assert.equal(provider.verifyWebhook({}, 'short'), false);
});

test('FlutterwaveProvider parseWebhook extracts tx_ref, status and amount from a charge.completed event', () => {
  const provider = new FlutterwaveProvider({ secretKey: 'FLWSECK_TEST', fetchImpl: async () => ({}) });

  const parsed = provider.parseWebhook({
    event: 'charge.completed',
    data: {
      id: 285959875,
      tx_ref: 'AM-ORDER1',
      amount: 27.4,
      currency: 'EUR',
      status: 'successful'
    }
  });

  assert.equal(parsed.transactionId, 'AM-ORDER1');
  assert.equal(parsed.externalRef, 'AM-ORDER1');
  assert.equal(parsed.status, 'COMPLETED');
  assert.equal(parsed.amount, 27.4);
});
