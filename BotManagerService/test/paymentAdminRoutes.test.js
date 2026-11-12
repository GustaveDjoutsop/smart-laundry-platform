// The payment operator routes return raw payment records - customerPhone, and
// for PayPal metadata.paypalPayerName / paypalPayerContact /
// paypalShippingAddress. They were previously protected only by transaction-id
// unguessability, and the captured-after-terminal route hands out exactly those
// ids. These tests pin the auth, because a refactor that drops adminAuth from
// one route's chain otherwise breaks nothing visible.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { paymentsRouter } = require('../src/routes/payments');
const { requireAdminToken } = require('../src/middleware/adminAuth');

const ADMIN_TOKEN = 'admin-token-for-test';

const GUARDED_PATHS = [
  '/payments/afromarket/captured-after-terminal',
  '/payments/afromarket/transactions/tx-1',
  '/payments/afromarket/external/AM-1'
];

function startServer(routerOptions) {
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use('/payments', paymentsRouter(routerOptions));

  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function get(server, path, headers) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers: headers || {} });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('the operator routes fail closed when no admin middleware is supplied', async () => {
  const server = await startServer();
  try {
    for (const path of GUARDED_PATHS) {
      const res = await get(server, path);
      assert.equal(res.status, 503, `${path} must not serve payment records without auth configured`);
    }
  } finally {
    server.close();
  }
});

test('the operator routes reject a missing or wrong admin token', async () => {
  const adminAuthMiddleware = requireAdminToken({ token: ADMIN_TOKEN, logger: { warn: () => {} } });
  const server = await startServer({ adminAuthMiddleware });
  try {
    for (const path of GUARDED_PATHS) {
      assert.equal((await get(server, path)).status, 401, `${path} must reject a missing token`);
      assert.equal(
        (await get(server, path, { authorization: 'Bearer wrong-token' })).status,
        401,
        `${path} must reject a wrong token`
      );
    }
  } finally {
    server.close();
  }
});

test('the operator routes serve normally with a valid admin token', async () => {
  const adminAuthMiddleware = requireAdminToken({ token: ADMIN_TOKEN, logger: { warn: () => {} } });
  const server = await startServer({ adminAuthMiddleware });
  try {
    const res = await get(server, '/payments/afromarket/captured-after-terminal', {
      authorization: `Bearer ${ADMIN_TOKEN}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.entries));
  } finally {
    server.close();
  }
});

// Admin-gating must not reach the webhook routes: PayPal/Stripe/CamPay present
// no bearer token, and a 401 there would make a provider retry forever.
test('provider webhook routes stay reachable on a router built without admin middleware', async () => {
  const server = await startServer();
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/payments/webhooks/paypal/afromarket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'WH-NO-AUTH', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} })
    });

    assert.notEqual(res.status, 401, 'a webhook must never be answered with 401');
    assert.notEqual(res.status, 503, 'a webhook must never be gated on the admin token');
  } finally {
    server.close();
  }
});
