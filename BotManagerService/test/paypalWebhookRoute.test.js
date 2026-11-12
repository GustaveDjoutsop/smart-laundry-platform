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
const { PaymentStatusWorker } = require('../src/core/payments/paymentStatusWorker');

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

// See afromarket-dual-completion-trigger-and-contact-field.md. "Verified
// webhook" here means either the real signed webhook delivery, or
// PaymentStatusWorker's own backstop poll (which independently re-verifies
// against PayPal's own API rather than trusting anything from the customer's
// browser) - never an unsigned/unverifiable request. This test proves the
// unsigned case specifically: a failed-signature delivery must never reach
// recordPaypalCapture or emit payment.completed, not just return a 403.
test('shouldOnlyCompleteOrderViaVerifiedWebhook', async () => {
  const { store, events, gateway } = getPaymentService();
  const worker = new PaymentStatusWorker({ gateway, store, events, botRegistry: { getBotByName: () => null } });
  worker.start();

  let completedCount = 0;
  const onCompleted = () => {
    completedCount += 1;
  };
  events.on('payment.completed', onCompleted);

  await store.upsertPayment({
    botId: 'afromarket',
    transactionId: 'ORDER-UNVERIFIED-1',
    provider: 'paypal',
    status: 'PENDING',
    metadata: { service: 'afromarket_order', orderNumber: 'AM-UNVERIFIED-1' }
  });

  currentFetchImpl = async (url) => {
    if (String(url).includes('/oauth2/token')) return TOKEN_RESPONSE;
    if (String(url).includes('/v1/notifications/verify-webhook-signature')) {
      return { ok: true, status: 200, json: async () => ({ verification_status: 'FAILURE' }) };
    }
    throw new Error(`Unexpected fetch call: ${url} - an unverified webhook must never reach captureOrder`);
  };

  const server = await startServer();
  try {
    const res = await post(
      server,
      '/payments/webhooks/paypal/afromarket',
      { id: 'WH-EVT-UNVERIFIED-1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'ORDER-UNVERIFIED-1' } },
      {
        'paypal-transmission-id': 't-unverified',
        'paypal-transmission-time': '2026-01-01T00:00:00Z',
        'paypal-cert-url': 'https://api.paypal.com/cert',
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-transmission-sig': 'sig'
      }
    );

    assert.equal(res.status, 403);
    assert.equal(completedCount, 0, 'an unverified webhook must never trigger payment.completed');

    const payment = await store.getPayment({ botId: 'afromarket', transactionId: 'ORDER-UNVERIFIED-1' });
    assert.equal(payment.status, 'PENDING', 'the payment record itself must be untouched');
  } finally {
    events.off('payment.completed', onCompleted);
    worker.stop();
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
          status: 'COMPLETED',
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

// See afromarket-dual-completion-trigger-and-contact-field.md. Named per the
// doc's original hypothesis (the customer's browser hitting /payment-return
// racing the webhook), but traced and confirmed that isn't the actual
// mechanism - /payment-return has zero side effects (see paymentReturn.test.js's
// shouldNotTriggerOrderCompletionFromPaymentReturnRoute), so it cannot
// participate in any race at all. The two triggers exercised here instead are
// the ones actually observed in production logs: the real webhook delivery
// and PaymentStatusWorker's own backstop poll (PayPal's checkStatus
// self-heal), both hitting the same transaction.
//
// IMPORTANT what this test does and doesn't prove: the poll below runs
// strictly *after* the webhook's HTTP response has fully resolved, so by the
// time it reads the payment's status, the webhook's write has already
// landed - this is deliberately sequential, not a genuine race, and it
// passes via the pre-existing (unchanged by this fix) previousStatus-
// resolves-to-COMPLETED short-circuit in _onStatus, never even reaching the
// new _claimTerminalEmission claim. It's still worth keeping as an honest,
// deterministic proof of the doc's literal requirement ("even if both paths
// are hit for the same transaction ID, completion executes exactly once")
// at the real HTTP/webhook-route level - but it is NOT a regression test for
// the actual race. That coverage lives entirely in paymentStatusWorker.
// test.js's two direct _onStatus tests, which force both racing calls to
// carry the same stale previousStatus and do exercise _claimTerminalEmission.
test('shouldNotDoubleProcessWhenWebhookAndReturnFireForSameTransaction', async () => {
  const { store, events, gateway } = getPaymentService();
  const worker = new PaymentStatusWorker({ gateway, store, events, botRegistry: { getBotByName: () => null } });
  // start() is what actually registers _onStatus as a payment.status
  // listener - both the webhook route and _pollOnce below only emit
  // payment.status themselves, they don't call _onStatus directly.
  worker.start();

  let completedCount = 0;
  const onCompleted = () => {
    completedCount += 1;
  };
  events.on('payment.completed', onCompleted);

  await store.upsertPayment({
    botId: 'afromarket',
    transactionId: 'ORDER-DUAL-TRIGGER-1',
    provider: 'paypal',
    status: 'PENDING',
    metadata: { service: 'afromarket_order', orderNumber: 'AM-DUAL-1', cart: [{ productId: 'x', qty: 1 }] }
  });

  const captureResponse = {
    ok: true,
    status: 201,
    json: async () => ({
      status: 'COMPLETED',
      payer: { name: { given_name: 'Jane', surname: 'Doe' } },
      purchase_units: [
        {
          reference_id: 'AM-DUAL-1',
          shipping: { address: { address_line_1: '12 Main St', postal_code: '10115', admin_area_2: 'Berlin', country_code: 'DE' } },
          payments: { captures: [{ id: 'CAPTURE-DUAL-1', status: 'COMPLETED', amount: { currency_code: 'EUR', value: '27.40' } }] }
        }
      ]
    })
  };
  currentFetchImpl = verifySuccessFetch([captureResponse]);

  const server = await startServer();
  try {
    // Trigger 1: the real, verified webhook.
    const webhookRes = await post(
      server,
      '/payments/webhooks/paypal/afromarket',
      { id: 'WH-EVT-DUAL-1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'ORDER-DUAL-TRIGGER-1' } },
      {
        'paypal-transmission-id': 't-dual',
        'paypal-transmission-time': '2026-01-01T00:00:00Z',
        'paypal-cert-url': 'https://api.paypal.com/cert',
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-transmission-sig': 'sig'
      }
    );
    assert.equal(webhookRes.status, 200);

    // Trigger 2: PaymentStatusWorker's own backstop poll landing shortly
    // after - by now PayPal's real order status has moved off APPROVED
    // (matches production: the order was already captured by trigger 1), so
    // no second capture call happens - just a status re-read.
    currentFetchImpl = verifySuccessFetch([{ ok: true, status: 200, json: async () => ({ status: 'COMPLETED' }) }]);
    await worker._pollOnce({ botId: 'afromarket', provider: 'paypal', transactionId: 'ORDER-DUAL-TRIGGER-1' });

    assert.equal(completedCount, 1, 'payment.completed must fire exactly once across both triggers, not once per trigger');
  } finally {
    events.off('payment.completed', onCompleted);
    worker.stop();
    server.close();
  }
});

test('CHECKOUT.ORDER.APPROVED is skipped without capturing when payment is already FAILED (e.g. timeout)', async () => {
  const { store } = getPaymentService();

  // Pre-seed a payment that timed out (PaymentStatusWorker wrote FAILED before
  // the buyer finished approving the PayPal order).
  await store.upsertPayment({
    botId: 'afromarket',
    transactionId: 'ORDER-TIMEOUT-1',
    provider: 'paypal',
    status: 'FAILED',
    failureReason: 'TIMEOUT',
    metadata: { service: 'afromarket_order' }
  });

  // verifySuccessFetch with an empty list: captureOrder must NOT be called
  // at all - any unexpected fetch call (e.g. /v2/checkout/orders/.../capture)
  // will throw and fail the test.
  currentFetchImpl = verifySuccessFetch([]);

  const server = await startServer();
  try {
    const res = await post(
      server,
      '/payments/webhooks/paypal/afromarket',
      { id: 'WH-EVT-TIMEOUT-1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'ORDER-TIMEOUT-1' } },
      {
        'paypal-transmission-id': 't-timeout',
        'paypal-transmission-time': '2026-01-01T00:00:00Z',
        'paypal-cert-url': 'https://api.paypal.com/cert',
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-transmission-sig': 'sig'
      }
    );
    assert.equal(res.status, 200);
    assert.equal(res.body && res.body.skipped, 'payment_already_terminal');

    // Payment must remain FAILED, not transition to any other state.
    const payment = await store.getPayment({ botId: 'afromarket', transactionId: 'ORDER-TIMEOUT-1' });
    assert.equal(payment.status, 'FAILED');
    assert.equal(payment.failureReason, 'TIMEOUT');
  } finally {
    server.close();
  }
});

// The exact 2026-11-11 production leak, end to end. PR #293 guarded
// CHECKOUT.ORDER.APPROVED, but PAYMENT.CAPTURE.COMPLETED arrives as its own
// later delivery and had no guard at all - it wrote COMPLETED straight over
// the FAILED/TIMEOUT record, which also neutered PaymentStatusWorker's own
// belt-and-suspenders check (that read the status back *after* the write).
// Result: "❌ Paiement échoué (TIMEOUT)" at 22:58 local, then "✅ Payment
// received!" at 23:18 for the same order. See
// docs/bugfixes/afromarket-paypal-terminal-state-bugfix.md.
test('PAYMENT.CAPTURE.COMPLETED after a timeout must not complete the payment', async () => {
  const { store, events, gateway } = getPaymentService();
  const worker = new PaymentStatusWorker({ gateway, store, events, botRegistry: { getBotByName: () => null } });
  worker.start();

  let completedCount = 0;
  const onCompleted = () => {
    completedCount += 1;
  };
  events.on('payment.completed', onCompleted);

  await store.upsertPayment({
    botId: 'afromarket',
    transactionId: 'ORDER-LATE-CAPTURE-1',
    provider: 'paypal',
    status: 'FAILED',
    failureReason: 'TIMEOUT',
    amount: 39.94,
    currency: 'EUR',
    metadata: { service: 'afromarket_order', orderNumber: 'AM-LATE-CAPTURE-1' }
  });

  currentFetchImpl = verifySuccessFetch([]);

  const server = await startServer();
  try {
    const res = await post(
      server,
      '/payments/webhooks/paypal/afromarket',
      {
        id: 'WH-EVT-LATE-CAPTURE-1',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: 'CAPTURE-LATE-1',
          status: 'COMPLETED',
          amount: { value: '39.94', currency_code: 'EUR' },
          supplementary_data: { related_ids: { order_id: 'ORDER-LATE-CAPTURE-1' } }
        }
      },
      {
        'paypal-transmission-id': 't-late-capture',
        'paypal-transmission-time': '2026-11-11T22:18:55Z',
        'paypal-cert-url': 'https://api.paypal.com/cert',
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-transmission-sig': 'sig'
      }
    );

    assert.equal(res.status, 200, 'PayPal must still get a 200 so it stops retrying');
    assert.equal(res.body && res.body.blocked, 'payment_already_failed');
    assert.equal(completedCount, 0, 'payment.completed must NOT fire - this is what sent "Payment received!" to a dead order');

    const payment = await store.getPayment({ botId: 'afromarket', transactionId: 'ORDER-LATE-CAPTURE-1' });
    assert.equal(payment.status, 'FAILED', 'the payment must stay FAILED');
    assert.equal(payment.failureReason, 'TIMEOUT');
    assert.equal(payment.capturedAfterTerminal, true, 'the captured money must be flagged, not silently dropped');

    const queued = await store.getCapturedAfterTerminal({ botId: 'afromarket' });
    assert.ok(
      queued.some((entry) => entry.transactionId === 'ORDER-LATE-CAPTURE-1'),
      'the payment must land in the manual-review queue'
    );
  } finally {
    events.off('payment.completed', onCompleted);
    worker.stop();
    server.close();
  }
});

// 2026-11-12: the PayPal webhook was registered against two URLs on different
// deployments. The instance that created the order had timed it out and
// refused to capture (payment_already_failed, 46-byte response); the other had
// no record of the payment at all, so every terminal guard passed vacuously -
// it captured EUR 35.95 and EUR 43.94 and then reported the capture back as
// payment_already_completed (49-byte response). Capturing is the step that
// moves real money, so "I have never heard of this payment" must fail closed.
test('CHECKOUT.ORDER.APPROVED for a payment this instance has no record of must not capture', async () => {
  const { store, events, gateway } = getPaymentService();
  const worker = new PaymentStatusWorker({ gateway, store, events, botRegistry: { getBotByName: () => null } });
  worker.start();

  let completedCount = 0;
  const onCompleted = () => {
    completedCount += 1;
  };
  events.on('payment.completed', onCompleted);

  // No upsertPayment and no terminal marker: this instance never saw the order.
  // verifySuccessFetch with an empty list - any call to captureOrder throws.
  currentFetchImpl = verifySuccessFetch([]);

  const server = await startServer();
  try {
    const res = await post(
      server,
      '/payments/webhooks/paypal/afromarket',
      { id: 'WH-EVT-FOREIGN-1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'ORDER-FOREIGN-1' } },
      {
        'paypal-transmission-id': 't-foreign',
        'paypal-transmission-time': '2026-11-12T18:46:24Z',
        'paypal-cert-url': 'https://api.paypal.com/cert',
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-transmission-sig': 'sig'
      }
    );

    assert.equal(res.status, 200, 'PayPal must still get a 200 so it stops retrying');
    assert.equal(res.body && res.body.skipped, 'payment_unknown_to_this_instance');
    assert.equal(completedCount, 0);

    const payment = await store.getPayment({ botId: 'afromarket', transactionId: 'ORDER-FOREIGN-1' });
    assert.equal(payment, null, 'an unknown payment must not be conjured into existence by a webhook');
  } finally {
    events.off('payment.completed', onCompleted);
    worker.stop();
    server.close();
  }
});
