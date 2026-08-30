// Covers afromarket-payment-failure-handling-bugfix.md:
// 1. PayPal return/cancel URL env vars are trimmed and validated at
//    provider-registration time, not deferred to the first real checkout.
// 2. initiatePayment failures are classified 4xx (config/permanent) vs.
//    5xx/timeout (transient) with distinct customer-facing copy.
// 3. A config-class failure triggers a rate-limited admin WhatsApp alert.
// 4. Repeated failed confirm attempts in one session escalate to a
//    human-fallback message.
process.env.STRIPE_SECRET_KEY = 'sk_test';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_SUCCESS_URL = 'https://afromarket.example.com/payment-return';
process.env.AFROMARKET_PAYMENT_PROVIDER = 'stripe';
process.env.AFROMARKET_ADMIN_PHONE = '+491700000000';

const test = require('node:test');
const assert = require('node:assert/strict');

let currentFetchImpl = async () => {
  throw new Error('currentFetchImpl not set for this test');
};
global.fetch = (...args) => currentFetchImpl(...args);

const { FlowEngine } = require('../src/core/flows/flowEngine');
const { AfroMarketFlowPlugin } = require('../src/bots/afromarket/afromarketFlowPlugin');
const { parseTrimmedUrl, getPaymentService } = require('../src/core/payments/paymentService');
const { redisManager } = require('../src/core/redisManager');

const ADMIN_PHONE = '+491700000000';
const CUSTOMER_PHONE = '+491701234567';
const ADMIN_ALERT_COOLDOWN_KEY = 'afromarket:payment-config-failure-admin-alert-cooldown';

// The admin-alert cooldown lives in redisManager's shared in-memory
// fallback for the lifetime of this whole test *process* (no real Redis in
// tests) - clear it before any test that specifically exercises "does the
// first alert in a fresh cooldown window fire", so an earlier test's config-
// class failure doesn't silently suppress this one's.
function clearAdminAlertCooldown() {
  return redisManager.del(ADMIN_ALERT_COOLDOWN_KEY);
}

// eslint-disable-next-line global-require
const botConfig = require('../configs/bots/afromarket.bot.json');

function createStepper() {
  const flowEngine = new FlowEngine({ botConfig, plugin: new AfroMarketFlowPlugin({ botConfig }) });
  let conversationState = { currentFlowId: null, currentStateId: null, context: {} };
  return async function step(text) {
    const outboundIntents = [];
    ({ state: conversationState } = await flowEngine.step({
      from: CUSTOMER_PHONE,
      message: { text: { body: text } },
      state: conversationState,
      send: async (outboundIntent) => outboundIntents.push(outboundIntent)
    }));
    return { outboundIntents, conversationState };
  };
}

async function driveToCheckoutReview(step) {
  await step('hi');
  await step('shop_online');
  await step('cat_beans_nuts');
  await step('product_haricot_rouge_1kg');
  // 4x clears the 24.99€ minimum order value (4 * 7.99 = 31.96).
  await step('cart_add');
  await step('cart_add');
  await step('cart_add');
  await step('cart_add');
  await step('view_cart');
  await step('start_checkout');
  await step('Jane Doe');
  await step('12 Main St, Berlin');
  return step('jane@example.com');
}

// --- 1. URL trimming/validation -------------------------------------------

test('parseTrimmedUrl trims whitespace and accepts a well-formed URL', () => {
  const result = parseTrimmedUrl('PAYPAL_CANCEL_URL', ' https://afromarket.example.com/payment-return ');
  assert.equal(result.valid, true);
  assert.equal(result.value, 'https://afromarket.example.com/payment-return');
});

test('parseTrimmedUrl treats an empty/unset value as valid (optional env var)', () => {
  const result = parseTrimmedUrl('PAYPAL_CANCEL_URL', undefined);
  assert.equal(result.valid, true);
  assert.equal(result.value, '');
});

test('parseTrimmedUrl rejects a malformed value even after trimming', () => {
  const result = parseTrimmedUrl('PAYPAL_RETURN_URL', '  not a url  ');
  assert.equal(result.valid, false);
});

// getPaymentService() caches at module scope, and this file's other tests
// (Stripe checkout flow, etc.) expect the real, Stripe-only cached instance
// - each of these registration tests gets its own fresh module instance via
// require-cache deletion, exercises it, then restores the shared one so
// later tests aren't affected by whatever PayPal env vars this one set.
function withFreshPaymentService(envOverrides, run) {
  const modulePath = require.resolve('../src/core/payments/paymentService');
  const previousValues = {};
  for (const [key, value] of Object.entries(envOverrides)) {
    previousValues[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  delete require.cache[modulePath];
  try {
    // eslint-disable-next-line global-require
    const fresh = require('../src/core/payments/paymentService');
    run(fresh.getPaymentService());
  } finally {
    for (const [key, value] of Object.entries(previousValues)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[modulePath];
    // Restore the real, cached instance the rest of this file's tests expect.
    require('../src/core/payments/paymentService').getPaymentService();
  }
}

test('getPaymentService registers PayPal with the trimmed return/cancel URLs, not the raw whitespace-padded env values', () => {
  withFreshPaymentService(
    {
      SANDBOX_PAYPAL_CLIENT_ID: 'paypal-client-id-test',
      SANDBOX_PAYPAL_CLIENT_SECRET: 'paypal-client-secret-test',
      SANDBOX_PAYPAL_WEBHOOK_ID: 'WH-TEST',
      // The exact incident: a leading space in the env var value.
      PAYPAL_RETURN_URL: ' https://afromarket.example.com/payment-return',
      PAYPAL_CANCEL_URL: ' https://afromarket.example.com/payment-return'
    },
    ({ gateway }) => {
      const provider = gateway.getProvider('paypal');
      assert.ok(provider, 'PayPal provider should register - both URLs are valid once trimmed');
      assert.equal(provider.returnUrl, 'https://afromarket.example.com/payment-return');
      assert.equal(provider.cancelUrl, 'https://afromarket.example.com/payment-return');
    }
  );
});

test('getPaymentService refuses to register PayPal when PAYPAL_RETURN_URL is malformed even after trimming', () => {
  withFreshPaymentService(
    {
      SANDBOX_PAYPAL_CLIENT_ID: 'paypal-client-id-test',
      SANDBOX_PAYPAL_CLIENT_SECRET: 'paypal-client-secret-test',
      SANDBOX_PAYPAL_WEBHOOK_ID: 'WH-TEST',
      PAYPAL_RETURN_URL: 'not-a-valid-url',
      PAYPAL_CANCEL_URL: 'https://afromarket.example.com/payment-return'
    },
    ({ gateway }) => {
      assert.equal(gateway.getProvider('paypal'), null, 'a malformed return URL must block registration entirely, not defer the failure to the first checkout');
    }
  );
});

test('getPaymentService refuses to register PayPal when PAYPAL_RETURN_URL is simply missing (not just malformed) - initiatePayment would otherwise throw unconditionally', () => {
  withFreshPaymentService(
    {
      SANDBOX_PAYPAL_CLIENT_ID: 'paypal-client-id-test',
      SANDBOX_PAYPAL_CLIENT_SECRET: 'paypal-client-secret-test',
      SANDBOX_PAYPAL_WEBHOOK_ID: 'WH-TEST',
      PAYPAL_RETURN_URL: undefined,
      PAYPAL_CANCEL_URL: undefined
    },
    ({ gateway }) => {
      assert.equal(gateway.getProvider('paypal'), null);
    }
  );
});

// Stripe gets the identical trim/validate/require-at-registration treatment
// as PayPal above - added after a subagent review flagged Stripe as
// reproducing the exact bug class this fix closes for PayPal, and (per
// AFROMARKET_PAYMENT_PROVIDER's default) the higher-value gap in practice.

test('getPaymentService registers Stripe with the trimmed success/cancel URLs, not the raw whitespace-padded env values', () => {
  withFreshPaymentService(
    {
      STRIPE_SUCCESS_URL: ' https://afromarket.example.com/payment-return',
      STRIPE_CANCEL_URL: ' https://afromarket.example.com/payment-return'
    },
    ({ gateway }) => {
      const provider = gateway.getProvider('stripe');
      assert.ok(provider, 'Stripe provider should register - both URLs are valid once trimmed');
      assert.equal(provider.successUrl, 'https://afromarket.example.com/payment-return');
      assert.equal(provider.cancelUrl, 'https://afromarket.example.com/payment-return');
    }
  );
});

test('getPaymentService refuses to register Stripe when STRIPE_SUCCESS_URL is malformed even after trimming', () => {
  withFreshPaymentService({ STRIPE_SUCCESS_URL: 'not-a-valid-url' }, ({ gateway }) => {
    assert.equal(gateway.getProvider('stripe'), null, 'a malformed success URL must block registration entirely, not defer the failure to the first checkout');
  });
});

test('getPaymentService refuses to register Stripe when STRIPE_SUCCESS_URL is simply missing (not just malformed) - initiatePayment would otherwise throw unconditionally', () => {
  withFreshPaymentService({ STRIPE_SUCCESS_URL: undefined, STRIPE_CANCEL_URL: undefined }, ({ gateway }) => {
    assert.equal(gateway.getProvider('stripe'), null);
  });
});

// --- 2. 4xx vs 5xx/timeout classification -----------------------------------

test('a 4xx initiatePayment failure shows the config-error message, not "tap Confirm Order to try again"', async () => {
  await clearAdminAlertCooldown();
  currentFetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Invalid request' } }) });

  const step = createStepper();
  await driveToCheckoutReview(step);
  const result = await step('confirm_order');

  // The admin alert (also sent for a 4xx failure - see the dedicated tests
  // below) is addressed to the admin phone, not the customer's - find the
  // customer's own rejection message by recipient rather than assuming it's
  // outboundIntents[0] (send order between the two isn't part of the
  // contract under test here).
  const customerMessage = result.outboundIntents.find((i) => i.to === CUSTOMER_PHONE && i.type === 'text');
  assert.ok(customerMessage, 'expected a text message addressed to the customer');
  assert.match(customerMessage.body, /trouble starting checkout/);
  assert.match(customerMessage.body, /team has been notified/);
  assert.doesNotMatch(customerMessage.body, /tap \*Confirm Order\* to try again/);
});

test('a 5xx initiatePayment failure keeps the existing "tap Confirm Order to try again" retry message', async () => {
  currentFetchImpl = async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'Internal error' } }) });

  const step = createStepper();
  await driveToCheckoutReview(step);
  const result = await step('confirm_order');

  assert.match(result.outboundIntents[0].body, /Please check your email address and tap \*Confirm Order\* to try again/);
  assert.doesNotMatch(result.outboundIntents[0].body, /trouble starting checkout/);
});

test('a network-level throw (no .status at all) is treated as transient, not config-class', async () => {
  currentFetchImpl = async () => {
    throw new Error('network unreachable');
  };

  const step = createStepper();
  await driveToCheckoutReview(step);
  const result = await step('confirm_order');

  assert.match(result.outboundIntents[0].body, /tap \*Confirm Order\* to try again/);
  assert.doesNotMatch(result.outboundIntents[0].body, /trouble starting checkout/);
});

// --- 3. Admin alert, rate-limited -------------------------------------------

test('a 4xx failure sends exactly one admin WhatsApp alert, not one per failed attempt (Redis cooldown)', async () => {
  await clearAdminAlertCooldown();
  currentFetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Invalid request' } }) });

  const step = createStepper();
  await driveToCheckoutReview(step);

  const first = await step('confirm_order');
  const adminAlerts1 = first.outboundIntents.filter((i) => i.to === ADMIN_PHONE);
  assert.equal(adminAlerts1.length, 1);
  assert.match(adminAlerts1[0].body, /stripe payment initiation is failing/i);
  assert.match(adminAlerts1[0].body, /400/);

  const second = await step('confirm_order');
  const adminAlerts2 = second.outboundIntents.filter((i) => i.to === ADMIN_PHONE);
  assert.equal(adminAlerts2.length, 0, 'second failure within the cooldown window must not send a second alert');
});

test('no admin alert is sent for a transient (5xx) failure', async () => {
  await clearAdminAlertCooldown();
  currentFetchImpl = async () => ({ ok: false, status: 503, json: async () => ({ error: { message: 'Service unavailable' } }) });

  const step = createStepper();
  await driveToCheckoutReview(step);
  const result = await step('confirm_order');

  assert.equal(result.outboundIntents.filter((i) => i.to === ADMIN_PHONE).length, 0);
});

test('no admin alert is sent when AFROMARKET_ADMIN_PHONE is not configured', async () => {
  const previous = process.env.AFROMARKET_ADMIN_PHONE;
  delete process.env.AFROMARKET_ADMIN_PHONE;

  try {
    await clearAdminAlertCooldown();
    currentFetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Invalid request' } }) });

    const step = createStepper();
    await driveToCheckoutReview(step);
    const result = await step('confirm_order');

    // Both outbound intents are addressed to the customer - the rejection
    // text plus checkout_review's own re-render (unchanged, pre-existing
    // behavior of every ctx.goto('checkout_review') in this file, not
    // specific to this bugfix) - neither is an admin alert.
    assert.equal(result.outboundIntents.length, 2);
    assert.ok(result.outboundIntents.every((i) => i.to === CUSTOMER_PHONE));
  } finally {
    process.env.AFROMARKET_ADMIN_PHONE = previous;
  }
});

test('the misconfigured-active-provider guard (a different config-class failure than initiatePayment 4xx) also sends an admin alert', async () => {
  await clearAdminAlertCooldown();
  // Stripe is configured (top-of-file env vars), but the active-provider
  // flag now selects paypal, which isn't configured in this file - the same
  // deploy-sequencing footgun the WS1 guard exists to catch, and a
  // permanent, 100%-of-checkouts-blocked failure just like a 4xx
  // initiatePayment error, even though it never reaches a provider call at
  // all (see afromarketFlowPlugin.js's own comment on this guard).
  const previousProvider = process.env.AFROMARKET_PAYMENT_PROVIDER;
  process.env.AFROMARKET_PAYMENT_PROVIDER = 'paypal';

  try {
    currentFetchImpl = async () => {
      throw new Error('no payment provider API call should happen - the misconfiguration guard must block checkout first');
    };

    const step = createStepper();
    await driveToCheckoutReview(step);
    const result = await step('confirm_order');

    const adminAlerts = result.outboundIntents.filter((i) => i.to === ADMIN_PHONE);
    assert.equal(adminAlerts.length, 1);
    assert.match(adminAlerts[0].body, /AFROMARKET_PAYMENT_PROVIDER="paypal" has no configured credentials/);
  } finally {
    process.env.AFROMARKET_PAYMENT_PROVIDER = previousProvider;
  }
});

// --- 4. Retry-count escalation ----------------------------------------------

test('the 3rd consecutive failed confirm attempt in one session escalates to a human-fallback message', async () => {
  currentFetchImpl = async () => ({ ok: false, status: 503, json: async () => ({ error: { message: 'Service unavailable' } }) });

  const step = createStepper();
  await driveToCheckoutReview(step);

  const first = await step('confirm_order');
  assert.doesNotMatch(first.outboundIntents[0].body, /Still having trouble/);

  const second = await step('confirm_order');
  assert.doesNotMatch(second.outboundIntents[0].body, /Still having trouble/);

  const third = await step('confirm_order');
  assert.match(third.outboundIntents[0].body, /Still having trouble\? Message us directly/);
});

test('the failure-streak counter resets after a successful initiatePayment', async () => {
  const step = createStepper();
  await driveToCheckoutReview(step);

  currentFetchImpl = async () => ({ ok: false, status: 503, json: async () => ({ error: { message: 'Service unavailable' } }) });
  await step('confirm_order');
  await step('confirm_order');

  currentFetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: 'cs_test_reset', url: 'https://checkout.stripe.com/c/pay/cs_test_reset' })
  });
  const succeeded = await step('confirm_order');
  assert.equal(succeeded.outboundIntents[0].type, 'cta_url');

  // A second, brand-new order (success clears the cart, so it needs
  // rebuilding) hits a single failure right after the success above. If the
  // streak had NOT reset (i.e. it were still 2 from before), this 3rd
  // overall failure would cross PAYMENT_FAILURE_ESCALATION_THRESHOLD and
  // show the escalation line; asserting it does NOT is the actual proof the
  // reset happened, not just that success itself worked (which it would
  // regardless of the counter's value).
  await step('product_haricot_rouge_1kg');
  await step('cart_add');
  await step('cart_add');
  await step('cart_add');
  await step('cart_add');
  await step('view_cart');
  await step('start_checkout');
  await step('Jane Doe');
  await step('12 Main St, Berlin');
  await step('jane@example.com');

  currentFetchImpl = async () => ({ ok: false, status: 503, json: async () => ({ error: { message: 'Service unavailable' } }) });
  const afterReset = await step('confirm_order');
  assert.doesNotMatch(afterReset.outboundIntents[0].body, /Still having trouble/, 'a single failure right after a success must not already be escalated');
});

test('the failure-streak counter resets on Cancel (cart_view)', async () => {
  currentFetchImpl = async () => ({ ok: false, status: 503, json: async () => ({ error: { message: 'Service unavailable' } }) });

  const step = createStepper();
  await driveToCheckoutReview(step);
  await step('confirm_order');
  await step('confirm_order');

  await step('cancel_checkout');
  await step('start_checkout');
  await step('Jane Doe');
  await step('12 Main St, Berlin');
  await step('jane@example.com');

  const first = await step('confirm_order');
  assert.doesNotMatch(first.outboundIntents[0].body, /Still having trouble/, 'streak must not carry over past a Cancel');
});
