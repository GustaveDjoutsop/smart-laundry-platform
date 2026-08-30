// Covers a critical fix: a failed/erroring Stripe initiatePayment call must
// never confirm the order as paid, and must never drop the customer's cart.
process.env.STRIPE_SECRET_KEY = 'sk_test';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_SUCCESS_URL = 'https://afromarket.example.com/payment-return';
// This file specifically exercises the Stripe path (real HTTP request shape,
// customer_email requirement, etc.) - the provider selector defaults to
// paypal, so pin it explicitly rather than let these tests silently start
// hitting the (here unconfigured) paypal branch instead. See
// afromarketPaymentProviderSelector.test.js for the selector itself and
// afromarketPaypalCheckout.test.js for the paypal-path equivalents of these.
process.env.AFROMARKET_PAYMENT_PROVIDER = 'stripe';

const test = require('node:test');
const assert = require('node:assert/strict');

// getPaymentService() is a module-level singleton: the StripeProvider (and
// the `global.fetch` reference it captures at construction time) is built once
// and reused across every test in this file. Swapping `global.fetch` itself
// between tests wouldn't reach that already-captured reference, so instead
// install one stable wrapper up front and let each test just repoint what it
// delegates to.
let currentFetchImpl = async () => {
  throw new Error('currentFetchImpl not set for this test');
};
global.fetch = (...args) => currentFetchImpl(...args);

const { FlowEngine } = require('../src/core/flows/flowEngine');
const { AfroMarketFlowPlugin } = require('../src/bots/afromarket/afromarketFlowPlugin');

// eslint-disable-next-line global-require
const botConfig = require('../configs/bots/afromarket.bot.json');

function createStepper() {
  const flowEngine = new FlowEngine({ botConfig, plugin: new AfroMarketFlowPlugin({ botConfig }) });
  let conversationState = { currentFlowId: null, currentStateId: null, context: {} };

  return async function step(text) {
    const outboundIntents = [];
    ({ state: conversationState } = await flowEngine.step({
      from: '+491701234567',
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
  // 4x clears the 24.99€ minimum order value (4 * 7.99 = 31.96) - repeat
  // cart_add on the same product increments qty on one line rather than
  // pushing a new one, so cart.length-based assertions elsewhere are
  // unaffected.
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

test('AfroMarket checkout: successful Stripe initiation sends a real payment link and does not confirm the order yet', async () => {
  currentFetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: 'cs_test_xyz789', url: 'https://checkout.stripe.com/c/pay/cs_test_xyz789' })
  });

  const step = createStepper();
  await driveToCheckoutReview(step);

  const result = await step('confirm_order');

  assert.equal(result.outboundIntents.length, 2);
  assert.equal(result.outboundIntents[0].type, 'cta_url');
  assert.equal(result.outboundIntents[0].url, 'https://checkout.stripe.com/c/pay/cs_test_xyz789');

  assert.equal(result.outboundIntents[1].type, 'buttons');
  assert.match(result.outboundIntents[1].body, /Order .* is ready/);
  assert.doesNotMatch(result.outboundIntents[1].body, /Order confirmed/);

  assert.deepEqual(result.conversationState.context.cart, []);
});

test('AfroMarket checkout: a failed Stripe initiation never confirms the order and keeps the cart intact', async () => {
  currentFetchImpl = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: { message: 'Invalid email' } })
  });

  const step = createStepper();
  await driveToCheckoutReview(step);

  const result = await step('confirm_order');

  assert.equal(result.outboundIntents[0].type, 'text');
  assert.match(result.outboundIntents[0].body, /couldn't start the payment/);
  assert.match(result.outboundIntents[0].body, /cart is safe/);
  assert.doesNotMatch(result.outboundIntents[0].body, /Order confirmed/);

  // Routed back to checkout_review, not order_confirmed - the cart survives the failure.
  assert.equal(result.outboundIntents[1].type, 'buttons');
  assert.match(result.outboundIntents[1].body, /confirm your order/i);
  assert.match(result.outboundIntents[1].body, /Haricot Rouge – Meringué 1kg/);

  assert.equal(result.conversationState.context.cart.length, 1);
  assert.equal(result.conversationState.context.cart[0].productId, 'haricot_rouge_1kg');
});

test('AfroMarket checkout: a network-level throw from initiatePayment is treated the same as an API error response', async () => {
  currentFetchImpl = async () => {
    throw new Error('network unreachable');
  };

  const step = createStepper();
  await driveToCheckoutReview(step);

  const result = await step('confirm_order');

  assert.equal(result.outboundIntents[0].type, 'text');
  assert.match(result.outboundIntents[0].body, /couldn't start the payment/);
  assert.equal(result.conversationState.context.cart.length, 1);
});

test('AfroMarket checkout: omitting the optional email is asked for specifically only once payment actually needs it', async () => {
  currentFetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: 'cs_test_noemail', url: 'https://checkout.stripe.com/c/pay/cs_test_noemail' })
  });

  const step = createStepper();
  await step('hi');
  await step('shop_online');
  await step('cat_beans_nuts');
  await step('product_haricot_rouge_1kg');
  await step('cart_add');
  await step('cart_add');
  await step('cart_add');
  await step('cart_add');
  await step('view_cart');
  await step('start_checkout');
  await step('Jane Doe');
  await step('12 Main St, Berlin');

  const review = await step('skip');
  assert.match(review.outboundIntents[0].body, /confirm your order/i);
  assert.match(review.outboundIntents[0].body, /Email:\s*\n/);

  const askedForEmail = await step('confirm_order');
  assert.equal(askedForEmail.outboundIntents[0].type, 'text');
  assert.match(askedForEmail.outboundIntents[0].body, /email address/);

  const result = await step('jane@example.com');
  assert.equal(result.outboundIntents[0].type, 'cta_url');
  assert.equal(result.outboundIntents[0].url, 'https://checkout.stripe.com/c/pay/cs_test_noemail');
  assert.deepEqual(result.conversationState.context.cart, []);
});

test('AfroMarket checkout: a saved profile\'s prefilled email actually reaches the Stripe checkout session, not just the review screen', async () => {
  // Closes a coverage gap flagged in review: prior saved-profile tests only
  // asserted the *review screen* shows the prefilled email
  // (afromarketFlow.test.js) - none confirmed it survives all the way
  // through _handleCheckoutStart -> checkout_review -> _handleCheckout's
  // `email` variable -> gateway.initiatePayment's `customerEmail` -> the
  // actual Stripe API request. Asserting on the real outbound HTTP request
  // body (Stripe's own `customer_email` field, not our app-internal
  // metadata - see stripeProvider.js's comment on why the full metadata
  // never reaches Stripe) is the most direct way to prove that chain is
  // actually connected end-to-end, not just that a context variable got set.
  let capturedBody = null;
  currentFetchImpl = async (url, init) => {
    capturedBody = init.body;
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'cs_test_prefilled', url: 'https://checkout.stripe.com/c/pay/cs_test_prefilled' })
    };
  };

  const customerProfileStore = {
    async get() {
      return { name: 'Jane Doe', delivery_address: '12 Main St, Berlin', email: 'jane@example.com' };
    }
  };
  const flowEngine = new FlowEngine({
    botConfig,
    plugin: new AfroMarketFlowPlugin({ botConfig, customerProfileStore })
  });
  let conversationState = { currentFlowId: null, currentStateId: null, context: {} };
  const step = async (text) => {
    const outboundIntents = [];
    ({ state: conversationState } = await flowEngine.step({
      from: '+491701234567',
      message: { text: { body: text } },
      state: conversationState,
      send: async (outboundIntent) => outboundIntents.push(outboundIntent)
    }));
    return { outboundIntents, conversationState };
  };

  await step('hi');
  await step('shop_online');
  await step('cat_beans_nuts');
  await step('product_haricot_rouge_1kg');
  await step('cart_add');
  await step('cart_add');
  await step('cart_add');
  await step('cart_add');
  await step('view_cart');
  await step('start_checkout');

  // No checkout_name/address/email prompts here - straight to review,
  // prefilled from the saved profile (including email).
  const result = await step('confirm_order');

  assert.equal(result.outboundIntents[0].type, 'cta_url');
  assert.equal(result.outboundIntents[0].url, 'https://checkout.stripe.com/c/pay/cs_test_prefilled');
  assert.ok(capturedBody, 'expected a captured Stripe request body');
  assert.match(capturedBody, /customer_email=jane%40example\.com/);
});

test('AfroMarket checkout: a double-tap on Confirm Order reuses the same idempotency key and does not call Stripe twice', async () => {
  let callCount = 0;
  currentFetchImpl = async () => {
    callCount += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'cs_test_once', url: 'https://checkout.stripe.com/c/pay/cs_test_once' })
    };
  };

  const step = createStepper();
  const review = await driveToCheckoutReview(step);

  // Captured from the checkout_review state itself, before any confirm_order
  // tap clears it - this is the exact key both "taps" below will present.
  const idempotencyKey = review.conversationState.context.checkoutIdempotencyKey;
  assert.ok(idempotencyKey, 'checkout_review must have generated an idempotency key');

  const flowEngine = new FlowEngine({ botConfig, plugin: new AfroMarketFlowPlugin({ botConfig }) });
  const tapState = () => JSON.parse(JSON.stringify(review.conversationState));

  const firstTap = [];
  await flowEngine.step({
    from: '+491701234567',
    message: { text: { body: 'confirm_order' } },
    state: tapState(),
    send: async (intent) => firstTap.push(intent)
  });
  assert.equal(callCount, 1);
  assert.equal(firstTap[0].url, 'https://checkout.stripe.com/c/pay/cs_test_once');

  // A second tap presenting the identical idempotency key (e.g. a WhatsApp
  // webhook redelivery of the same message, or a human double-tap before the
  // client-side cart cleared) must return the same cached payment, not call
  // Stripe again and mint a second checkout session.
  const secondTap = [];
  await flowEngine.step({
    from: '+491701234567',
    message: { text: { body: 'confirm_order' } },
    state: tapState(),
    send: async (intent) => secondTap.push(intent)
  });

  assert.equal(callCount, 1, 'Stripe must only be called once across both taps');
  assert.equal(secondTap[0].url, 'https://checkout.stripe.com/c/pay/cs_test_once');
});

test('AfroMarket checkout: a misconfigured active provider (paypal selected but not configured) refuses checkout instead of silently confirming an unpaid order, when Stripe IS configured in this environment', async () => {
  // The exact deploy-sequencing footgun this must guard against: Stripe is
  // configured (STRIPE_SECRET_KEY set at the top of this file), but the
  // active-provider flag now selects paypal (unconfigured here - no
  // SANDBOX_PAYPAL_CLIENT_ID in this file) - e.g. AFROMARKET_PAYMENT_PROVIDER
  // left unset/defaulted in an environment that only has Stripe wired up so
  // far. Falling through to the "no provider configured at all" legacy
  // instant-confirmation branch here would give the order away for free.
  const previousProvider = process.env.AFROMARKET_PAYMENT_PROVIDER;
  process.env.AFROMARKET_PAYMENT_PROVIDER = 'paypal';

  try {
    currentFetchImpl = async () => {
      throw new Error('no payment provider API call should happen - checkout must be refused before reaching one');
    };

    const step = createStepper();
    await driveToCheckoutReview(step);

    const result = await step('confirm_order');

    assert.equal(result.outboundIntents[0].type, 'text');
    assert.match(result.outboundIntents[0].body, /temporarily unavailable/);
    assert.doesNotMatch(result.outboundIntents[0].body, /Order confirmed/);

    // Cart survives - the order must not be confirmed/fulfilled unpaid.
    assert.equal(result.conversationState.context.cart.length, 1);
  } finally {
    process.env.AFROMARKET_PAYMENT_PROVIDER = previousProvider;
  }
});
