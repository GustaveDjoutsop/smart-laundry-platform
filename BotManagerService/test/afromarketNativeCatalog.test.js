// Phase 2/3 of afromarket-catalog-cart-migration-todo.md: native Meta
// catalog/cart replacing the manual "Choose Category"/"Choose Item"/"Add to
// Cart" flow, gated behind AFROMARKET_NATIVE_CATALOG_ENABLED (off by
// default - see afromarketFlowPlugin.js's isNativeCatalogEnabled comment).
process.env.STRIPE_SECRET_KEY = 'sk_test';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_SUCCESS_URL = 'https://afromarket.example.com/payment-return';
// These tests exercise the post-native-order checkout hand-off through
// checkout_name, the pre-payment collection sequence that's now Stripe-only
// - the provider selector defaults to paypal, which skips it entirely (see
// afromarket-remove-prepayment-address-collection.md).
process.env.AFROMARKET_PAYMENT_PROVIDER = 'stripe';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AfroMarketBot } = require('../src/bots/afromarket/AfroMarketBot');
const { FlowEngine } = require('../src/core/flows/flowEngine');
const { AfroMarketFlowPlugin, buildNativeCatalogSections, isNativeCatalogEnabled } = require('../src/bots/afromarket/afromarketFlowPlugin');
const { paymentEvents } = require('../src/core/payments/paymentEvents');

// eslint-disable-next-line global-require
const botConfig = require('../configs/bots/afromarket.bot.json');

// redisManager is a module-level singleton (see afromarketErasure.test.js) -
// each test gets its own phone number rather than relying on cleanup.
let fromCounter = 0;
function nextFrom() {
  fromCounter += 1;
  return `+49171${String(fromCounter).padStart(7, '0')}`;
}

function createBot(t) {
  const bot = new AfroMarketBot(botConfig);
  t.after(() => paymentEvents.off('payment.completed', bot._onPaymentCompleted));

  const sent = [];
  bot.whatsapp = {
    isConfigured: () => true,
    sendText: async (args) => sent.push({ type: 'text', ...args }),
    sendButtons: async (args) => sent.push({ type: 'buttons', ...args }),
    sendList: async (args) => sent.push({ type: 'list', ...args }),
    sendImage: async (args) => sent.push({ type: 'image', ...args }),
    sendCtaUrl: async (args) => sent.push({ type: 'cta_url', ...args }),
    sendProductList: async (args) => sent.push({ type: 'product_list', ...args }),
    sendCarouselTemplate: async (args) => sent.push({ type: 'template_carousel', ...args })
  };

  return { bot, sent };
}

function createStepper() {
  const flowEngine = new FlowEngine({ botConfig, plugin: new AfroMarketFlowPlugin({ botConfig }) });
  let conversationState = { currentFlowId: null, currentStateId: null, context: {} };

  return async function step(from, text) {
    const outboundIntents = [];
    ({ state: conversationState } = await flowEngine.step({
      from,
      message: { text: { body: text } },
      state: conversationState,
      send: async (outboundIntent) => outboundIntents.push(outboundIntent)
    }));
    return { outboundIntents, conversationState };
  };
}

test('isNativeCatalogEnabled defaults to false when the env var is unset', () => {
  const original = process.env.AFROMARKET_NATIVE_CATALOG_ENABLED;
  delete process.env.AFROMARKET_NATIVE_CATALOG_ENABLED;

  try {
    assert.equal(isNativeCatalogEnabled(), false);
  } finally {
    if (original === undefined) delete process.env.AFROMARKET_NATIVE_CATALOG_ENABLED;
    else process.env.AFROMARKET_NATIVE_CATALOG_ENABLED = original;
  }
});

test('isNativeCatalogEnabled accepts "true" case-insensitively but rejects other truthy-looking values', () => {
  const original = process.env.AFROMARKET_NATIVE_CATALOG_ENABLED;

  try {
    process.env.AFROMARKET_NATIVE_CATALOG_ENABLED = 'true';
    assert.equal(isNativeCatalogEnabled(), true);

    process.env.AFROMARKET_NATIVE_CATALOG_ENABLED = 'TRUE';
    assert.equal(isNativeCatalogEnabled(), true);

    process.env.AFROMARKET_NATIVE_CATALOG_ENABLED = '1';
    assert.equal(isNativeCatalogEnabled(), false);
  } finally {
    if (original === undefined) delete process.env.AFROMARKET_NATIVE_CATALOG_ENABLED;
    else process.env.AFROMARKET_NATIVE_CATALOG_ENABLED = original;
  }
});

test('buildNativeCatalogSections groups afromarket.bot.json products by category', () => {
  const sections = buildNativeCatalogSections(botConfig);

  assert.equal(sections.length, 3);
  const beansSection = sections.find((s) => s.title === '🫘 Beans & Nuts');
  const leavesSection = sections.find((s) => s.title === '🌿 Dried Leaves');
  const snackSection = sections.find((s) => s.title === '🥣 Snack & Breakfast');

  assert.deepEqual(beansSection.productRetailerIds.sort(), ['arachide_blanche_1kg', 'haricot_rouge_1kg']);
  assert.deepEqual(leavesSection.productRetailerIds.sort(), ['ndole_250g', 'okok_100g']);
  assert.deepEqual(snackSection.productRetailerIds.sort(), ['bouillie_jaune_500g']);
});

test('shop_entry falls back to the legacy category list when the native catalog flag is off', async () => {
  const original = process.env.AFROMARKET_NATIVE_CATALOG_ENABLED;
  delete process.env.AFROMARKET_NATIVE_CATALOG_ENABLED;

  try {
    const step = createStepper();
    const from = nextFrom();
    await step(from, 'hi');
    const result = await step(from, 'shop_online');

    assert.equal(result.outboundIntents.length, 1);
    assert.equal(result.outboundIntents[0].type, 'list');
    assert.match(result.outboundIntents[0].body, /Shop Online/);
    assert.equal(result.conversationState.currentStateId, 'groceries_categories');
  } finally {
    if (original === undefined) delete process.env.AFROMARKET_NATIVE_CATALOG_ENABLED;
    else process.env.AFROMARKET_NATIVE_CATALOG_ENABLED = original;
  }
});

test('shop_entry sends only the native product_list message (no immediate second "welcome" message) when the flag is on', async () => {
  const originalFlag = process.env.AFROMARKET_NATIVE_CATALOG_ENABLED;
  const originalCatalogId = process.env.AFROMARKET_CATALOG_ID;
  process.env.AFROMARKET_NATIVE_CATALOG_ENABLED = 'true';
  process.env.AFROMARKET_CATALOG_ID = 'cat_test_123';

  try {
    const step = createStepper();
    const from = nextFrom();
    await step(from, 'hi');
    const result = await step(from, 'shop_online');

    // Regression test: shop_entry used to goto('welcome') directly, which
    // continued the same engine turn straight into rendering the welcome
    // list right behind the product_list - two messages in one turn, read
    // by customers as the bot answering itself (see bug report). It now
    // lands on the silent 'shop_landing' state instead, so only the
    // product_list is sent this turn.
    assert.equal(result.outboundIntents.length, 1);
    assert.equal(result.outboundIntents[0].type, 'product_list');
    assert.equal(result.outboundIntents[0].catalogId, 'cat_test_123');
    assert.equal(result.outboundIntents[0].sections.length, 3);
    assert.equal(result.conversationState.currentStateId, 'shop_landing');
  } finally {
    if (originalFlag === undefined) delete process.env.AFROMARKET_NATIVE_CATALOG_ENABLED;
    else process.env.AFROMARKET_NATIVE_CATALOG_ENABLED = originalFlag;
    if (originalCatalogId === undefined) delete process.env.AFROMARKET_CATALOG_ID;
    else process.env.AFROMARKET_CATALOG_ID = originalCatalogId;
  }
});

test('shop_landing redirects to welcome on the customer\'s next message, without re-sending the product_list', async () => {
  const originalFlag = process.env.AFROMARKET_NATIVE_CATALOG_ENABLED;
  const originalCatalogId = process.env.AFROMARKET_CATALOG_ID;
  process.env.AFROMARKET_NATIVE_CATALOG_ENABLED = 'true';
  process.env.AFROMARKET_CATALOG_ID = 'cat_test_123';

  try {
    const step = createStepper();
    const from = nextFrom();
    await step(from, 'hi');
    await step(from, 'shop_online');

    // Whatever the customer sends next (here: plain free text, since a real
    // order bypasses the flow engine entirely) lands on 'shop_landing' and
    // is redirected to 'welcome' in this separate turn - exactly one
    // 'welcome' list, no repeated product_list.
    const result = await step(from, 'hello again');

    assert.equal(result.outboundIntents.length, 1);
    assert.equal(result.outboundIntents[0].type, 'list');
    assert.match(result.outboundIntents[0].body, /Welcome to/);
    assert.equal(result.conversationState.currentStateId, 'welcome');
  } finally {
    if (originalFlag === undefined) delete process.env.AFROMARKET_NATIVE_CATALOG_ENABLED;
    else process.env.AFROMARKET_NATIVE_CATALOG_ENABLED = originalFlag;
    if (originalCatalogId === undefined) delete process.env.AFROMARKET_CATALOG_ID;
    else process.env.AFROMARKET_CATALOG_ID = originalCatalogId;
  }
});

test('shop_landing: a message matching a main_menu option (e.g. a stale button tap) routes straight there instead of re-rendering welcome first - deliberate, not a bug', async () => {
  const originalFlag = process.env.AFROMARKET_NATIVE_CATALOG_ENABLED;
  const originalCatalogId = process.env.AFROMARKET_CATALOG_ID;
  process.env.AFROMARKET_NATIVE_CATALOG_ENABLED = 'true';
  process.env.AFROMARKET_CATALOG_ID = 'cat_test_123';

  try {
    const step = createStepper();
    const from = nextFrom();
    await step(from, 'hi');
    await step(from, 'shop_online');

    // WhatsApp lets a customer tap an older, still-visible interactive
    // button/list row at any time - normalizeInbound() turns that tap into
    // literal text identical to the row's id (e.g. "recipes"). Landing on
    // 'shop_landing' unarmed and receiving that exact text hands off to
    // 'welcome' -> main_route with the same value main_route would have
    // gotten from a live tap on welcome itself, so it routes directly to
    // recipes_hub in one hop rather than re-showing the welcome menu first.
    // Exactly one message goes out either way - see _handleShopLanding's
    // comment for why this is intentional, not a reintroduction of the
    // double-message bug.
    const result = await step(from, 'recipes');

    assert.equal(result.outboundIntents.length, 1);
    assert.equal(result.outboundIntents[0].type, 'list');
    assert.match(result.outboundIntents[0].body, /Recipe Ideas/);
    assert.equal(result.conversationState.currentStateId, 'recipes_hub');
  } finally {
    if (originalFlag === undefined) delete process.env.AFROMARKET_NATIVE_CATALOG_ENABLED;
    else process.env.AFROMARKET_NATIVE_CATALOG_ENABLED = originalFlag;
    if (originalCatalogId === undefined) delete process.env.AFROMARKET_CATALOG_ID;
    else process.env.AFROMARKET_CATALOG_ID = originalCatalogId;
  }
});

test('shop_landing: a stale "shop_online" tap re-sends the catalog once and re-arms, without ever double-sending welcome', async () => {
  const originalFlag = process.env.AFROMARKET_NATIVE_CATALOG_ENABLED;
  const originalCatalogId = process.env.AFROMARKET_CATALOG_ID;
  process.env.AFROMARKET_NATIVE_CATALOG_ENABLED = 'true';
  process.env.AFROMARKET_CATALOG_ID = 'cat_test_123';

  try {
    const step = createStepper();
    const from = nextFrom();
    await step(from, 'hi');
    await step(from, 'shop_online');

    // Same collision as above, but with the "shop_online" id itself: routes
    // back through shop_entry (re-sending the catalog, once) and re-arms
    // shop_landing for the next round - still exactly one message this turn.
    const result = await step(from, 'shop_online');

    assert.equal(result.outboundIntents.length, 1);
    assert.equal(result.outboundIntents[0].type, 'product_list');
    assert.equal(result.conversationState.currentStateId, 'shop_landing');
  } finally {
    if (originalFlag === undefined) delete process.env.AFROMARKET_NATIVE_CATALOG_ENABLED;
    else process.env.AFROMARKET_NATIVE_CATALOG_ENABLED = originalFlag;
    if (originalCatalogId === undefined) delete process.env.AFROMARKET_CATALOG_ID;
    else process.env.AFROMARKET_CATALOG_ID = originalCatalogId;
  }
});

test('shop_entry falls back to the legacy flow when the flag is on but AFROMARKET_CATALOG_ID is not set', async () => {
  const originalFlag = process.env.AFROMARKET_NATIVE_CATALOG_ENABLED;
  const originalCatalogId = process.env.AFROMARKET_CATALOG_ID;
  process.env.AFROMARKET_NATIVE_CATALOG_ENABLED = 'true';
  delete process.env.AFROMARKET_CATALOG_ID;

  try {
    const step = createStepper();
    const from = nextFrom();
    await step(from, 'hi');
    const result = await step(from, 'shop_online');

    assert.equal(result.outboundIntents[0].type, 'list');
    assert.equal(result.conversationState.currentStateId, 'groceries_categories');
  } finally {
    if (originalFlag === undefined) delete process.env.AFROMARKET_NATIVE_CATALOG_ENABLED;
    else process.env.AFROMARKET_NATIVE_CATALOG_ENABLED = originalFlag;
    if (originalCatalogId === undefined) delete process.env.AFROMARKET_CATALOG_ID;
    else process.env.AFROMARKET_CATALOG_ID = originalCatalogId;
  }
});

// --- Phase 3: native order webhook -----------------------------------------

function orderMessage({ items, catalogId = 'cat_test_123' } = {}) {
  return {
    type: 'order',
    order: {
      catalog_id: catalogId,
      product_items: items
    }
  };
}

test('AfroMarket native order: recomputes price from bot.json, ignoring a tampered webhook price', async (t) => {
  const { bot, sent } = createBot(t);
  const from = nextFrom();

  // quantity: 4 (not 1) clears the 24.99€ minimum order value
  // (4 * 7.99 = 31.96, ignoring the tampered price) - a 1x/€7.99 cart would
  // correctly get redirected to cart_view by the minimum-order gate before
  // ever reaching checkout_name, which isn't what this test is about.
  const handled = await bot._handleNativeOrder({
    from,
    message: orderMessage({ items: [{ product_retailer_id: 'haricot_rouge_1kg', quantity: 4, item_price: 0.01, currency: 'EUR' }] })
  });

  assert.equal(handled, true);
  // Handing off to checkout_start with no saved profile lands on the
  // checkout_name prompt (first of the sequential name/address/email
  // questions - see afromarket.bot.json), whose text includes the cart
  // summary indirectly via cartSummaryText only at checkout_review - but
  // checkout_start itself just routes there. Assert on the persisted cart
  // instead, which is the actual value under test: the real bot.json price
  // (€7.99), not the tampered webhook price (€0.01).
  const redisManagerModule = require('../src/core/redisManager');
  const raw = await redisManagerModule.redisManager.get(`conv:afromarket:${from}`);
  const state = JSON.parse(raw);

  assert.deepEqual(state.context.cart, [{ productId: 'haricot_rouge_1kg', name: 'Haricot Rouge – Meringué 1kg', unitPrice: 7.99, unit: '1 kg', qty: 4 }]);
  assert.equal(state.currentFlowId, 'main_menu');
  // _handleCheckoutStart ran and moved past checkout_start since there's no
  // saved profile for this fresh phone number.
  assert.equal(state.currentStateId, 'checkout_name');
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /delivery/i);
});

test('AfroMarket native order: sums quantity for a repeated product and multiplies unit price correctly downstream', async (t) => {
  const { bot } = createBot(t);
  const from = nextFrom();

  await bot._handleNativeOrder({
    from,
    message: orderMessage({
      items: [
        { product_retailer_id: 'okok_100g', quantity: 2 },
        { product_retailer_id: 'okok_100g', quantity: 1 }
      ]
    })
  });

  const { redisManager } = require('../src/core/redisManager');
  const state = JSON.parse(await redisManager.get(`conv:afromarket:${from}`));

  assert.deepEqual(state.context.cart, [{ productId: 'okok_100g', name: "Feuilles d'OKOK Séchées 100g", unitPrice: 4.99, unit: '100 g', qty: 3 }]);
});

test('AfroMarket native order: an unknown product_retailer_id is skipped, not crashed on, and the rest of the order still processes', async (t) => {
  const { bot } = createBot(t);
  const from = nextFrom();

  const handled = await bot._handleNativeOrder({
    from,
    message: orderMessage({
      items: [
        { product_retailer_id: 'discontinued_item_xyz', quantity: 1 },
        { product_retailer_id: 'ndole_250g', quantity: 1 }
      ]
    })
  });

  assert.equal(handled, true);
  const { redisManager } = require('../src/core/redisManager');
  const state = JSON.parse(await redisManager.get(`conv:afromarket:${from}`));

  assert.deepEqual(state.context.cart, [{ productId: 'ndole_250g', name: 'Ndolè Cameroun – Lavé et Séché 250g', unitPrice: 9.99, unit: '250 g', qty: 1 }]);
});

test('AfroMarket native order: when every line is unknown, the customer is told to re-browse and checkout never starts', async (t) => {
  const { bot, sent } = createBot(t);
  const from = nextFrom();

  const handled = await bot._handleNativeOrder({
    from,
    message: orderMessage({ items: [{ product_retailer_id: 'totally_made_up', quantity: 1 }] })
  });

  assert.equal(handled, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'text');
  assert.match(sent[0].body, /couldn't recognise/);

  const { redisManager } = require('../src/core/redisManager');
  const raw = await redisManager.get(`conv:afromarket:${from}`);
  assert.equal(raw, undefined, 'no conversation state should be written when the whole order is unrecognized');
});

test('AfroMarket native order: notifies the configured admin number about an unknown product, best-effort', async (t) => {
  const original = process.env.AFROMARKET_ADMIN_PHONE;
  process.env.AFROMARKET_ADMIN_PHONE = '+491700000099';

  try {
    const { bot, sent } = createBot(t);
    const from = nextFrom();

    await bot._handleNativeOrder({
      from,
      message: orderMessage({ items: [{ product_retailer_id: 'ghost_product', quantity: 1 }, { product_retailer_id: 'okok_100g', quantity: 1 }] })
    });

    const adminMessages = sent.filter((s) => s.to === '+491700000099');
    assert.equal(adminMessages.length, 1);
    assert.match(adminMessages[0].body, /ghost_product/);
  } finally {
    if (original === undefined) delete process.env.AFROMARKET_ADMIN_PHONE;
    else process.env.AFROMARKET_ADMIN_PHONE = original;
  }
});

test('AfroMarket native order: does not notify any admin when AFROMARKET_ADMIN_PHONE is not set', async (t) => {
  const original = process.env.AFROMARKET_ADMIN_PHONE;
  delete process.env.AFROMARKET_ADMIN_PHONE;

  try {
    const { bot, sent } = createBot(t);
    const from = nextFrom();

    await bot._handleNativeOrder({
      from,
      message: orderMessage({ items: [{ product_retailer_id: 'ghost_product', quantity: 1 }, { product_retailer_id: 'okok_100g', quantity: 1 }] })
    });

    // Only the customer-facing checkout_name prompt should have gone out.
    assert.equal(sent.length, 1);
  } finally {
    if (original === undefined) delete process.env.AFROMARKET_ADMIN_PHONE;
    else process.env.AFROMARKET_ADMIN_PHONE = original;
  }
});

test('AfroMarket native order: a message that is not type "order" is ignored (returns false, no side effects)', async (t) => {
  const { bot, sent } = createBot(t);
  const from = nextFrom();

  const handled = await bot._handleNativeOrder({ from, message: { type: 'text', text: { body: 'hi' } } });

  assert.equal(handled, false);
  assert.equal(sent.length, 0);
});

test('AfroMarket handleMessage: routes a type "order" inbound message into the native order intercept', async (t) => {
  const { bot, sent } = createBot(t);
  const from = nextFrom();

  // quantity: 4 clears the 24.99€ minimum order value (4 * 7.99 = 31.96) -
  // this test is about routing, not the minimum-order gate.
  await bot.handleMessage({ from, message: orderMessage({ items: [{ product_retailer_id: 'arachide_blanche_1kg', quantity: 4 }] }) });

  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /delivery/i);
});
