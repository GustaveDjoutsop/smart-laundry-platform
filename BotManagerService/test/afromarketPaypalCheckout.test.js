// PayPal-path equivalent of afromarketPaymentCheckout.test.js's Stripe
// coverage - AFROMARKET_PAYMENT_PROVIDER defaults to paypal, so this is the
// path a fresh deploy actually takes. See that file for the Stripe path
// (pinned explicitly there) and afromarketPaymentProviderSelector.test.js
// for the selector itself.
//
// Per afromarket-remove-prepayment-address-collection.md, PayPal skips the
// checkout_name/address/email/checkout_review sequence entirely -
// _handleCheckoutStart calls _handleCheckout directly the moment
// 'start_checkout' is tapped from cart_view, so every test here drives only
// as far as a qualifying cart_view and taps 'start_checkout' once, not
// through a separate name/address/email/confirm_order sequence like the
// Stripe-path tests do.
process.env.SANDBOX_PAYPAL_CLIENT_ID = 'paypal-client-id-test';
process.env.SANDBOX_PAYPAL_CLIENT_SECRET = 'paypal-client-secret-test';
process.env.SANDBOX_PAYPAL_WEBHOOK_ID = 'WH-TEST';
process.env.PAYPAL_RETURN_URL = 'https://afromarket.example.com/payment-return';
delete process.env.AFROMARKET_PAYMENT_PROVIDER;

const test = require('node:test');
const assert = require('node:assert/strict');

// getPaymentService() is a module-level singleton, same caveat as
// afromarketPaymentCheckout.test.js - one stable global.fetch wrapper up
// front, each test repoints what it delegates to.
let currentFetchImpl = async () => {
  throw new Error('currentFetchImpl not set for this test');
};
global.fetch = (...args) => currentFetchImpl(...args);

const { FlowEngine } = require('../src/core/flows/flowEngine');
const { AfroMarketFlowPlugin } = require('../src/bots/afromarket/afromarketFlowPlugin');

// eslint-disable-next-line global-require
const botConfig = require('../configs/bots/afromarket.bot.json');

const TOKEN_RESPONSE = { ok: true, status: 200, json: async () => ({ access_token: 'access-token-abc', expires_in: 32000 }) };

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

// Ends at cart_view, qualifying (4x haricot_rouge_1kg = 31.96€, clears the
// 24.99€ minimum) - deliberately does NOT tap 'start_checkout', since that
// single tap is what each test itself exercises (it triggers payment-link
// generation directly for PayPal, no intermediate review screen).
async function driveToQualifyingCartView(step) {
  await step('hi');
  await step('shop_online');
  await step('cat_beans_nuts');
  await step('product_haricot_rouge_1kg');
  await step('cart_add');
  await step('cart_add');
  await step('cart_add');
  await step('cart_add');
  return step('view_cart');
}

test('AfroMarket checkout: PayPal is the active provider by default', async () => {
  // eslint-disable-next-line global-require
  const { getActivePaymentProvider } = require('../src/bots/afromarket/afromarketFlowPlugin');
  assert.equal(getActivePaymentProvider(), 'paypal');
});

test('AfroMarket checkout: tapping Checkout skips name/address/email collection entirely and goes straight to the PayPal link', async () => {
  currentFetchImpl = async (url) => {
    if (String(url).includes('/oauth2/token')) return TOKEN_RESPONSE;
    return {
      ok: true,
      status: 201,
      json: async () => ({
        id: 'ORDER-xyz789',
        status: 'PAYER_ACTION_REQUIRED',
        links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-xyz789' }]
      })
    };
  };

  const step = createStepper();
  await driveToQualifyingCartView(step);
  const result = await step('start_checkout');

  // No "what's your full name?"/delivery-address/email prompt anywhere in
  // this turn's response - just the explanation, the link, and the "order
  // ready" confirmation (see the dedicated explanation-message test below
  // for that first message specifically).
  // Matches the OLD checkout_name/address/email prompts' distinctive
  // phrasing specifically, not just any mention of "address" - the NEW
  // explanation message legitimately says "delivery address" too (just in
  // a different sentence, see the dedicated test below).
  const bodies = result.outboundIntents.map((i) => i.body);
  assert.ok(!bodies.some((b) => /what's your full name/i.test(b)));
  assert.ok(!bodies.some((b) => /what's your delivery address/i.test(b)));
  assert.ok(!bodies.some((b) => /reply \*skip\* if you'd rather not share/i.test(b)));
  assert.ok(!bodies.some((b) => /confirm your order/i.test(b)), 'checkout_review must never render for PayPal');

  assert.equal(result.outboundIntents[1].type, 'cta_url');
  assert.equal(result.outboundIntents[1].url, 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-xyz789');
  assert.deepEqual(result.conversationState.context.cart, []);
});

test('AfroMarket checkout: sends the "we\'ll get your address from PayPal" explanation before the payment link', async () => {
  currentFetchImpl = async (url) => {
    if (String(url).includes('/oauth2/token')) return TOKEN_RESPONSE;
    return { ok: true, status: 201, json: async () => ({ id: 'ORDER-explain', links: [{ rel: 'approve', href: 'https://paypal.example.com/approve/explain' }] }) };
  };

  const step = createStepper();
  await driveToQualifyingCartView(step);
  const result = await step('start_checkout');

  assert.equal(result.outboundIntents[0].type, 'text');
  assert.match(result.outboundIntents[0].body, /get your delivery address from PayPal automatically/);
  assert.match(result.outboundIntents[0].body, /no need to type it here/);
});

test('AfroMarket checkout: successful PayPal order creation sends the payer-action link and does not confirm the order yet', async () => {
  // Order-creation calls counted separately from OAuth token calls -
  // PayPalProvider caches its token across calls (see paypalProvider.test.js's
  // dedicated coverage of that), and getPaymentService() is a module-level
  // singleton shared by every test in this file, so whether a token call
  // happens on any given test depends on whether an earlier test already
  // populated the cache - not something this test should assert on.
  let orderCreationCalls = 0;
  currentFetchImpl = async (url) => {
    if (String(url).includes('/oauth2/token')) return TOKEN_RESPONSE;
    orderCreationCalls += 1;
    return {
      ok: true,
      status: 201,
      json: async () => ({
        id: 'ORDER-xyz789',
        status: 'PAYER_ACTION_REQUIRED',
        links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-xyz789' }]
      })
    };
  };

  const step = createStepper();
  await driveToQualifyingCartView(step);
  const result = await step('start_checkout');

  // explanation text, cta_url, then order_confirmed's own "is ready" render
  // (ctx.goto('order_confirmed') from within the same action-handler turn -
  // see afromarketFlowPlugin.js's _handleCheckout).
  assert.equal(result.outboundIntents.length, 3);
  assert.equal(result.outboundIntents[1].type, 'cta_url');
  assert.equal(result.outboundIntents[1].url, 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-xyz789');

  assert.equal(result.outboundIntents[2].type, 'buttons');
  assert.match(result.outboundIntents[2].body, /Order .* is ready/);
  assert.doesNotMatch(result.outboundIntents[2].body, /Order confirmed/);

  assert.deepEqual(result.conversationState.context.cart, []);
  assert.equal(orderCreationCalls, 1);
});

test('AfroMarket checkout: a failed PayPal order creation (4xx, config-class) never confirms the order and keeps the cart intact', async () => {
  currentFetchImpl = async (url) => {
    if (String(url).includes('/oauth2/token')) return TOKEN_RESPONSE;
    return { ok: false, status: 400, json: async () => ({ name: 'INVALID_REQUEST' }) };
  };

  const step = createStepper();
  await driveToQualifyingCartView(step);
  const result = await step('start_checkout');

  assert.equal(result.outboundIntents[0].type, 'text');
  // 4xx is a permanent config/client error - distinct copy from the
  // transient-failure "tap Checkout to try again" path (see
  // afromarketPaymentFailureHandling.test.js for the classification itself).
  assert.match(result.outboundIntents[0].body, /trouble starting checkout/);
  assert.doesNotMatch(result.outboundIntents[0].body, /email address/, 'PayPal failure copy must not mention email');

  // Routed to cart_view, not checkout_review (which is never populated for
  // PayPal) - see failureReturnState in afromarketFlowPlugin.js.
  assert.equal(result.outboundIntents[1].type, 'buttons');
  assert.match(result.outboundIntents[1].body, /Your Cart/);
  assert.equal(result.conversationState.context.cart.length, 1);
});

test('AfroMarket checkout: a double-tap on Checkout does not call PayPal twice', async () => {
  // Unlike the Stripe path's equivalent test (afromarketPaymentCheckout.
  // test.js), which replays the identical checkout_review snapshot for two
  // separate flowEngine.step() calls to simulate a genuine race, that
  // technique doesn't model this codebase's real concurrency: QueueManager
  // (src/core/queueManager.js) is a single, fully serialized, in-process
  // queue - two real button taps are guaranteed to process one at a time,
  // never concurrently on the same starting snapshot. For PayPal's
  // skip-straight-to-payment flow, checkoutIdempotencyKey is generated
  // fresh inside _handleCheckoutStart itself (there's no earlier
  // checkout_review state to have already persisted one to protect a
  // same-snapshot replay), so this test exercises the real mechanism with
  // two genuinely sequential taps instead: the first tap's success moves
  // the conversation to order_confirmed, so a second 'start_checkout' sent
  // afterwards is just unrecognized free text there (falls through
  // order_confirmed_route's default to welcome) - it can't re-trigger
  // checkout at all, regardless of cart contents.
  let orderCreationCalls = 0;
  currentFetchImpl = async (url) => {
    if (String(url).includes('/oauth2/token')) return TOKEN_RESPONSE;
    orderCreationCalls += 1;
    return { ok: true, status: 201, json: async () => ({ id: 'ORDER-once', links: [{ rel: 'approve', href: 'https://paypal.example.com/approve/once' }] }) };
  };

  const step = createStepper();
  await driveToQualifyingCartView(step);

  const firstTap = await step('start_checkout');
  assert.equal(orderCreationCalls, 1);
  assert.ok(firstTap.outboundIntents.some((i) => i.type === 'cta_url' && i.url === 'https://paypal.example.com/approve/once'));
  assert.deepEqual(firstTap.conversationState.context.cart, []);
  assert.equal(firstTap.conversationState.currentStateId, 'order_confirmed');

  await step('start_checkout');
  assert.equal(orderCreationCalls, 1, 'PayPal must only be called once across both taps');
});
