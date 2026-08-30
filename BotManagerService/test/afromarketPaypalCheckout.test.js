// PayPal-path equivalent of afromarketPaymentCheckout.test.js's Stripe
// coverage - AFROMARKET_PAYMENT_PROVIDER defaults to paypal, so this is the
// path a fresh deploy actually takes. See that file for the Stripe path
// (pinned explicitly there) and afromarketPaymentProviderSelector.test.js
// for the selector itself.
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
  // checkout_email is still prompted pre-payment even on the PayPal path
  // (Workstream 2's "kept as a fallback or removed" decision is still
  // open - see the todo doc) - PayPal just never *requires* it, so 'skip'
  // goes straight through to checkout_review.
  return step('skip');
}

test('AfroMarket checkout: PayPal is the active provider by default', async () => {
  // eslint-disable-next-line global-require
  const { getActivePaymentProvider } = require('../src/bots/afromarket/afromarketFlowPlugin');
  assert.equal(getActivePaymentProvider(), 'paypal');
});

test('AfroMarket checkout: successful PayPal order creation sends the payer-action link and does not confirm the order yet', async () => {
  let callCount = 0;
  currentFetchImpl = async (url) => {
    callCount += 1;
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
  await driveToCheckoutReview(step);

  const result = await step('confirm_order');

  assert.equal(result.outboundIntents.length, 2);
  assert.equal(result.outboundIntents[0].type, 'cta_url');
  assert.equal(result.outboundIntents[0].url, 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-xyz789');

  assert.equal(result.outboundIntents[1].type, 'buttons');
  assert.match(result.outboundIntents[1].body, /Order .* is ready/);

  assert.deepEqual(result.conversationState.context.cart, []);
  assert.equal(callCount, 2, 'one OAuth token call + one order-creation call');
});

test('AfroMarket checkout: PayPal does not ask for an email at all (unlike Stripe)', async () => {
  currentFetchImpl = async (url) => {
    if (String(url).includes('/oauth2/token')) return TOKEN_RESPONSE;
    return {
      ok: true,
      status: 201,
      json: async () => ({ id: 'ORDER-noemail', links: [{ rel: 'approve', href: 'https://paypal.example.com/approve/noemail' }] })
    };
  };

  const step = createStepper();
  const review = await driveToCheckoutReview(step);

  // No email prompt loop after 'skip' - PayPal's checkout_email_required
  // gate only applies to Stripe, unlike the equivalent Stripe-path test in
  // afromarketPaymentCheckout.test.js which does hit that prompt.
  assert.match(review.outboundIntents[0].body, /confirm your order/i);

  const result = await step('confirm_order');
  assert.equal(result.outboundIntents[0].type, 'cta_url');
  assert.equal(result.outboundIntents[0].url, 'https://paypal.example.com/approve/noemail');
});

test('AfroMarket checkout: a failed PayPal order creation never confirms the order and keeps the cart intact', async () => {
  currentFetchImpl = async (url) => {
    if (String(url).includes('/oauth2/token')) return TOKEN_RESPONSE;
    return { ok: false, status: 400, json: async () => ({ name: 'INVALID_REQUEST' }) };
  };

  const step = createStepper();
  await driveToCheckoutReview(step);

  const result = await step('confirm_order');

  assert.equal(result.outboundIntents[0].type, 'text');
  assert.match(result.outboundIntents[0].body, /couldn't start the payment/);
  assert.doesNotMatch(result.outboundIntents[0].body, /email address/, 'PayPal failure copy must not mention email');

  assert.equal(result.outboundIntents[1].type, 'buttons');
  assert.equal(result.conversationState.context.cart.length, 1);
});

test('AfroMarket checkout: a double-tap on Confirm Order reuses the same idempotency key and does not call PayPal twice', async () => {
  let orderCreationCalls = 0;
  currentFetchImpl = async (url) => {
    if (String(url).includes('/oauth2/token')) return TOKEN_RESPONSE;
    orderCreationCalls += 1;
    return { ok: true, status: 201, json: async () => ({ id: 'ORDER-once', links: [{ rel: 'approve', href: 'https://paypal.example.com/approve/once' }] }) };
  };

  const step = createStepper();
  const review = await driveToCheckoutReview(step);

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
  assert.equal(orderCreationCalls, 1);

  const secondTap = [];
  await flowEngine.step({
    from: '+491701234567',
    message: { text: { body: 'confirm_order' } },
    state: tapState(),
    send: async (intent) => secondTap.push(intent)
  });

  assert.equal(orderCreationCalls, 1, 'PayPal must only be called once across both taps');
  assert.equal(secondTap[0].url, 'https://paypal.example.com/approve/once');
});
