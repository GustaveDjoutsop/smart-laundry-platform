// Exercises POST /payments/webhooks/paypal/:botId end-to-end over real HTTP
// (the one piece of Workstream 2 not already covered by paypalProvider.test.js's
// unit-level coverage or afromarketPaypalCheckout.test.js's checkout-initiation
// coverage): the CHECKOUT.ORDER.APPROVED -> captureOrder -> recordPaypalCapture
// orchestration, and the PAYMENT.CAPTURE.COMPLETED -> gateway.handleWebhook path.
// No existing route-level webhook test exists in this repo to mirror (stripe/campay
// have provider-level tests only), so this builds the smallest harness that still
// exercises the real express.json rawBody wiring signature verification needs -
// not a reimplementation of app.js's full middleware stack.
process.env.SANDBOX_PAYPAL_CLIENT_ID = 'paypal-client-id-test';
process.env.SANDBOX_PAYPAL_CLIENT_SECRET = 'paypal-client-secret-test';
process.env.SANDBOX_PAYPAL_WEBHOOK_ID = 'WH-TEST';
process.env.PAYPAL_RETURN_URL = 'https://afromarket.example.com/payment-return';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Captured before global.fetch is overridden below - the test's own HTTP
// client (post()) must reach the real network/loopback server, not get
// redirected into the same mock meant only for the provider's outbound
// PayPal API calls.
const realFetch = global.fetch;

let currentFetchImpl = async () => {
  throw new Error('currentFetchImpl not set for this test');
};
global.fetch = (...args) => currentFetchImpl(...args);

const { paymentsRouter } = require('../src/routes/payments');
const { getPaymentService } = require('../src/core/payments/paymentService');

const TOKEN_RESPONSE = { ok: true, status: 200, json: async () => ({ access_token: 'access-token-abc', expires_in: 32000 }) };

function startServer() {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app.use('/payments', paymentsRouter());

  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function post(server, path, body, headers) {
  const port = server.address().port;
  const res = await realFetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function verifySuccessFetch(nextResponses) {
  return async (url, init) => {
    if (String(url).includes('/oauth2/token')) return TOKEN_RESPONSE;
    if (String(url).includes('/v1/notifications/verify-webhook-signature')) {
      return { ok: true, status: 200, json: async () => ({ verification_status: 'SUCCESS' }) };
    }
    const next = nextResponses.shift();
    if (!next) throw new Error(`Unexpected fetch call: ${url} ${init && init.method}`);
    return next;
  };
}

test('POST /webhooks/paypal/:botId rejects when signature verification fails', async () => {
  currentFetchImpl = async (url) => {
    if (String(url).includes('/oauth2/token')) return TOKEN_RESPONSE;
    if (String(url).includes('/v1/notifications/verify-webhook-signature')) {
      return { ok: true, status: 200, json: async () => ({ verification_status: 'FAILURE' }) };
    }
    throw new Error(`Unexpected fetch call: ${url}`);
  };

  const server = await startServer();
  try {
    const res = await post(
      server,
      '/payments/webhooks/paypal/afromarket',
      { id: 'WH-EVT-1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'ORDER-1' } },
      {
        'paypal-transmission-id': 't1',
        'paypal-transmission-time': '2026-01-01T00:00:00Z',
        'paypal-cert-url': 'https://api.paypal.com/cert',
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-transmission-sig': 'sig'
      }
    );

    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});

test('POST /webhooks/paypal/:botId rejects when signature headers are entirely missing (fail closed, same as Stripe route)', async () => {
  currentFetchImpl = async (url) => {
    if (String(url).includes('/oauth2/token')) return TOKEN_RESPONSE;
    throw new Error(`Unexpected fetch call: ${url} - verification should fail before any PayPal API call`);
  };

  const server = await startServer();
  try {
    const res = await post(server, '/payments/webhooks/paypal/afromarket', {
      id: 'WH-EVT-1',
      event_type: 'CHECKOUT.ORDER.APPROVED',
      resource: { id: 'ORDER-1' }
    });

    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});

test('CHECKOUT.ORDER.APPROVED captures the order and folds payer/shipping into the stored payment metadata without clobbering the pre-payment cart/name/address', async () => {
  const { store } = getPaymentService();
  await store.upsertPayment({
    botId: 'afromarket',
    transactionId: 'ORDER-APPROVE-1',
    provider: 'paypal',
    status: 'PENDING',
    metadata: { service: 'afromarket_order', orderNumber: 'AM-1', cart: [{ productId: 'x', qty: 1 }], name: 'Chat Name', address: 'Chat Address' }
  });

  currentFetchImpl = verifySuccessFetch([
    {
      ok: true,
      status: 201,
      json: async () => ({
        status: 'COMPLETED',
        payer: { name: { given_name: 'Jane', surname: 'Doe' } },
        purchase_units: [
          {
            reference_id: 'AM-1',
            shipping: { address: { address_line_1: '12 Main St', postal_code: '10115', admin_area_2: 'Berlin', country_code: 'DE' } },
            payments: { captures: [{ id: 'CAPTURE-1', status: 'COMPLETED', amount: { currency_code: 'EUR', value: '27.40' } }] }
          }
        ]
      })
    }
  ]);

  const server = await startServer();
  try {
    const res = await post(
      server,
      '/payments/webhooks/paypal/afromarket',
      { id: 'WH-EVT-APPROVE-1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'ORDER-APPROVE-1' } },
      {
        'paypal-transmission-id': 't1',
        'paypal-transmission-time': '2026-01-01T00:00:00Z',
        'paypal-cert-url': 'https://api.paypal.com/cert',
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-transmission-sig': 'sig'
      }
    );
    assert.equal(res.status, 200);

    const payment = await store.getPayment({ botId: 'afromarket', transactionId: 'ORDER-APPROVE-1' });
    assert.equal(payment.status, 'COMPLETED');
    assert.equal(payment.amount, 27.4);
    assert.equal(payment.metadata.paypalPayerName, 'Jane Doe');
    assert.equal(payment.metadata.paypalShippingAddress, '12 Main St, 10115 Berlin, DE');
    // Original pre-payment metadata must survive the merge, not be replaced.
    assert.equal(payment.metadata.orderNumber, 'AM-1');
    assert.deepEqual(payment.metadata.cart, [{ productId: 'x', qty: 1 }]);
  } finally {
    server.close();
  }
});

test('CHECKOUT.ORDER.APPROVED with a 2xx capture response that is still PENDING (e.g. eCheck clearing) does not record the order as COMPLETED', async () => {
  const { store } = getPaymentService();
  await store.upsertPayment({
    botId: 'afromarket',
    transactionId: 'ORDER-PENDING-1',
    provider: 'paypal',
    status: 'PENDING',
    metadata: { service: 'afromarket_order', orderNumber: 'AM-PENDING-1' }
  });

  // HTTP-level success (captureOrder's `ok`), but the capture itself is not
  // COMPLETED - the exact case findings flagged as previously hardcoded away.
  currentFetchImpl = verifySuccessFetch([
    {
      ok: true,
      status: 201,
      json: async () => ({
        status: 'PENDING',
        payer: { name: { given_name: 'Jane', surname: 'Doe' } },
        purchase_units: [
          {
            reference_id: 'AM-PENDING-1',
            payments: { captures: [{ id: 'CAPTURE-PENDING-1', status: 'PENDING', amount: { currency_code: 'EUR', value: '27.40' } }] }
          }
        ]
      })
    }
  ]);

  const server = await startServer();
  try {
    const res = await post(
      server,
      '/payments/webhooks/paypal/afromarket',
      { id: 'WH-EVT-PENDING-1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'ORDER-PENDING-1' } },
      {
        'paypal-transmission-id': 't-pending',
        'paypal-transmission-time': '2026-01-01T00:00:00Z',
        'paypal-cert-url': 'https://api.paypal.com/cert',
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-transmission-sig': 'sig'
      }
    );
    assert.equal(res.status, 200);

    const payment = await store.getPayment({ botId: 'afromarket', transactionId: 'ORDER-PENDING-1' });
    assert.equal(payment.status, 'PENDING', 'a PENDING capture must not be recorded as COMPLETED just because the HTTP call succeeded');
  } finally {
    server.close();
  }
});

test('CHECKOUT.ORDER.APPROVED with a captureOrder failure does not throw and still returns 200 (PayPal must not endlessly retry a permanent decline)', async () => {
  currentFetchImpl = verifySuccessFetch([{ ok: false, status: 422, json: async () => ({ name: 'UNPROCESSABLE_ENTITY' }) }]);

  const server = await startServer();
  try {
    const res = await post(
      server,
      '/payments/webhooks/paypal/afromarket',
      { id: 'WH-EVT-APPROVE-2', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'ORDER-APPROVE-2' } },
      {
        'paypal-transmission-id': 't2',
        'paypal-transmission-time': '2026-01-01T00:00:00Z',
        'paypal-cert-url': 'https://api.paypal.com/cert',
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-transmission-sig': 'sig'
      }
    );
    assert.equal(res.status, 200);
  } finally {
    server.close();
  }
});

test('PAYMENT.CAPTURE.COMPLETED is recorded as a duplicate-safe second signal, not a second order-processing trigger', async () => {
  const { store } = getPaymentService();
  // Simulate the capture-response event having already landed first (as it
  // normally would, since it's synchronous with the CHECKOUT.ORDER.APPROVED
  // webhook, well before PayPal's own PAYMENT.CAPTURE.COMPLETED delivery).
  const first = await store.appendEvent({
    botId: 'afromarket',
    transactionId: 'ORDER-DUP-1',
    provider: 'paypal',
    eventId: 'capture-response:CAPTURE-DUP-1',
    eventType: 'payment_completed',
    status: 'COMPLETED',
    amount: 10,
    metadata: { service: 'afromarket_order' }
  });
  assert.equal(first.duplicate, false);
  assert.equal(first.previousStatus, null);

  currentFetchImpl = verifySuccessFetch([]);

  const server = await startServer();
  try {
    const res = await post(
      server,
      '/payments/webhooks/paypal/afromarket',
      {
        id: 'WH-EVT-CAPTURE-DUP-1',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: 'CAPTURE-DUP-1',
          custom_id: 'AM-DUP-1',
          amount: { currency_code: 'EUR', value: '10.00' },
          supplementary_data: { related_ids: { order_id: 'ORDER-DUP-1' } }
        }
      },
      {
        'paypal-transmission-id': 't3',
        'paypal-transmission-time': '2026-01-01T00:00:00Z',
        'paypal-cert-url': 'https://api.paypal.com/cert',
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-transmission-sig': 'sig'
      }
    );
    assert.equal(res.status, 200);

    // A second, real ledger entry exists (a distinct PayPal event id) - but
    // the payment's *status* is still just COMPLETED, unchanged, which is
    // what PaymentStatusWorker's isSameStatus guard keys off to avoid
    // reprocessing the order a second time.
    const events = await store.getEvents({ botId: 'afromarket', transactionId: 'ORDER-DUP-1' });
    assert.equal(events.length, 2);
    const payment = await store.getPayment({ botId: 'afromarket', transactionId: 'ORDER-DUP-1' });
    assert.equal(payment.status, 'COMPLETED');
  } finally {
    server.close();
  }
});
