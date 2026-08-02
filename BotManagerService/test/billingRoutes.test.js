// Route-level coverage for the two critical paths flagged in review: the
// webhook must fail closed on a bad/missing signature, and the admin routes
// (which fire real Stripe API calls) must reject unauthenticated callers.
process.env.SANDBOX_SECRET_KEY = 'sk_test_billing';
process.env.SANDBOX_WEBHOOK_SECRET = 'whsec_billing_test';
process.env.STRIPE_BILLING_SUCCESS_URL = 'https://botmanagerservice.example.com/billing/return';
process.env.BILLING_ADMIN_TOKEN = 'admin-token-for-tests';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');

// getBillingService() is a module-level singleton: the StripeBillingProvider
// (and the `global.fetch` reference it captures at construction time) is
// built once, on the first call, and reused for the rest of this file.
// Installing a stable wrapper before that first call - rather than swapping
// global.fetch later - means every test can just repoint what it delegates
// to without a real network call ever reaching api.stripe.com. Same pattern
// as test/afromarketPaymentCheckout.test.js.
//
// Tests in this file also use fetch themselves, to drive real HTTP requests
// against the local test server - that must go through Node's real fetch,
// not this stub, so the native reference is saved first and used explicitly
// (`httpFetch`) everywhere below instead of the bare global `fetch`.
const httpFetch = global.fetch;
let currentFetchImpl = async () => {
  throw new Error('currentFetchImpl not set for this test');
};
global.fetch = (...args) => currentFetchImpl(...args);

const { createApp } = require('../src/app');
const { getBillingService } = require('../src/core/billing/billingService');

function stripeSignatureHeader(secret, rawBody, timestamp = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${timestamp}.${rawBody}`;
  const v1 = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

async function withServer(fn) {
  const app = createApp({});
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('POST /api/billing/:botId/checkout-session rejects a request with no Authorization header', async () => {
  await withServer(async (baseUrl) => {
    const res = await httpFetch(`${baseUrl}/api/billing/route-test-bot-1/checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceId: 'price_pro', email: 'owner@example.com' })
    });

    assert.equal(res.status, 401);
  });
});

test('POST /api/billing/:botId/checkout-session rejects a wrong bearer token', async () => {
  await withServer(async (baseUrl) => {
    const res = await httpFetch(`${baseUrl}/api/billing/route-test-bot-1/checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-the-token' },
      body: JSON.stringify({ priceId: 'price_pro', email: 'owner@example.com' })
    });

    assert.equal(res.status, 401);
  });
});

test('POST /api/billing/webhooks/stripe/:botId rejects a request with no stripe-signature header', async () => {
  await withServer(async (baseUrl) => {
    const res = await httpFetch(`${baseUrl}/api/billing/webhooks/stripe/route-test-bot-2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'evt_no_sig', type: 'invoice.paid' })
    });

    assert.equal(res.status, 403);
  });
});

test('POST /api/billing/webhooks/stripe/:botId rejects an incorrectly-signed payload', async () => {
  await withServer(async (baseUrl) => {
    const rawBody = JSON.stringify({ id: 'evt_bad_sig', type: 'invoice.paid' });
    const res = await httpFetch(`${baseUrl}/api/billing/webhooks/stripe/route-test-bot-3`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': stripeSignatureHeader('wrong-secret', rawBody) },
      body: rawBody
    });

    assert.equal(res.status, 403);
  });
});

test('POST /api/billing/webhooks/stripe/:botId accepts a correctly-signed event for a botId with a matching billing record on file', async () => {
  const botId = 'route-test-bot-4';
  const { store } = getBillingService();
  await store.upsertBilling(botId, { stripeCustomerId: 'cus_route_test' });

  // handleWebhook re-fetches authoritative status via retrieveSubscription -
  // stub that Stripe GET so this test never hits the real network.
  currentFetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ id: 'sub_route_test', status: 'active' }) });

  await withServer(async (baseUrl) => {
    const rawBody = JSON.stringify({
      id: 'evt_route_ok',
      type: 'invoice.paid',
      data: { object: { customer: 'cus_route_test', subscription: 'sub_route_test' } }
    });

    const res = await httpFetch(`${baseUrl}/api/billing/webhooks/stripe/${botId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': stripeSignatureHeader('whsec_billing_test', rawBody) },
      body: rawBody
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  });
});
