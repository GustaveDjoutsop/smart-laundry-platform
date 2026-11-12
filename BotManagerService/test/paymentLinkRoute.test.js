// The payment link we put in WhatsApp points here instead of straight at
// PayPal, because PayPal Orders v2 has no cancel/void endpoint: once the buyer
// holds the real checkout URL, nothing can take it back until PayPal expires
// the order. Checking the payment's state at click time is the only place a
// dead payment can be stopped BEFORE the money moves, rather than refused
// afterwards. See docs/bugfixes/afromarket-paypal-terminal-state-bugfix.md.
process.env.SANDBOX_PAYPAL_CLIENT_ID = 'paypal-client-id-test';
process.env.SANDBOX_PAYPAL_CLIENT_SECRET = 'paypal-client-secret-test';
process.env.SANDBOX_PAYPAL_WEBHOOK_ID = 'WH-TEST';
process.env.PAYPAL_RETURN_URL = 'https://afromarket.example.com/payment-return';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { paymentLinkRouter } = require('../src/routes/paymentLink');
const { getPaymentService } = require('../src/core/payments/paymentService');
const { PaymentGateway } = require('../src/core/payments/paymentGateway');
const { PaymentStatus } = require('../src/core/payments/paymentTypes');

const PAYPAL_URL = 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-LINK-1';

function startServer() {
  const app = express();
  app.use('/pay', paymentLinkRouter());

  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function get(server, path) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { redirect: 'manual' });

  return {
    status: res.status,
    location: res.headers.get('location'),
    cacheControl: res.headers.get('cache-control'),
    body: await res.text()
  };
}

test('a live payment redirects to the provider checkout URL', async () => {
  const { store } = getPaymentService();
  await store.upsertPayment({
    botId: 'afromarket',
    transactionId: 'ORDER-LINK-LIVE',
    provider: 'paypal',
    status: PaymentStatus.PENDING,
    providerCheckoutUrl: PAYPAL_URL
  });

  const server = await startServer();
  try {
    const res = await get(server, '/pay/afromarket/ORDER-LINK-LIVE');

    assert.equal(res.status, 302);
    assert.equal(res.location, PAYPAL_URL);
    // A cached redirect would send the next click straight to PayPal without
    // this check running at all, defeating the whole endpoint.
    assert.equal(res.cacheControl, 'no-store');
  } finally {
    server.close();
  }
});

test('a timed-out payment shows the expired page instead of redirecting', async () => {
  const { store } = getPaymentService();
  await store.upsertPayment({
    botId: 'afromarket',
    transactionId: 'ORDER-LINK-TIMEOUT',
    provider: 'paypal',
    status: PaymentStatus.FAILED,
    failureReason: 'TIMEOUT',
    providerCheckoutUrl: PAYPAL_URL
  });

  const server = await startServer();
  try {
    const res = await get(server, '/pay/afromarket/ORDER-LINK-TIMEOUT');

    assert.equal(res.status, 410);
    assert.equal(res.location, null, 'the customer must never reach PayPal for a dead payment');
    assert.match(res.body, /Payment expired/);
    assert.doesNotMatch(res.body, /paypal\.com/, 'the provider URL must not leak into the page either');
  } finally {
    server.close();
  }
});

test('an already-paid payment says so rather than offering to pay again', async () => {
  const { store } = getPaymentService();
  await store.upsertPayment({
    botId: 'afromarket',
    transactionId: 'ORDER-LINK-PAID',
    provider: 'paypal',
    status: PaymentStatus.COMPLETED,
    providerCheckoutUrl: PAYPAL_URL
  });

  const server = await startServer();
  try {
    const res = await get(server, '/pay/afromarket/ORDER-LINK-PAID');

    assert.equal(res.status, 410);
    assert.equal(res.location, null, 'no second trip to PayPal for an order already paid');
    assert.match(res.body, /Already paid/);
  } finally {
    server.close();
  }
});

// The terminal marker outlives the payment record (30 days vs 24h), so the
// link must stay dead even once the record itself is gone.
test('the link stays dead once the record has expired but the terminal marker has not', async () => {
  const { store } = getPaymentService();
  const { redisManager } = require('../src/core/redisManager');

  await store.upsertPayment({
    botId: 'afromarket',
    transactionId: 'ORDER-LINK-MARKER',
    provider: 'paypal',
    status: PaymentStatus.FAILED,
    failureReason: 'TIMEOUT',
    providerCheckoutUrl: PAYPAL_URL
  });
  await store.markTerminal({ botId: 'afromarket', transactionId: 'ORDER-LINK-MARKER', status: PaymentStatus.FAILED });
  await redisManager.del('payment:afromarket:ORDER-LINK-MARKER');

  const server = await startServer();
  try {
    const res = await get(server, '/pay/afromarket/ORDER-LINK-MARKER');

    assert.equal(res.status, 410);
    assert.equal(res.location, null);
  } finally {
    server.close();
  }
});

test('an unknown link is refused without revealing whether the id ever existed', async () => {
  const server = await startServer();
  try {
    const res = await get(server, '/pay/afromarket/ORDER-LINK-NEVER-EXISTED');

    assert.equal(res.status, 404);
    assert.equal(res.location, null);
    assert.match(res.body, /Link not valid/);
  } finally {
    server.close();
  }
});

test('a payment with no stored provider URL is refused rather than guessed at', async () => {
  const { store } = getPaymentService();
  await store.upsertPayment({
    botId: 'afromarket',
    transactionId: 'ORDER-LINK-LEGACY',
    provider: 'paypal',
    status: PaymentStatus.PENDING
  });

  const server = await startServer();
  try {
    const res = await get(server, '/pay/afromarket/ORDER-LINK-LEGACY');

    assert.equal(res.status, 404);
    assert.equal(res.location, null);
  } finally {
    server.close();
  }
});

test('the gateway sends our own link and keeps the provider URL for the redirect', async () => {
  const provider = {
    initiatePayment: async () => ({ transactionId: 'ORDER-GW-1', status: 'PENDING', checkoutUrl: PAYPAL_URL }),
    checkStatus: async () => ({ status: 'PENDING' }),
    parseWebhook: () => ({})
  };
  const gateway = new PaymentGateway({
    providers: { paypal: provider },
    paymentLinkBaseUrl: 'https://bot.botmanagementservice.eu'
  });

  const record = await gateway.initiatePayment({
    botId: 'afromarket',
    amount: 10,
    currency: 'EUR',
    preferredProvider: 'paypal'
  });

  assert.equal(record.checkoutUrl, 'https://bot.botmanagementservice.eu/pay/afromarket/ORDER-GW-1');
  assert.equal(record.providerCheckoutUrl, PAYPAL_URL, 'the real URL must still be stored for the proxy to redirect to');
});

// An environment that has not configured a base URL must keep working exactly
// as before rather than sending a broken link to a paying customer.
test('with no base URL configured the provider checkout URL is sent unchanged', async () => {
  const provider = {
    initiatePayment: async () => ({ transactionId: 'ORDER-GW-2', status: 'PENDING', checkoutUrl: PAYPAL_URL }),
    checkStatus: async () => ({ status: 'PENDING' }),
    parseWebhook: () => ({})
  };
  const gateway = new PaymentGateway({ providers: { paypal: provider } });

  const record = await gateway.initiatePayment({
    botId: 'afromarket',
    amount: 10,
    currency: 'EUR',
    preferredProvider: 'paypal'
  });

  assert.equal(record.checkoutUrl, PAYPAL_URL);
});

// Regression for a defect found in review: buildPaymentLinkUrl only needed a
// base URL, botId and transactionId, so checkoutUrl came back truthy even when
// the provider returned no redirect link at all. That silenced
// afromarketFlowPlugin's `!payment.checkoutUrl` throw - the thing that turns a
// broken provider response into a loud failure which PRESERVES the cart - and
// left the customer clicking a link that can only say "no longer valid".
test('a provider that returns no checkout URL is not papered over with a proxy link', async () => {
  const provider = {
    initiatePayment: async () => ({ transactionId: 'ORDER-GW-NOURL', status: 'PENDING' }),
    checkStatus: async () => ({ status: 'PENDING' }),
    parseWebhook: () => ({})
  };
  const gateway = new PaymentGateway({
    providers: { paypal: provider },
    paymentLinkBaseUrl: 'https://bot.botmanagementservice.eu'
  });

  const record = await gateway.initiatePayment({
    botId: 'afromarket',
    amount: 10,
    currency: 'EUR',
    preferredProvider: 'paypal'
  });

  assert.equal(record.checkoutUrl, null, 'the caller must still see "no checkout URL" and keep the cart');
  assert.equal(record.providerCheckoutUrl, null);
});

// This endpoint teaches customers that our /pay link is where they go to pay.
// That makes an open redirect on this exact path a phishing primitive, so the
// stored target is checked rather than trusted - today it can only come from
// the provider API over TLS, but one careless field spread would change that.
test('a payment link refuses to redirect to an unexpected target', async () => {
  const { store } = getPaymentService();
  const hostileTargets = [
    '//evil.example.com/phish',
    'http://169.254.169.254/latest/meta-data/',
    'javascript:alert(document.domain)',
    '/pay/afromarket/EVIL',
    'https://paypal.com.evil.example.com/checkout'
  ];

  const server = await startServer();
  try {
    for (const [index, target] of hostileTargets.entries()) {
      const transactionId = `ORDER-LINK-HOSTILE-${index}`;
      await store.upsertPayment({
        botId: 'afromarket',
        transactionId,
        provider: 'paypal',
        status: PaymentStatus.PENDING,
        providerCheckoutUrl: target
      });

      const res = await get(server, `/pay/afromarket/${transactionId}`);

      assert.equal(res.status, 404, `must not redirect to ${target}`);
      assert.equal(res.location, null, `must not emit a Location header for ${target}`);
    }
  } finally {
    server.close();
  }
});

test('a payment flagged as captured after terminal never gets a live pay link', async () => {
  const { store } = getPaymentService();
  await store.upsertPayment({
    botId: 'afromarket',
    transactionId: 'ORDER-LINK-CAPTURED',
    provider: 'paypal',
    // Non-terminal status with the flag set: belt-and-braces, since money
    // demonstrably moved on this order.
    status: PaymentStatus.PENDING,
    capturedAfterTerminal: true,
    providerCheckoutUrl: PAYPAL_URL
  });

  const server = await startServer();
  try {
    const res = await get(server, '/pay/afromarket/ORDER-LINK-CAPTURED');

    assert.equal(res.status, 410);
    assert.equal(res.location, null);
  } finally {
    server.close();
  }
});

test('every response sets no-store and noindex, not just the redirect', async () => {
  const { store } = getPaymentService();
  await store.upsertPayment({
    botId: 'afromarket',
    transactionId: 'ORDER-LINK-HEADERS',
    provider: 'paypal',
    status: PaymentStatus.FAILED,
    failureReason: 'TIMEOUT',
    providerCheckoutUrl: PAYPAL_URL
  });

  const server = await startServer();
  try {
    for (const path of ['/pay/afromarket/ORDER-LINK-HEADERS', '/pay/afromarket/ORDER-LINK-ABSENT']) {
      const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { redirect: 'manual' });
      assert.equal(res.headers.get('cache-control'), 'no-store', `${path} must not be cached`);
      assert.equal(res.headers.get('x-robots-tag'), 'noindex', `${path} must not be indexed`);
    }
  } finally {
    server.close();
  }
});

// The gateway normalises whatever it is handed down to an origin, so a stray
// path can never produce a link that misses the /pay mount.
test('the gateway builds links from the origin alone', async () => {
  const cases = [
    { base: 'https://bot.example.com', expected: 'https://bot.example.com/pay/afromarket/ORDER-CFG' },
    { base: 'https://bot.example.com/', expected: 'https://bot.example.com/pay/afromarket/ORDER-CFG' },
    { base: 'https://bot.example.com/api', expected: 'https://bot.example.com/pay/afromarket/ORDER-CFG' },
    { base: 'https://bot.example.com?a=1', expected: 'https://bot.example.com/pay/afromarket/ORDER-CFG' },
    { base: 'not a url', expected: null }
  ];

  for (const testCase of cases) {
    const gateway = new PaymentGateway({ providers: {}, paymentLinkBaseUrl: testCase.base });
    assert.equal(
      gateway.buildPaymentLinkUrl({ botId: 'afromarket', transactionId: 'ORDER-CFG' }),
      testCase.expected,
      `base URL ${testCase.base}`
    );
  }
});

// Config validation is the other half: a value carrying a path, a non-https
// scheme or an unparseable string would put a dead or unclickable link in
// front of a paying customer, so it is refused at startup and the proxy stays
// off rather than shipping something broken.
test('only a bare https origin is accepted from PAYMENT_LINK_BASE_URL', () => {
  const { parseAndValidatePaymentLinkBaseUrl } = require('../src/core/payments/paymentService');

  assert.equal(parseAndValidatePaymentLinkBaseUrl('https://bot.example.com'), 'https://bot.example.com');
  assert.equal(parseAndValidatePaymentLinkBaseUrl('  https://bot.example.com/  '), 'https://bot.example.com');
  assert.equal(parseAndValidatePaymentLinkBaseUrl('http://localhost:3000'), 'http://localhost:3000');

  assert.equal(parseAndValidatePaymentLinkBaseUrl(undefined), null, 'unset disables the proxy');
  assert.equal(parseAndValidatePaymentLinkBaseUrl('not a url'), null);
  assert.equal(parseAndValidatePaymentLinkBaseUrl('postgres://user:pass@host/db'), null);
  assert.equal(parseAndValidatePaymentLinkBaseUrl('javascript:alert(1)'), null);
  assert.equal(parseAndValidatePaymentLinkBaseUrl('http://bot.example.com'), null, 'plaintext http for a public host');
  assert.equal(parseAndValidatePaymentLinkBaseUrl('https://bot.example.com/api'), null, 'path component');
  assert.equal(parseAndValidatePaymentLinkBaseUrl('https://bot.example.com?a=1'), null, 'query component');
});
