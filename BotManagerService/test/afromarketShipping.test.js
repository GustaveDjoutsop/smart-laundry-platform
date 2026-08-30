// Covers Workstream 4 (afromarket-paypal-migration-and-shipping-todo.md):
// flat config-driven tiered shipping. Disabled by default
// (AFROMARKET_SHIPPING_ENABLED) - every shippingTiers.priceEur in
// afromarket.bot.json is still a null placeholder pending Sunday's real
// Packlink rate lookup, so most of this file tests the helpers directly
// (basketWeightGrams/shippingFeeFor) plus the disabled-by-default and
// null-price-fails-loudly behavior; a small number of tests explicitly
// enable the flag with a real tiers config to cover the enabled path.
// A payment provider must be configured to reach _handleCheckout's shipping
// calculation at all - it runs only on the paid path, after the
// no-provider-configured dev fallback returns early.
process.env.STRIPE_SECRET_KEY = 'sk_test';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_SUCCESS_URL = 'https://afromarket.example.com/payment-return';
process.env.AFROMARKET_PAYMENT_PROVIDER = 'stripe';

const test = require('node:test');
const assert = require('node:assert/strict');

let currentFetchImpl = async () => {
  throw new Error('currentFetchImpl not set for this test');
};
global.fetch = (...args) => currentFetchImpl(...args);

const {
  basketWeightGrams,
  shippingFeeFor,
  isShippingEnabled,
  buildOrderConfirmationText,
  AfroMarketFlowPlugin
} = require('../src/bots/afromarket/afromarketFlowPlugin');
const { FlowEngine } = require('../src/core/flows/flowEngine');

// eslint-disable-next-line global-require
const realBotConfig = require('../configs/bots/afromarket.bot.json');

const PRODUCTS = [
  { id: 'a', weightGrams: 1000 },
  { id: 'b', weightGrams: 250 }
];

const TIERS = [
  { maxWeightGrams: 3000, priceEur: 4.99 },
  { maxWeightGrams: 6000, priceEur: 7.99 },
  { maxWeightGrams: 10000, priceEur: 12.99 },
  { maxWeightGrams: null, priceEur: 19.99 }
];

const PLACEHOLDER_TIERS = [
  { maxWeightGrams: 3000, priceEur: null },
  { maxWeightGrams: null, priceEur: null }
];

test('isShippingEnabled defaults to false, and is only true for the exact string "true"', () => {
  delete process.env.AFROMARKET_SHIPPING_ENABLED;
  assert.equal(isShippingEnabled(), false);

  process.env.AFROMARKET_SHIPPING_ENABLED = 'true';
  assert.equal(isShippingEnabled(), true);

  process.env.AFROMARKET_SHIPPING_ENABLED = 'yes';
  assert.equal(isShippingEnabled(), false);

  delete process.env.AFROMARKET_SHIPPING_ENABLED;
});

test('basketWeightGrams sums qty * product.weightGrams across cart lines', () => {
  const cart = [
    { productId: 'a', qty: 2 },
    { productId: 'b', qty: 3 }
  ];

  assert.equal(basketWeightGrams(cart, PRODUCTS), 2 * 1000 + 3 * 250);
});

test('basketWeightGrams throws (does not silently treat as 0g) when a cart line references an unknown product', () => {
  const cart = [{ productId: 'discontinued_item', qty: 1 }];

  assert.throws(() => basketWeightGrams(cart, PRODUCTS), /discontinued_item/);
});

test('basketWeightGrams throws when a product exists but has no weightGrams', () => {
  const cart = [{ productId: 'no_weight', qty: 1 }];
  const products = [{ id: 'no_weight' }];

  assert.throws(() => basketWeightGrams(cart, products), /no_weight/);
});

test('shippingFeeFor selects the correct tier at each boundary weight', () => {
  assert.equal(shippingFeeFor(1, TIERS), 4.99);
  assert.equal(shippingFeeFor(3000, TIERS), 4.99, 'exactly at a tier boundary belongs to that (lower) tier');
  assert.equal(shippingFeeFor(3001, TIERS), 7.99);
  assert.equal(shippingFeeFor(6000, TIERS), 7.99);
  assert.equal(shippingFeeFor(6001, TIERS), 12.99);
  assert.equal(shippingFeeFor(10000, TIERS), 12.99);
  assert.equal(shippingFeeFor(10001, TIERS), 19.99, 'anything above every finite tier falls into the null-maxWeightGrams catch-all');
});

test('shippingFeeFor throws instead of charging 0€ when the matched tier is still a null-price placeholder', () => {
  assert.throws(() => shippingFeeFor(1000, PLACEHOLDER_TIERS), /no priceEur configured/);
});

test('shippingFeeFor throws when no tier at all is configured', () => {
  assert.throws(() => shippingFeeFor(1000, []), /No shipping tier/);
});

test('buildOrderConfirmationText includes a Shipping line and adds it to the total when shippingFeeEur is set', () => {
  const cart = [{ productId: 'a', name: 'Item A', unitPrice: 10, qty: 1 }];

  const text = buildOrderConfirmationText({
    orderNumber: 'AM-1',
    cart,
    name: 'Jane',
    address: 'Somewhere',
    phone: '+491701234567',
    shippingFeeEur: 4.99
  });

  assert.match(text, /Shipping: €4\.99/);
  assert.match(text, /Total: \*€14\.99\*/);
});

test('buildOrderConfirmationText shows no Shipping line at all when shippingFeeEur is 0/undefined - unchanged from before Workstream 4', () => {
  const cart = [{ productId: 'a', name: 'Item A', unitPrice: 10, qty: 1 }];

  const withoutShipping = buildOrderConfirmationText({ orderNumber: 'AM-1', cart, name: 'Jane', address: 'Somewhere', phone: '+491701234567' });
  assert.doesNotMatch(withoutShipping, /Shipping:/);
  assert.match(withoutShipping, /Total: \*€10\.00\*/);
});

async function driveToConfirmOrder(step) {
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
  await step('jane@example.com');
  return step('confirm_order');
}

function createStepper(botConfig) {
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

test('_handleCheckout blocks checkout (not a silent 0€ shipping charge) when enabled against the real bot.json config, whose shipping tier prices are still null placeholders', async () => {
  const previousEnabled = process.env.AFROMARKET_SHIPPING_ENABLED;
  process.env.AFROMARKET_SHIPPING_ENABLED = 'true';

  try {
    currentFetchImpl = async () => {
      throw new Error('no payment provider API call should happen - shipping calculation must block checkout first');
    };

    const step = createStepper(realBotConfig);
    const result = await driveToConfirmOrder(step);

    assert.equal(result.outboundIntents[0].type, 'text');
    assert.match(result.outboundIntents[0].body, /Shipping is temporarily unavailable/);
    assert.equal(result.conversationState.context.cart.length, 1, 'cart preserved, not cleared');
  } finally {
    process.env.AFROMARKET_SHIPPING_ENABLED = previousEnabled;
  }
});

test('_handleCheckout includes the shipping fee in the amount charged when enabled with real tier prices', async () => {
  const previousEnabled = process.env.AFROMARKET_SHIPPING_ENABLED;
  process.env.AFROMARKET_SHIPPING_ENABLED = 'true';

  // Same product catalog as afromarket.bot.json, but with real shippingTiers
  // prices filled in instead of the still-unset placeholders - proves the
  // enabled+configured path actually charges shipping, not just that the
  // placeholder path fails safely (covered above).
  const botConfig = {
    ...realBotConfig,
    shippingTiers: [
      { maxWeightGrams: 3000, priceEur: 4.99 },
      { maxWeightGrams: null, priceEur: 9.99 }
    ]
  };

  try {
    let capturedBody = null;
    currentFetchImpl = async (url, init) => {
      capturedBody = init.body;
      return { ok: true, status: 200, json: async () => ({ id: 'cs_test_shipping', url: 'https://checkout.stripe.com/c/pay/cs_test_shipping' }) };
    };

    const step = createStepper(botConfig);
    const result = await driveToConfirmOrder(step);

    // 4x haricot_rouge_1kg (7.99€, 1000g each) = 31.96€ items, 4000g total,
    // which lands in the null-maxWeightGrams (9.99€) tier since 4000 > 3000.
    assert.equal(result.outboundIntents[0].type, 'cta_url');
    assert.ok(capturedBody, 'expected a captured Stripe request body');
    assert.match(capturedBody, /unit_amount%5D=4195/, 'items (31.96) + shipping (9.99) = 41.95 -> 4195 cents');
  } finally {
    process.env.AFROMARKET_SHIPPING_ENABLED = previousEnabled;
  }
});
