const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../src/app');
const { paymentEvents } = require('../src/core/payments/paymentEvents');

async function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

test('GET /payment-return shows a friendly landing page instead of 404ing', async () => {
  const app = createApp({});

  const { server, port } = await startServer(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/payment-return`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');

    const body = await res.text();
    assert.match(body, /Payment received/);
    assert.match(body, /close this tab/i);
  } finally {
    await stopServer(server);
  }
});

// See afromarket-dual-completion-trigger-and-contact-field.md - a customer's
// browser hitting this route is not a verified signal (no signature, and the
// token+PayerID query string is directly guessable/replayable/refreshable),
// so it must never be a trigger for order-completion logic - only the
// verified webhook path (and PaymentStatusWorker's own backstop poll, which
// independently re-verifies against PayPal's API rather than trusting the
// browser) may do that. Traced: app.js's /payment-return handler only ever
// calls res.set/res.status/res.type/res.send on a hardcoded HTML string - it
// never touches paymentEvents, the payment gateway/store, or any bot. This
// test proves that from the outside (hitting the real route, exactly as a
// customer's browser or a replayed/guessed URL would), not just by reading
// the handler.
test('shouldNotTriggerOrderCompletionFromPaymentReturnRoute', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);

  const emittedEvents = [];
  const captureEvent = (eventName) => (payload) => emittedEvents.push({ eventName, payload });
  const onCompleted = captureEvent('payment.completed');
  const onStatus = captureEvent('payment.status');
  paymentEvents.on('payment.completed', onCompleted);
  paymentEvents.on('payment.status', onStatus);

  try {
    // A realistic PayPal-shaped return URL, including a guessed/replayed-
    // looking token+PayerID - the route must ignore these entirely, not
    // parse or act on them.
    const res = await fetch(`http://127.0.0.1:${port}/payment-return?token=FAKE-ORDER-ID&PayerID=FAKE-PAYER-ID`);
    assert.equal(res.status, 200);

    assert.equal(emittedEvents.length, 0, '/payment-return must never emit any payment event, verified or not');
  } finally {
    paymentEvents.off('payment.completed', onCompleted);
    paymentEvents.off('payment.status', onStatus);
    await stopServer(server);
  }
});
