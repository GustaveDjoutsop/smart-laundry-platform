// Covers Workstream 3 (afromarket-paypal-migration-and-shipping-todo.md):
// the 24.99€ hard minimum order value. No payment provider env vars are set
// in this file - the minimum-order check runs before provider selection in
// _handleCheckout, so it's exercised here against the legacy
// no-provider-configured branch, independent of Stripe/PayPal specifics
// (see afromarketPaymentCheckout.test.js/afromarketPaypalCheckout.test.js
// for the equivalent checks with a real provider configured).
const test = require('node:test');
const assert = require('node:assert/strict');

const { FlowEngine } = require('../src/core/flows/flowEngine');
const { AfroMarketFlowPlugin, cartTotal } = require('../src/bots/afromarket/afromarketFlowPlugin');

// eslint-disable-next-line global-require
const botConfig = require('../configs/bots/afromarket.bot.json');

// Drives to checkout_review via a real product (name/checkoutName/address/etc.
// all need to be legitimately set for _handleCheckout to reach the minimum-
// order check at all), then swaps in a synthetic single-line cart with an
// exact target total - the catalog's fixed prices (7.99/9.99/4.99/...) can't
// combine to hit exactly 24.99€ or 24.98€, and the boundary is the entire
// point of these tests.
async function driveToCheckoutReviewWithCartTotal(targetTotal) {
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

  await step('hi');
  await step('shop_online');
  await step('cat_beans_nuts');
  await step('product_haricot_rouge_1kg');
  await step('cart_add');
  await step('view_cart');
  await step('start_checkout');
  await step('Jane Doe');
  await step('12 Main St, Berlin');
  const review = await step('skip');

  conversationState.context.cart = [{ productId: 'test_item', name: 'Test Item', unitPrice: targetTotal, unit: '1', qty: 1 }];
  assert.equal(cartTotal(conversationState.context.cart), targetTotal, 'test setup sanity check');

  return { flowEngine, conversationState, review, step };
}

test('AfroMarket checkout: a cart exactly at the 24.99€ minimum is allowed to check out', async () => {
  const { flowEngine, conversationState } = await driveToCheckoutReviewWithCartTotal(24.99);

  const outboundIntents = [];
  await flowEngine.step({
    from: '+491701234567',
    message: { text: { body: 'confirm_order' } },
    state: conversationState,
    send: async (intent) => outboundIntents.push(intent)
  });

  // No provider configured in this file - legacy instant confirmation path,
  // proving the order was NOT blocked by the minimum-order check.
  assert.match(outboundIntents[0].body, /Order confirmed/);
});

test('AfroMarket checkout: a cart one cent under the 24.99€ minimum (24.98€) is blocked, cart preserved, order not confirmed', async () => {
  const { flowEngine, conversationState } = await driveToCheckoutReviewWithCartTotal(24.98);

  const outboundIntents = [];
  const { state: nextState } = await flowEngine.step({
    from: '+491701234567',
    message: { text: { body: 'confirm_order' } },
    state: conversationState,
    send: async (intent) => outboundIntents.push(intent)
  });

  assert.equal(outboundIntents[0].type, 'text');
  assert.match(outboundIntents[0].body, /Minimum order is €24\.99/);
  assert.match(outboundIntents[0].body, /€0\.01 more/);
  assert.doesNotMatch(outboundIntents[0].body, /Order confirmed/);

  // Cart survives, unmodified - no fulfillment, no payment call attempted.
  assert.equal(nextState.context.cart.length, 1);
  assert.equal(nextState.context.cart[0].unitPrice, 24.98);
});

test('AfroMarket cart_view shows the shortfall nudge when under the minimum order value', async () => {
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

test('AfroMarket checkout_review shows the shortfall nudge when under the minimum order value', async () => {
  const { review } = await driveToCheckoutReviewWithCartTotal(20);

  assert.match(review.outboundIntents[0].body, /confirm your order/i);
  assert.match(review.outboundIntents[0].body, /Minimum order is €24\.99/);
});

test('AfroMarket cart_view shows no nudge for an empty cart or a cart already at/above the minimum', async () => {
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

  await step('hi');
  await step('shop_online');

  // Empty cart: no nudge, just the existing empty-cart message.
  const emptyView = await step('view_cart');
  assert.match(emptyView.outboundIntents[0].body, /cart is empty/);
  assert.doesNotMatch(emptyView.outboundIntents[0].body, /Minimum order/);

  // At-threshold cart (via cartTotal, not the chat flow - see the boundary
  // tests above for why): directly clears the minimum, no nudge expected.
  conversationState.context.cart = [{ productId: 'test_item', name: 'Test Item', unitPrice: 24.99, unit: '1', qty: 1 }];
  const atThreshold = await step('view_cart');
  assert.doesNotMatch(atThreshold.outboundIntents[0].body, /Minimum order/);
});
