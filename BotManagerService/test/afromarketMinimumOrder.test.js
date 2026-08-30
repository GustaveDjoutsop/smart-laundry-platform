// Covers Workstream 3 (afromarket-paypal-migration-and-shipping-todo.md) and
// its bugfix (afromarket-minimum-order-checkout-flow-bugfix.md): the 24.99€
// hard minimum order value, and the flow-sequencing fix that makes
// checkout_review's Confirm-Order screen unreachable for an under-threshold
// cart (previously it rendered anyway, with the nudge merely appended
// inside it - a rejected confirm_order tap re-sent that exact same screen
// verbatim, reading as the bot being stuck). No payment provider env vars
// are set in this file - the minimum-order check runs before provider
// selection in _handleCheckout, so it's exercised here against the legacy
// no-provider-configured branch, independent of Stripe/PayPal specifics
// (see afromarketPaymentCheckout.test.js/afromarketPaypalCheckout.test.js
// for the equivalent checks with a real provider configured).
const test = require('node:test');
const assert = require('node:assert/strict');

const { FlowEngine } = require('../src/core/flows/flowEngine');
const { AfroMarketFlowPlugin, cartTotal } = require('../src/bots/afromarket/afromarketFlowPlugin');

// eslint-disable-next-line global-require
const botConfig = require('../configs/bots/afromarket.bot.json');

function createStepper() {
  const flowEngine = new FlowEngine({ botConfig, plugin: new AfroMarketFlowPlugin({ botConfig }) });
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
  return { flowEngine, step, getState: () => conversationState, setCart: (cart) => { conversationState.context.cart = cart; } };
}

// Walks through with a real, qualifying cart (4x haricot_rouge_1kg = 31.96€,
// clears the 24.99€ minimum) so _handleCheckoutStart's entry gate legitimately
// lets it reach checkout_review, then swaps in a synthetic single-line cart
// with an exact target total right before the final confirm_order tap - the
// catalog's fixed prices can't combine to hit exactly 24.99€/24.98€, and
// that boundary is the point of the exact-threshold tests below.
// _handleCheckout re-validates whatever cart is current at confirm time, not
// the cart that was present when checkout_review was first entered, so this
// still genuinely exercises that validation.
async function driveToCheckoutReviewThenSwapCartTotal(targetTotal) {
  const { flowEngine, step, getState, setCart } = createStepper();

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
  assert.match(review.outboundIntents[0].body, /confirm your order/i, 'test setup sanity check: must have actually reached checkout_review');

  setCart([{ productId: 'test_item', name: 'Test Item', unitPrice: targetTotal, unit: '1', qty: 1 }]);
  assert.equal(cartTotal(getState().context.cart), targetTotal, 'test setup sanity check: target total');

  return { flowEngine, state: getState() };
}

test('AfroMarket checkout: a cart exactly at the 24.99€ minimum is allowed to check out', async () => {
  const { flowEngine, state } = await driveToCheckoutReviewThenSwapCartTotal(24.99);

  const outboundIntents = [];
  await flowEngine.step({
    from: '+491701234567',
    message: { text: { body: 'confirm_order' } },
    state,
    send: async (intent) => outboundIntents.push(intent)
  });

  // No provider configured in this file - legacy instant confirmation path,
  // proving the order was NOT blocked by the minimum-order check.
  assert.match(outboundIntents[0].body, /Order confirmed/);
});

test('AfroMarket checkout: a cart one cent under the 24.99€ minimum (24.98€) is blocked at confirm time with a distinct rejection, cart preserved', async () => {
  const { flowEngine, state } = await driveToCheckoutReviewThenSwapCartTotal(24.98);

  const outboundIntents = [];
  const { state: nextState } = await flowEngine.step({
    from: '+491701234567',
    message: { text: { body: 'confirm_order' } },
    state,
    send: async (intent) => outboundIntents.push(intent)
  });

  assert.equal(outboundIntents[0].type, 'text');
  // Distinct rejection copy (❌), not the standing cart_view/checkout_review
  // nudge (⚠️) - the actual bug: a rejected confirm read as the bot
  // re-sending the identical screen it had already shown, not a decline.
  assert.match(outboundIntents[0].body, /wasn't confirmed/);
  assert.match(outboundIntents[0].body, /€0\.01 short/);
  assert.match(outboundIntents[0].body, /€24\.99 minimum/);
  assert.doesNotMatch(outboundIntents[0].body, /Order confirmed/);

  // Cart and saved address survive, unmodified - no fulfillment, no payment
  // call attempted, no data loss on a rejected attempt.
  assert.equal(nextState.context.cart.length, 1);
  assert.equal(nextState.context.cart[0].unitPrice, 24.98);
  assert.equal(nextState.context.checkoutName, 'Jane Doe');

  // Routed to cart_view, not back to checkout_review - the fix's actual
  // point: never re-render the same Confirm-Order screen the customer was
  // just declined from.
  assert.equal(nextState.currentStateId, 'cart_view');
});

test('AfroMarket: tapping Checkout on an under-threshold cart never reaches checkout_review - redirects straight to cart_view with the nudge', async () => {
  const { step, getState } = createStepper();

  await step('hi');
  await step('shop_online');
  await step('cat_beans_nuts');
  await step('product_haricot_rouge_1kg');
  // 1x haricot_rouge_1kg = 7.99€, well under the 24.99€ minimum.
  await step('cart_add');
  await step('view_cart');
  const result = await step('start_checkout');

  // Must be the cart_view screen (with its shortfall nudge), not a name
  // prompt (checkout_name) or the checkout_review confirm screen - this is
  // the fix's primary requirement: the customer should never be asked for
  // name/address/email, let alone see an active Confirm Order button, for a
  // cart that cannot be confirmed.
  assert.match(result.outboundIntents[0].body, /Minimum order is €24\.99/);
  assert.match(result.outboundIntents[0].body, /€17\.00 more/);
  assert.doesNotMatch(result.outboundIntents[0].body, /full name/i);
  assert.doesNotMatch(result.outboundIntents[0].body, /confirm your order/i);
  assert.equal(getState().currentStateId, 'cart_view');
});

test('AfroMarket: "Start Over" on checkout_review re-entering the name/address sequence still respects the minimum-order gate as a backstop', async () => {
  // Regression guard for _handleFinishCheckoutDetails's own gate: reaches
  // checkout_review legitimately (qualifying cart), taps restart_checkout,
  // then the cart is (synthetically) dropped below threshold before the
  // sequential name/address/email chain completes - simulating the only
  // way the cart could plausibly change mid-sequence.
  const { step, getState, setCart } = createStepper();

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
  await step('skip');

  await step('restart_checkout');
  setCart([{ productId: 'test_item', name: 'Test Item', unitPrice: 10, unit: '1', qty: 1 }]);
  await step('Jane Doe');
  await step('12 Main St, Berlin');
  const result = await step('skip');

  assert.match(result.outboundIntents[0].body, /Minimum order is €24\.99/);
  assert.doesNotMatch(result.outboundIntents[0].body, /confirm your order/i);
  assert.equal(getState().currentStateId, 'cart_view');
});

test('AfroMarket: a qualifying cart (at/above the minimum) still shows the full checkout_review screen with a working Confirm Order button - regression guard', async () => {
  const { step, getState } = createStepper();

  await step('hi');
  await step('shop_online');
  await step('cat_beans_nuts');
  await step('product_haricot_rouge_1kg');
  // 4x haricot_rouge_1kg = 31.96€, clears the 24.99€ minimum.
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
  assert.doesNotMatch(review.outboundIntents[0].body, /Minimum order/);
  assert.deepEqual(
    review.outboundIntents[0].buttons.map((b) => b.id),
    ['confirm_order', 'restart_checkout', 'cancel_checkout']
  );

  const confirmed = await step('confirm_order');
  assert.match(confirmed.outboundIntents[0].body, /Order confirmed/);
  assert.equal(getState().context.cart.length, 0);
});

test('AfroMarket cart_view shows the shortfall nudge when under the minimum order value', async () => {
  const { step } = createStepper();

  await step('hi');
  await step('shop_online');
  await step('cat_beans_nuts');
  await step('product_haricot_rouge_1kg');
  // 1x haricot_rouge_1kg = 7.99€, well under the 24.99€ minimum.
  const result = await step('cart_add');
  const viewed = await step('view_cart');

  assert.match(viewed.outboundIntents[0].body, /Minimum order is €24\.99/);
  assert.match(viewed.outboundIntents[0].body, /€17\.00 more/);
  assert.equal(result.outboundIntents.length, 1, 'sanity: cart_add response unaffected');
});

test('AfroMarket cart_view shows no nudge for an empty cart or a cart already at/above the minimum', async () => {
  const { step, setCart } = createStepper();

  await step('hi');
  await step('shop_online');

  // Empty cart: no nudge, just the existing empty-cart message.
  const emptyView = await step('view_cart');
  assert.match(emptyView.outboundIntents[0].body, /cart is empty/);
  assert.doesNotMatch(emptyView.outboundIntents[0].body, /Minimum order/);

  // At-threshold cart: directly clears the minimum, no nudge expected.
  setCart([{ productId: 'test_item', name: 'Test Item', unitPrice: 24.99, unit: '1', qty: 1 }]);
  const atThreshold = await step('view_cart');
  assert.doesNotMatch(atThreshold.outboundIntents[0].body, /Minimum order/);
});
