// getCarouselFooterDelayMs() defaults to 6000ms in production (see
// flowEngine.js's comment on why) - none of these tests assert on actual
// wall-clock timing, only send order/content, so there's nothing to gain
// from eating that delay for real on every run. Set before requiring
// flowEngine.js since the value is read fresh per call, not cached.
process.env.CAROUSEL_FOOTER_DELAY_MS = '0';

const test = require('node:test');
const assert = require('node:assert/strict');

const { FlowEngine } = require('../src/core/flows/flowEngine');
const { AfroMarketFlowPlugin, findCurrentPromoProduct, computePercentOff, formatEuro } = require('../src/bots/afromarket/afromarketFlowPlugin');

// eslint-disable-next-line global-require
const botConfig = require('../configs/bots/afromarket.bot.json');

function createStepper() {
  const flowEngine = new FlowEngine({ botConfig, plugin: new AfroMarketFlowPlugin({ botConfig }) });
  let conversationState = { currentFlowId: null, currentStateId: null, context: {} };

  return async function step(text) {
    const outboundIntents = [];
    ({ state: conversationState } = await flowEngine.step({
      from: '+33600000000',
      phone: '+33600000000',
      message: { text: { body: text } },
      state: conversationState,
      send: async (outboundIntent) => outboundIntents.push(outboundIntent)
    }));
    return { outboundIntents, conversationState };
  };
}

test('AfroMarket: greeting shows Jasper-style main menu with 5 sections', async () => {
  const step = createStepper();
  const { outboundIntents } = await step('hi');

  assert.equal(outboundIntents.length, 1);
  assert.equal(outboundIntents[0].type, 'list');
  assert.match(outboundIntents[0].body, /Welcome to \*AfroMarket\*/);

  const rowIds = outboundIntents[0].sections.flatMap((section) => section.rows.map((row) => row.id));
  assert.deepEqual(rowIds, ['shop_online', 'recipes', 'current_promo', 'afro_restaurant', 'afromarket_store']);
});

test('AfroMarket: full shop -> product -> cart -> checkout flow', async () => {
  const step = createStepper();

  await step('hi');
  let result = await step('shop_online');
  assert.equal(result.outboundIntents[0].type, 'list');
  assert.match(result.outboundIntents[0].body, /Shop Online/);

  result = await step('cat_beans_nuts');
  assert.match(result.outboundIntents[0].body, /Beans & Nuts/);

  result = await step('product_haricot_rouge_1kg');
  assert.equal(result.outboundIntents.length, 1);
  assert.equal(result.outboundIntents[0].type, 'buttons');
  assert.match(result.outboundIntents[0].image, /haricot-rouge/);
  assert.match(result.outboundIntents[0].body, /Haricot Rouge – Meringué 1kg/);
  assert.match(result.outboundIntents[0].body, /€7\.99/);
  assert.match(result.outboundIntents[0].body, /What would you like to do\?/);
  assert.deepEqual(
    result.outboundIntents[0].buttons.map((b) => b.id),
    ['cart_add', 'view_cart', 'back_category']
  );

  result = await step('cart_add');
  assert.match(result.outboundIntents[0].body, /Added \*Haricot Rouge – Meringué 1kg\* \(€7\.99\)/);

  result = await step('cart_add');
  assert.match(result.outboundIntents[0].body, /Added \*Haricot Rouge – Meringué 1kg\*/);

  result = await step('view_cart');
  assert.match(result.outboundIntents[0].body, /2x Haricot Rouge – Meringué 1kg — €15\.98/);
  assert.match(result.outboundIntents[0].body, /Total: €15\.98/);

  result = await step('start_checkout');
  assert.match(result.outboundIntents[0].body, /full name/i);

  result = await step('Jane Doe');
  assert.match(result.outboundIntents[0].body, /delivery address/i);

  result = await step('12 Main St, Berlin');
  assert.match(result.outboundIntents[0].body, /email address/i);

  result = await step('jane@example.com');
  assert.match(result.outboundIntents[0].body, /confirm your order/i);
  assert.match(result.outboundIntents[0].body, /Name: Jane Doe/);
  assert.match(result.outboundIntents[0].body, /Address: 12 Main St, Berlin/);
  assert.match(result.outboundIntents[0].body, /Phone: \+33600000000/);
  assert.match(result.outboundIntents[0].body, /Email: jane@example\.com/);
  assert.deepEqual(
    result.outboundIntents[0].buttons.map((b) => b.id),
    ['confirm_order', 'restart_checkout', 'cancel_checkout']
  );

  result = await step('confirm_order');
  const confirmation = result.outboundIntents[0].body;
  assert.match(confirmation, /Order confirmed/);
  assert.match(confirmation, /Hi Jane Doe/);
  assert.match(confirmation, /order number is \*AM-/);
  assert.match(confirmation, /2x Haricot Rouge – Meringué 1kg/);
  assert.match(confirmation, /Total: \*€15\.98\*/);
  assert.match(confirmation, /Delivering to: 12 Main St, Berlin/);
  assert.match(confirmation, /Contact: \+33600000000/);
  assert.equal(result.outboundIntents[0].type, 'buttons');
  assert.deepEqual(
    result.outboundIntents[0].buttons.map((b) => b.id),
    ['shop_again', 'menu']
  );

  assert.deepEqual(result.conversationState.context.cart, []);

  // The confirmation screen's own "Main Menu" button must show the menu
  // immediately in the same tap — no silent swallowed message first.
  result = await step('menu');
  assert.equal(result.outboundIntents.length, 1);
  assert.equal(result.outboundIntents[0].type, 'list');
  assert.match(result.outboundIntents[0].body, /Welcome to \*AfroMarket\*/);
});

test('AfroMarket: checking out with an empty cart shows a warning instead of an order', async () => {
  const step = createStepper();

  await step('hi');
  await step('shop_online');
  await step('cat_beans_nuts');
  await step('product_haricot_rouge_1kg');
  await step('view_cart');
  await step('start_checkout');
  await step('Jane Doe');
  await step('Some Address');
  await step('jane@example.com');
  const result = await step('confirm_order');

  assert.match(result.outboundIntents[0].body, /cart was empty/);
});

test('AfroMarket: checkout reuses a saved delivery address instead of asking again', async () => {
  const customerProfileStore = {
    calls: [],
    async get({ botId, whatsappId }) {
      this.calls.push({ botId, whatsappId });
      return { name: 'Jane Doe', delivery_address: '12 Main St, Berlin' };
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
      from: '+33600000000',
      phone: '+33600000000',
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

  // Straight to review, pre-filled - no free-text "reply with your details" prompt.
  const result = await step('start_checkout');
  assert.match(result.outboundIntents[0].body, /found your delivery details from last time/i);
  assert.match(result.outboundIntents[0].body, /Name: Jane Doe/);
  assert.match(result.outboundIntents[0].body, /Address: 12 Main St, Berlin/);
  assert.match(result.outboundIntents[0].body, /Phone: \+33600000000/);
  assert.deepEqual(
    result.outboundIntents[0].buttons.map((b) => b.id),
    ['confirm_order', 'restart_checkout', 'cancel_checkout']
  );
  assert.deepEqual(customerProfileStore.calls, [{ botId: 'afromarket', whatsappId: '+33600000000' }]);

  const confirmed = await step('confirm_order');
  const confirmation = confirmed.outboundIntents[0].body;
  assert.match(confirmation, /Order confirmed/);
  assert.match(confirmation, /Delivering to: 12 Main St, Berlin/);
  assert.match(confirmation, /deliver within 3 days/i);
});

test('AfroMarket: a saved profile with an email on file prefills it too, instead of leaving it blank', async () => {
  // Closes a real coverage gap flagged in review: every other saved-profile
  // test's mock returns only name/delivery_address (matching the shape
  // saved profiles had before this migration), so _handleCheckoutStart's
  // new `ctx.set('checkoutEmail', profile.email || '')` line had zero
  // coverage. A returning customer with an email on file should see it
  // pre-filled on checkout_review, not be asked again.
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
      from: '+33600000000',
      phone: '+33600000000',
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

  const result = await step('start_checkout');
  assert.match(result.outboundIntents[0].body, /found your delivery details from last time/i);
  assert.match(result.outboundIntents[0].body, /Email: jane@example\.com/);
  assert.equal(conversationState.context.checkoutEmail, 'jane@example.com');
});

test('AfroMarket: "Start Over" on a reused saved address falls back to the sequential checkout flow', async () => {
  const customerProfileStore = {
    async get() {
      return { name: 'Jane Doe', delivery_address: '12 Main St, Berlin' };
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
      from: '+33600000000',
      phone: '+33600000000',
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

  const restarted = await step('restart_checkout');
  assert.match(restarted.outboundIntents[0].body, /full name/i);

  await step('New Customer');
  await step('99 Other St, Hamburg');
  const result = await step('new@example.com');
  assert.doesNotMatch(result.outboundIntents[0].body, /found your delivery details from last time/i);
  assert.match(result.outboundIntents[0].body, /Please confirm your order/i);
  assert.match(result.outboundIntents[0].body, /Address: 99 Other St, Hamburg/);
});

test('AfroMarket: a saved-profile lookup failure falls back to the sequential checkout flow instead of blocking checkout', async () => {
  // Deliberately exercises _handleCheckoutStart's own try/catch with an
  // explicit mock, rather than relying on other tests' incidental coverage
  // via getPool() throwing when DATABASE_URL is unset in this environment -
  // keeps this behavior intentionally tested even if that env detail changes.
  const customerProfileStore = {
    async get() {
      throw new Error('connection refused');
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
      from: '+33600000000',
      phone: '+33600000000',
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

  const result = await step('start_checkout');
  assert.match(result.outboundIntents[0].body, /full name/i);
});

test('AfroMarket: a multi-line address is captured verbatim, newlines included', async () => {
  const step = createStepper();

  await step('hi');
  await step('shop_online');
  await step('cat_beans_nuts');
  await step('product_haricot_rouge_1kg');
  await step('view_cart');
  await step('start_checkout');
  await step('Jane Doe');
  await step('12 Main St\nApt 4B, near the market');
  const result = await step('jane@example.com');

  // Each field is now its own single question (see afromarket.bot.json's
  // checkout_name -> checkout_address -> checkout_email chain), so a
  // multi-line reply to "what's your delivery address?" is simply the whole
  // answer, embedded newline and all - no continuation-line parsing needed
  // (the old combined-message parser used to join wrapped lines with a
  // space; that mechanism doesn't exist anymore because there's nothing left
  // for a line to be a "continuation" of).
  assert.match(result.outboundIntents[0].body, /confirm your order/i);
  assert.match(result.outboundIntents[0].body, /Address: 12 Main St\nApt 4B, near the market/);
});

test('AfroMarket: checkout phone is derived from the WhatsApp sender even without a leading +', async () => {
  const flowEngine = new FlowEngine({ botConfig, plugin: new AfroMarketFlowPlugin({ botConfig }) });
  let conversationState = { currentFlowId: null, currentStateId: null, context: {} };
  const step = async (text) => {
    const outboundIntents = [];
    ({ state: conversationState } = await flowEngine.step({
      from: '491701234567',
      phone: '491701234567',
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
  await step('view_cart');
  await step('start_checkout');
  await step('Jane Doe');
  await step('12 Main St, Berlin');
  const result = await step('skip');

  assert.match(result.outboundIntents[0].body, /Phone: \+491701234567/);
});

test('AfroMarket: a BSUID-only customer (no phone) gets an empty checkout Phone field, not a fabricated one', async () => {
  // Regression test flagged in review: `from` is a routing identifier that
  // may be a BSUID once WhatsApp usernames are in play - `ctx.from` used to
  // be blindly "+"-prefixed into the checkout Phone field, which would have
  // produced garbage like "+user.9373795779eb..." for a username adopter
  // with no phone number on this interaction. See
  // afromarket-bsuid-codebase-readiness-agent-instructions.md.
  const flowEngine = new FlowEngine({ botConfig, plugin: new AfroMarketFlowPlugin({ botConfig }) });
  let conversationState = { currentFlowId: null, currentStateId: null, context: {} };
  const step = async (text) => {
    const outboundIntents = [];
    ({ state: conversationState } = await flowEngine.step({
      from: 'user.9373795779eb6441c8adb2eaee5b848e7dd174ddd302d7db62142f4722d574b6',
      phone: null,
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
  await step('view_cart');
  await step('start_checkout');
  await step('Jane Doe');
  await step('12 Main St, Berlin');
  const result = await step('skip');

  assert.match(result.outboundIntents[0].body, /Phone: \n/);
  assert.doesNotMatch(result.outboundIntents[0].body, /user\.9373795779eb/);
});

test('AfroMarket: free-text replies to checkout_name/checkout_address are accepted as-is, no required format', async () => {
  // Direct regression coverage for a real customer bug report: the old
  // combined "reply with Name: X / Address: Y / Email: Z in one message"
  // prompt required exact "Field:" labels and silently failed to capture
  // anything that didn't match - the customer just saw the same "resend in
  // this exact format" error over and over. Each field is now its own
  // single question (checkout_name -> checkout_address -> checkout_email),
  // so whatever the customer types literally IS that field - no format to
  // violate, nothing left to reject.
  const step = createStepper();

  await step('hi');
  await step('shop_online');
  await step('cat_beans_nuts');
  await step('product_haricot_rouge_1kg');
  await step('cart_add');
  await step('view_cart');
  await step('start_checkout');

  // Even a reserved-looking word like "menu" - which used to trip the old
  // parser's "couldn't find both a name and an address" error - is simply
  // captured as the name: checkout_name is a plain `input` state, and
  // "menu" only carries special meaning for list/buttons row-matching
  // states, not for freeform text capture.
  const afterName = await step('menu');
  assert.match(afterName.outboundIntents[0].body, /delivery address/i);

  const afterAddress = await step('12 Main St, Berlin');
  assert.match(afterAddress.outboundIntents[0].body, /email address/i);

  const afterEmail = await step('skip');
  assert.match(afterEmail.outboundIntents[0].body, /confirm your order/i);
  assert.match(afterEmail.outboundIntents[0].body, /Name: menu/);

  const result = await step('cancel_checkout');
  assert.match(result.outboundIntents[0].body, /Your Cart/);
  assert.match(result.outboundIntents[0].body, /1x Haricot Rouge – Meringué 1kg/);
  assert.equal(result.conversationState.context.cart.length, 1);
});

test('AfroMarket: recipe detail can add its mapped ingredients to the cart', async () => {
  const step = createStepper();

  await step('hi');
  await step('recipes');
  const result = await step('browse_recipes');

  assert.match(result.outboundIntents[0].body, /Ndolè/);

  const afterBuy = await step('buy_ingredients');
  assert.match(afterBuy.outboundIntents[0].body, /Added ingredients for \*Ndolè\*/);
  assert.match(afterBuy.outboundIntents[0].body, /Ndolè Cameroun/);
  assert.match(afterBuy.outboundIntents[0].body, /Arachide Blanche Dépulpée 1kg/);

  const cart = afterBuy.conversationState.context.cart;
  assert.equal(cart.length, 2);
  assert.deepEqual(
    cart.map((line) => line.productId).sort(),
    ['arachide_blanche_1kg', 'ndole_250g'].sort()
  );

  assert.equal(afterBuy.outboundIntents[0].type, 'buttons');
  assert.deepEqual(afterBuy.outboundIntents[0].buttons.map((b) => b.id), ['view_cart', 'more_recipes', 'menu']);
});

test('AfroMarket: View Cart after buying ingredients opens the cart with Checkout/Continue Shopping/Main menu', async () => {
  const step = createStepper();

  await step('hi');
  await step('recipes');
  await step('browse_recipes');
  await step('buy_ingredients');

  const result = await step('view_cart');
  assert.match(result.outboundIntents[0].body, /Your Cart/);
  assert.match(result.outboundIntents[0].body, /Ndolè Cameroun/);
  assert.deepEqual(
    result.outboundIntents[0].buttons.map((b) => b.id),
    ['start_checkout', 'continue_shopping', 'menu']
  );
});

test('AfroMarket: every recipe_detail_* state always chains straight into recipe_actions', () => {
  // Structural invariant: the "Bon appetit! Want to keep exploring?" message
  // with Buy ingredients/More recipes/Main menu must always immediately
  // follow the recipe description, for every recipe, with no gap in between.
  const flow = botConfig.flows.main_menu;
  const recipeDetailStates = flow.states.filter((s) => s.type === 'image' && s.recipeId);

  assert.ok(recipeDetailStates.length >= 1, 'expected at least 1 recipe_detail_* state');
  for (const state of recipeDetailStates) {
    assert.equal(state.next, 'recipe_actions', `${state.id} must chain directly into recipe_actions`);
  }
});

test('AfroMarket: "More recipes" from recipe_actions loops back to the recipes hub', async () => {
  const step = createStepper();

  await step('hi');
  await step('recipes');
  await step('browse_recipes');

  const result = await step('more_recipes');
  assert.match(result.outboundIntents[0].body, /Recipe Ideas/);
});

test('AfroMarket: every recipe in recipeIngredients maps to real product ids', () => {
  const productIds = new Set(botConfig.products.map((p) => p.id));
  for (const [recipeId, ingredientIds] of Object.entries(botConfig.recipeIngredients)) {
    for (const productId of ingredientIds) {
      assert.ok(productIds.has(productId), `recipe '${recipeId}' references unknown product '${productId}'`);
    }
  }
});

// Regression test for a real bug: "Current promo" used to send a static
// hardcoded blurb unrelated to whatever the catalog actually showed on
// sale. It must now send the approved afromarket_promo_v1 template for
// whichever product has a salePriceEur set, with the percentage derived
// from that same field - see findCurrentPromoProduct/computePercentOff -
// so it can never drift from the catalog's own sale_price display.
//
// Sends ONLY the template - no follow-up message. An earlier version also
// sent a "What would you like to do next?" buttons message right after,
// which business-owner testing on dev found unacceptable (it visually
// raced ahead of the template on-device even with a delivery-status wait)
// and explicitly asked to have removed. Also proves a subsequent, unrelated
// message ("menu") is handled normally afterward, not swallowed or
// mistaken for another promo request - see current_promo_landing/
// _handleCurrentPromoLanding, the same armed/landing pattern already
// proven for shop_entry/shop_landing.
test('AfroMarket: current promo sends ONLY the approved promo template, aligned with catalog pricing, with no follow-up message; a later message is still handled normally', async () => {
  const step = createStepper();

  // Derived from the same helpers the feature itself uses, not hardcoded -
  // whichever product actually has a salePriceEur in afromarket.bot.json
  // today, this stays correct if that ever moves to a different product.
  const promoProduct = findCurrentPromoProduct(botConfig);
  assert.ok(promoProduct, 'this test requires at least one product with a live salePriceEur in afromarket.bot.json');
  const expectedPercentOff = computePercentOff(promoProduct);

  await step('hi');
  let result = await step('current_promo');
  assert.equal(result.outboundIntents.length, 1);

  const [promoIntent] = result.outboundIntents;
  assert.equal(promoIntent.type, 'promo_template');
  assert.equal(promoIntent.templateName, 'afromarket_promo_v1');
  assert.equal(promoIntent.productName, promoProduct.name);
  assert.equal(promoIntent.imageLink, promoProduct.imageUrl);
  assert.equal(promoIntent.percentOff, expectedPercentOff);
  assert.equal(promoIntent.quickReplyPayload, `promo_add:${promoProduct.id}:${expectedPercentOff}`);

  // The customer's next, unrelated message must be handled normally - not
  // swallowed, and not mistaken for another "Current promo" tap.
  result = await step('menu');
  assert.equal(result.outboundIntents.length, 1);
  assert.equal(result.outboundIntents[0].type, 'list');
  assert.notEqual(result.outboundIntents[0].type, 'promo_template');

  result = await step('afromarket_store');
  assert.match(result.outboundIntents[0].body, /AfroMarket Store/);
  assert.match(result.outboundIntents[0].body, /Gewürzstraße/);
  assert.match(result.outboundIntents[0].body, /Opening Hours/);
});

// Regression test for the fallback path: if no product currently has a
// salePriceEur set, "Current promo" must not send a promo template with
// nothing to actually announce - it degrades to the same "what's new"
// message this menu option always showed before this fix.
test('AfroMarket: current promo falls back to the "what\'s new" message when no product is on sale', async () => {
  const noSaleBotConfig = JSON.parse(JSON.stringify(botConfig));
  for (const product of noSaleBotConfig.products) {
    delete product.salePriceEur;
  }

  const flowEngine = new FlowEngine({ botConfig: noSaleBotConfig, plugin: new AfroMarketFlowPlugin({ botConfig: noSaleBotConfig }) });
  let conversationState = { currentFlowId: null, currentStateId: null, context: {} };
  const step = async (text) => {
    const outboundIntents = [];
    ({ state: conversationState } = await flowEngine.step({
      from: '+33600000000',
      phone: '+33600000000',
      message: { text: { body: text } },
      state: conversationState,
      send: async (outboundIntent) => outboundIntents.push(outboundIntent)
    }));
    return { outboundIntents, conversationState };
  };

  await step('hi');
  const result = await step('current_promo');

  assert.equal(result.outboundIntents.length, 1);
  assert.equal(result.outboundIntents[0].type, 'buttons');
  assert.match(result.outboundIntents[0].body, /New in the shop/);
});

// Regression test for the send-failure fallback: a disapproved template,
// throttled WABA, or missing image must not leave the customer with
// silence after tapping "Current promo" - see _handleSendCurrentPromo's
// catch block. Simulates the failure by making the `send` stub throw
// specifically for the promo_template intent, same technique used
// elsewhere in this suite to simulate a failed WhatsApp send.
test('AfroMarket: current promo falls back to a text summary if the template send fails, and sends nothing else', async () => {
  const promoProduct = findCurrentPromoProduct(botConfig);
  assert.ok(promoProduct, 'this test requires at least one product with a live salePriceEur in afromarket.bot.json');
  const expectedPercentOff = computePercentOff(promoProduct);

  const flowEngine = new FlowEngine({ botConfig, plugin: new AfroMarketFlowPlugin({ botConfig }) });
  let conversationState = { currentFlowId: null, currentStateId: null, context: {} };
  const step = async (text) => {
    const outboundIntents = [];
    ({ state: conversationState } = await flowEngine.step({
      from: '+33600000000',
      phone: '+33600000000',
      message: { text: { body: text } },
      state: conversationState,
      send: async (outboundIntent) => {
        outboundIntents.push(outboundIntent);
        if (outboundIntent.type === 'promo_template') {
          throw new Error('simulated WhatsApp template send failure');
        }
      }
    }));
    return { outboundIntents, conversationState };
  };

  await step('hi');
  const result = await step('current_promo');

  // The failed promo_template attempt, then the plain-text fallback
  // carrying the same offer - never total silence, but nothing more.
  assert.equal(result.outboundIntents.length, 2);
  assert.equal(result.outboundIntents[0].type, 'promo_template');
  assert.equal(result.outboundIntents[1].type, 'text');
  assert.ok(result.outboundIntents[1].body.includes(promoProduct.name));
  assert.ok(result.outboundIntents[1].body.includes(`${expectedPercentOff}% off`));
  assert.ok(result.outboundIntents[1].body.includes(formatEuro(Number(promoProduct.salePriceEur))));
});

test('AfroMarket: production hides Partner Stores and shows the Steinheim delivery-only message', async () => {
  // No physical store or real partner stores exist yet - dev keeps the
  // placeholder Berlin store + partner carousel unchanged (CONFIG_ENV
  // defaults to 'dev' outside Railway), production shows the real
  // delivery-only positioning instead.
  const previousConfigEnv = process.env.CONFIG_ENV;
  process.env.CONFIG_ENV = 'production';
  try {
    const step = createStepper();
    await step('hi');
    const result = await step('afromarket_store');

    assert.match(result.outboundIntents[0].body, /89555 Steinheim/);
    assert.match(result.outboundIntents[0].body, /deliver.*across all of Germany/i);
    assert.doesNotMatch(result.outboundIntents[0].body, /Gewürzstraße/);
    assert.deepEqual(
      result.outboundIntents[0].buttons.map((b) => b.id),
      ['shop_online', 'menu']
    );
  } finally {
    if (previousConfigEnv === undefined) {
      delete process.env.CONFIG_ENV;
    } else {
      process.env.CONFIG_ENV = previousConfigEnv;
    }
  }
});

test('AfroMarket: production hides Afro Restaurant from the main menu, dev keeps it', async () => {
  // afro_restaurant_list has no native carousel until a new template is
  // approved (see docs/requirements/afromarket.md v2.2/v2.3) - production
  // hides the menu entry rather than showing the degraded vertical-card
  // experience; dev keeps it visible so carousel work can continue.
  const previousConfigEnv = process.env.CONFIG_ENV;
  process.env.CONFIG_ENV = 'production';
  try {
    const step = createStepper();
    const { outboundIntents } = await step('hi');

    const rowIds = outboundIntents[0].sections.flatMap((section) => section.rows.map((row) => row.id));
    assert.deepEqual(rowIds, ['shop_online', 'recipes', 'current_promo', 'afromarket_store']);
  } finally {
    if (previousConfigEnv === undefined) {
      delete process.env.CONFIG_ENV;
    } else {
      process.env.CONFIG_ENV = previousConfigEnv;
    }
  }
});

test('AfroMarket: Afro Restaurant fires its real approved carousel template with quick-reply buttons and per-card body text', async () => {
  // afro_restaurant_list now carries a real carouselTemplate
  // (afromarket_restaurants_v2) - see afromarket-carousel-bugs-todo.md's
  // Correction: WhatsApp only supports one dynamic suffix on a URL button
  // against a single fixed base domain, which can't represent 4 restaurants
  // on 4 entirely different domains, so - unlike a URL-button carousel -
  // this uses QUICK_REPLY (routing through the bot, same mechanism as
  // Partner Stores) with a dynamic per-card body variable, and the bot
  // sends the restaurant's real website link as a follow-up after the tap.
  const step = createStepper();

  await step('hi');
  const result = await step('afro_restaurant');
  assert.equal(result.outboundIntents.length, 2);

  const carousel = result.outboundIntents[0];
  assert.equal(carousel.type, 'template_carousel');
  assert.equal(carousel.templateName, 'afromarket_restaurants_v2');
  assert.equal(carousel.cards.length, 4);
  for (const card of carousel.cards) {
    assert.equal(card.buttonType, 'quick_reply');
    assert.match(card.imageLink, /^https:\/\//);
    assert.ok(card.quickReplyPayload);
    assert.ok(card.bodyText, `${card.quickReplyPayload} card is missing its bodyText`);
  }
  assert.equal(carousel.cards[0].quickReplyPayload, 'restaurant_akan_afrofusion');
  assert.match(carousel.cards[0].bodyText, /akan afrofusion/);
  assert.equal(carousel.cards[3].quickReplyPayload, 'restaurant_ebony');
  assert.match(carousel.cards[3].bodyText, /Ebony/);

  const footer = result.outboundIntents[1];
  assert.equal(footer.type, 'buttons');
  assert.deepEqual(footer.buttons.map((b) => b.id), ['menu']);

  // Tapping a restaurant's quick-reply routes to that restaurant's real
  // website link, not straight back to the main menu.
  const afterTap = await step('restaurant_la_villageoise');
  assert.equal(afterTap.outboundIntents[0].type, 'buttons');
  assert.match(afterTap.outboundIntents[0].body, /La Villageoise/);
  assert.match(afterTap.outboundIntents[0].body, /https:\/\/lavillageoise\.de\//);
  assert.equal(afterTap.outboundIntents[0].image, 'https://legal.botmanagementservice.eu/restaurants/afromarket-restaurant-la-villageoise.jpg');
  assert.deepEqual(afterTap.outboundIntents[0].buttons.map((b) => b.id), ['afro_restaurant', 'menu']);

  // "More Restaurants" loops back to the carousel; the main menu button
  // (already covered by every other flow's identical pattern) is not
  // re-tested here.
  const backToList = await step('afro_restaurant');
  assert.equal(backToList.outboundIntents[0].type, 'template_carousel');
});

test('AfroMarket: Afro Restaurant falls back to vertical cta_url cards (still followed by the footer) if the template send fails', async () => {
  const flowEngine = new FlowEngine({ botConfig, plugin: new AfroMarketFlowPlugin({ botConfig }) });
  let conversationState = { currentFlowId: null, currentStateId: null, context: {} };
  const step = async (text) => {
    const outboundIntents = [];
    ({ state: conversationState } = await flowEngine.step({
      from: '+33600000000',
      phone: '+33600000000',
      message: { text: { body: text } },
      state: conversationState,
      send: async (outboundIntent) => {
        if (outboundIntent.type === 'template_carousel') {
          throw new Error('simulated WhatsApp template send failure');
        }
        outboundIntents.push(outboundIntent);
      }
    }));
    return { outboundIntents, conversationState };
  };

  await step('hi');
  const result = await step('afro_restaurant');

  assert.equal(result.outboundIntents.length, 6);
  assert.equal(result.outboundIntents[0].type, 'text');
  assert.match(result.outboundIntents[0].body, /Afro Restaurants/);

  const cards = result.outboundIntents.slice(1, 5);
  for (const card of cards) {
    assert.equal(card.type, 'cta_url');
    assert.ok(card.image, `${card.body} card is missing its image`);
    assert.match(card.url, /^https:\/\//);
    assert.match(card.buttonText, /Visit Website/);
  }
  assert.match(cards[0].body, /akan afrofusion/);
  assert.equal(cards[0].url, 'https://afrofusion-restaurant.com/');
  assert.match(cards[1].body, /La Villageoise/);
  assert.equal(cards[1].url, 'https://lavillageoise.de/');
  assert.match(cards[2].body, /Kilimanjaro II/);
  assert.equal(cards[2].url, 'https://www.kilimanjaroii.de/');
  assert.match(cards[3].body, /Ebony/);
  assert.equal(cards[3].url, 'https://www.ebony-stuttgart.de/');

  const footer = result.outboundIntents[5];
  assert.equal(footer.type, 'buttons');
  assert.deepEqual(footer.buttons.map((b) => b.id), ['menu']);

  // The vertical fallback's "next" is unconditionally "welcome" (unlike the
  // carousel path, it never routes through afro_restaurant_route - there's
  // nothing to route since each card already carries its own direct link).
  const afterTap = await step('menu');
  assert.equal(afterTap.outboundIntents[0].type, 'list');
  assert.match(afterTap.outboundIntents[0].body, /Welcome to \*AfroMarket\*/);
});

test('AfroMarket: Afro Restaurant footer waits for the carousel delivery-status webhook, not a fixed delay', async (t) => {
  // Same regression guard as the equivalent Partner Stores test.
  const { messageStatusWaiter } = require('../src/core/whatsapp/messageStatusWaiter');
  const previousDelay = process.env.CAROUSEL_FOOTER_DELAY_MS;
  process.env.CAROUSEL_FOOTER_DELAY_MS = '30000';
  t.after(() => {
    process.env.CAROUSEL_FOOTER_DELAY_MS = previousDelay;
    messageStatusWaiter.reset();
  });

  const flowEngine = new FlowEngine({ botConfig, plugin: new AfroMarketFlowPlugin({ botConfig }) });
  let conversationState = { currentFlowId: null, currentStateId: null, context: {} };
  const step = async (text, send) => {
    const outboundIntents = [];
    ({ state: conversationState } = await flowEngine.step({
      from: '+33600000097',
      phone: '+33600000097',
      message: { text: { body: text } },
      state: conversationState,
      send: send || (async (outboundIntent) => outboundIntents.push(outboundIntent))
    }));
    return { outboundIntents, conversationState };
  };

  await step('hi');

  const events = [];
  const start = Date.now();
  await step('afro_restaurant', async (outboundIntent) => {
    if (outboundIntent.type === 'template_carousel') {
      events.push('carousel-send-resolved');
      setImmediate(() => {
        events.push('status-webhook');
        messageStatusWaiter.notify('wamid.test-restaurant-carousel', 'sent');
      });
      return { messages: [{ id: 'wamid.test-restaurant-carousel' }] };
    }

    events.push(`${outboundIntent.type}-send`);
    return {};
  });
  const elapsedMs = Date.now() - start;

  assert.ok(elapsedMs < 1000, `expected the footer to fire on the status webhook, not the 30s fallback timer (took ${elapsedMs}ms)`);
  assert.deepEqual(events, ['carousel-send-resolved', 'status-webhook', 'buttons-send']);
});

test('AfroMarket: Store screen offers Partner Stores, which fires its real approved carousel template with quick-reply buttons', async () => {
  const step = createStepper();

  await step('hi');
  const storeResult = await step('afromarket_store');
  assert.match(storeResult.outboundIntents[0].body, /AfroMarket Store/);
  assert.deepEqual(
    storeResult.outboundIntents[0].buttons.map((b) => b.id),
    ['shop_online', 'partner_stores', 'menu']
  );

  const result = await step('partner_stores');
  assert.equal(result.outboundIntents.length, 2);

  const carousel = result.outboundIntents[0];
  assert.equal(carousel.type, 'template_carousel');
  assert.equal(carousel.templateName, 'afromarket_partner_stores_v2');
  assert.equal(carousel.cards.length, 3);
  for (const card of carousel.cards) {
    assert.equal(card.buttonType, 'quick_reply');
    assert.match(card.imageLink, /^https:\/\//);
    assert.ok(card.quickReplyPayload);
    assert.ok(card.bodyText, `${card.quickReplyPayload} card is missing its bodyText`);
  }
  assert.match(carousel.cards[0].bodyText, /Mama Africa Foodmarket/);

  // "Main Menu" footer must always come after the carousel, never before it.
  const footer = result.outboundIntents[1];
  assert.equal(footer.type, 'buttons');
  assert.deepEqual(footer.buttons.map((b) => b.id), ['menu']);

  // Tapping a store's quick-reply loops back to the AfroMarket Store screen.
  const afterTap = await step('partner_mama_africa');
  assert.match(afterTap.outboundIntents[0].body, /AfroMarket Store/);
});

test('AfroMarket: Partner Stores footer waits for the carousel delivery-status webhook, not a fixed delay', async (t) => {
  // Regression guard for the footer-before-carousel ordering bug: a fixed
  // sleep(getCarouselFooterDelayMs()) kept racing the footer ahead of the
  // carousel live in production despite bumping the delay from 2500ms to
  // 6000ms. Proves the fix actually replaced the guess with a wait on the
  // carousel message's own delivery-status webhook (messageStatusWaiter.js)
  // by setting the fallback timeout absurdly high (30s): if the footer
  // still fired off a timer instead of the webhook, this test would hang
  // for 30s instead of completing almost instantly.
  const { messageStatusWaiter } = require('../src/core/whatsapp/messageStatusWaiter');
  const previousDelay = process.env.CAROUSEL_FOOTER_DELAY_MS;
  process.env.CAROUSEL_FOOTER_DELAY_MS = '30000';
  t.after(() => {
    process.env.CAROUSEL_FOOTER_DELAY_MS = previousDelay;
    messageStatusWaiter.reset();
  });

  const flowEngine = new FlowEngine({ botConfig, plugin: new AfroMarketFlowPlugin({ botConfig }) });
  let conversationState = { currentFlowId: null, currentStateId: null, context: {} };
  const step = async (text, send) => {
    const outboundIntents = [];
    ({ state: conversationState } = await flowEngine.step({
      from: '+33600000098',
      phone: '+33600000098',
      message: { text: { body: text } },
      state: conversationState,
      send: send || (async (outboundIntent) => outboundIntents.push(outboundIntent))
    }));
    return { outboundIntents, conversationState };
  };

  await step('hi');
  await step('afromarket_store');

  const events = [];
  const sentIntents = [];
  const start = Date.now();
  await step('partner_stores', async (outboundIntent) => {
    sentIntents.push(outboundIntent);

    if (outboundIntent.type === 'template_carousel') {
      events.push('carousel-send-resolved');
      // Simulate the real webhook: WhatsApp reports the message as "sent"
      // shortly after the send API call itself returns.
      setImmediate(() => {
        events.push('status-webhook');
        messageStatusWaiter.notify('wamid.test-carousel', 'sent');
      });
      return { messages: [{ id: 'wamid.test-carousel' }] };
    }

    events.push(`${outboundIntent.type}-send`);
    return {};
  });
  const elapsedMs = Date.now() - start;

  // A regression back to a fixed sleep(getCarouselFooterDelayMs()) would
  // still pass the ordering assertion below eventually (30s later) - assert
  // on elapsed time too so that regression fails fast/loud instead of just
  // quietly making the suite slow.
  assert.ok(elapsedMs < 1000, `expected the footer to fire on the status webhook, not the 30s fallback timer (took ${elapsedMs}ms)`);
  assert.deepEqual(events, ['carousel-send-resolved', 'status-webhook', 'buttons-send']);
  assert.deepEqual(
    sentIntents.map((intent) => intent.type),
    ['template_carousel', 'buttons']
  );
});

test('AfroMarket: Partner Stores falls back to vertical cards (still followed by the footer) if the template send fails', async () => {
  const flowEngine = new FlowEngine({ botConfig, plugin: new AfroMarketFlowPlugin({ botConfig }) });
  let conversationState = { currentFlowId: null, currentStateId: null, context: {} };
  const step = async (text) => {
    const outboundIntents = [];
    ({ state: conversationState } = await flowEngine.step({
      from: '+33600000000',
      phone: '+33600000000',
      message: { text: { body: text } },
      state: conversationState,
      send: async (outboundIntent) => {
        if (outboundIntent.type === 'template_carousel') {
          throw new Error('simulated WhatsApp template send failure');
        }
        outboundIntents.push(outboundIntent);
      }
    }));
    return { outboundIntents, conversationState };
  };

  await step('hi');
  await step('afromarket_store');
  const result = await step('partner_stores');

  assert.equal(result.outboundIntents.length, 5);
  assert.equal(result.outboundIntents[0].type, 'text');
  assert.match(result.outboundIntents[0].body, /Partner Stores/);

  const cards = result.outboundIntents.slice(1, 4);
  for (const card of cards) {
    assert.equal(card.type, 'buttons');
    assert.ok(card.image, `${card.body} card is missing its image`);
  }
  assert.match(cards[0].body, /Mama Africa Foodmarket/);
  assert.match(cards[1].body, /Kilimanjaro Grocery/);
  assert.match(cards[2].body, /Sankofa Market/);

  const footer = result.outboundIntents[4];
  assert.equal(footer.type, 'buttons');
  assert.deepEqual(footer.buttons.map((b) => b.id), ['menu']);
});

test('AfroMarket: recipes hub still exposes meal plans and shopping tips', async () => {
  const step = createStepper();

  await step('hi');
  await step('recipes');
  let result = await step('meal_plans');
  assert.match(result.outboundIntents[0].body, /Healthy Meal Plans/);

  result = await step('plan_vegan');
  assert.match(result.outboundIntents[0].body, /Vegan African Plan/);

  await step('menu');
  await step('recipes');
  result = await step('shopping_tips');
  assert.match(result.outboundIntents[0].body, /Cooking with AfroMarket/);

  result = await step('shop_online');
  assert.match(result.outboundIntents[0].body, /Shop Online/);
});

test('AfroMarket: every product has a product_detail state with matching data', () => {
  const flow = botConfig.flows.main_menu;
  const stateById = new Map(flow.states.map((s) => [s.id, s]));

  for (const product of botConfig.products) {
    const detailState = stateById.get(`product_detail_${product.id}`);
    assert.ok(detailState, `missing product_detail state for ${product.id}`);
    assert.equal(detailState.type, 'image');
    assert.equal(detailState.productId, product.id);
    assert.ok(detailState.categoryStateId, `product_detail_${product.id} missing categoryStateId`);
    assert.ok(stateById.has(detailState.categoryStateId), `categoryStateId '${detailState.categoryStateId}' does not exist`);
    assert.match(detailState.caption, new RegExp(product.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('AfroMarket: every state\'s next and every route target reference existing states', () => {
  const flow = botConfig.flows.main_menu;
  const stateIds = new Set(flow.states.map((s) => s.id));

  for (const state of flow.states) {
    if (state.next) {
      assert.ok(stateIds.has(state.next), `next '${state.next}' of ${state.id} missing`);
    }
    if (state.type === 'action' && state.action === 'route') {
      const { map = {}, default: defaultTarget } = state.params || {};
      for (const [inputValue, target] of Object.entries(map)) {
        assert.ok(stateIds.has(target), `route target '${target}' for '${inputValue}' in ${state.id} missing`);
      }
      if (defaultTarget) {
        assert.ok(stateIds.has(defaultTarget), `route default '${defaultTarget}' in ${state.id} missing`);
      }
    }
  }
});

test('AfroMarket: WhatsApp UI limits respected across the whole config', () => {
  const flow = botConfig.flows.main_menu;

  for (const state of flow.states) {
    if (state.type === 'buttons' && Array.isArray(state.buttons)) {
      assert.ok(state.buttons.length <= 3, `${state.id} has more than 3 buttons`);
      for (const button of state.buttons) {
        assert.ok(button.title.length <= 20, `${state.id} button '${button.title}' exceeds 20 chars`);
      }
    }

    if (state.type === 'list' && Array.isArray(state.sections)) {
      for (const section of state.sections) {
        assert.ok(section.rows.length <= 10, `${state.id} section has more than 10 rows`);
        for (const row of section.rows) {
          assert.ok(row.title.length <= 24, `${state.id} row '${row.title}' exceeds 24 chars`);
          if (row.description) {
            assert.ok(row.description.length <= 72, `${state.id} row description exceeds 72 chars`);
          }
        }
      }
    }

    if (state.type === 'cards') {
      for (const item of state.items) {
        assert.ok(item.buttonTitle.length <= 20, `${state.id} card button '${item.buttonTitle}' exceeds 20 chars`);
      }
      if (Array.isArray(state.footerButtons)) {
        assert.ok(state.footerButtons.length <= 3, `${state.id} footerButtons has more than 3 buttons`);
        for (const button of state.footerButtons) {
          assert.ok(button.title.length <= 20, `${state.id} footer button '${button.title}' exceeds 20 chars`);
        }
      }
    }
  }
});

test('AfroMarket: recipe_actions dynamic buttonsFromContext sets also respect WhatsApp UI limits', async () => {
  // recipe_actions builds its buttons in JS (buttonsFromContext), not the static
  // JSON `buttons` array the generic scan above covers - check both variants here.
  const step = createStepper();

  await step('hi');
  await step('recipes');
  const freshRecipeView = await step('browse_recipes');
  const freshButtons = freshRecipeView.outboundIntents[0].buttons;
  assert.deepEqual(freshButtons.map((b) => b.id), ['buy_ingredients', 'more_recipes', 'menu']);
  assert.ok(freshButtons.length <= 3);
  for (const button of freshButtons) assert.ok(button.title.length <= 20, `'${button.title}' exceeds 20 chars`);

  const afterPurchase = await step('buy_ingredients');
  const purchaseButtons = afterPurchase.outboundIntents[0].buttons;
  assert.deepEqual(purchaseButtons.map((b) => b.id), ['view_cart', 'more_recipes', 'menu']);
  assert.ok(purchaseButtons.length <= 3);
  for (const button of purchaseButtons) assert.ok(button.title.length <= 20, `'${button.title}' exceeds 20 chars`);
});

// Regression coverage for the promo-blast quick-reply mechanism
// (payloadTriggers + products.addDiscounted) - see
// docs/requirements/afromarket.md v2.16. A promo tap is a cold start: no
// "hi"/menu turn first, exactly like a customer tapping a promo template
// button days after their last real conversation.
test('AfroMarket: a cold promo_add payload adds the item to cart at the discounted price and confirms it', async () => {
  const step = createStepper();

  const result = await step('promo_add:bouillie_jaune_500g:20');

  assert.equal(result.outboundIntents.length, 1);
  assert.equal(result.outboundIntents[0].type, 'buttons');
  // 4.99 * 0.8 = 3.992, rounded to 3.99
  assert.match(result.outboundIntents[0].body, /Added \*Bouillie Jaune – Sèche 500g\* at 20% off \(€3\.99\)/);
  assert.deepEqual(
    result.outboundIntents[0].buttons.map((b) => b.id),
    ['cart_add', 'view_cart', 'back_category']
  );

  const cartResult = await step('view_cart');
  assert.match(cartResult.outboundIntents[0].body, /Bouillie Jaune/);
  assert.match(cartResult.outboundIntents[0].body, /€3\.99/);
});

test('AfroMarket: a 100% promo_add discount is accepted (3-digit percentage, not rejected as malformed)', async () => {
  const step = createStepper();

  // Uses ndole_250g, not bouillie_jaune_500g - it has no catalog
  // salePriceEur, so this isolates 3-digit percentage parsing from the
  // salePriceEur-priority behavior covered by the test below.
  const result = await step('promo_add:ndole_250g:100');

  assert.match(result.outboundIntents[0].body, /Added \*Ndolè Cameroun – Lavé et Séché 250g\* at 100% off \(€0\.00\)/);
});

// Regression test for a bug caught in review on the fix above: percentOff is
// a rounded whole number, so reconstructing a price from it alone can drift
// a cent or two from the catalog's actual salePriceEur for non-round
// discounts - the same class of alignment bug this whole feature exists to
// prevent, just one step removed. A tapped payload's percentOff must never
// override the catalog's own live salePriceEur (or the percentage shown
// alongside it) when the product still has one - proven here with a
// deliberately mismatched payload percentOff (50%, not the product's real
// ~20%) that must still land on the catalog's actual price *and* percentage
// (3.99 / 20%), not the stale/mismatched ones from the tap (2.50 / 50%).
test('AfroMarket: promo_add always uses the catalog\'s live salePriceEur and its real percentage, even if the tapped payload carries a different percentOff', async () => {
  const step = createStepper();

  const result = await step('promo_add:bouillie_jaune_500g:50');

  assert.match(result.outboundIntents[0].body, /Added \*Bouillie Jaune – Sèche 500g\* at 20% off \(€3\.99\)/);

  const cartResult = await step('view_cart');
  assert.match(cartResult.outboundIntents[0].body, /€3\.99/);
});

// Regression test suggested in review: since salePriceEur-priority means the
// price used no longer varies with whatever percentOff a given tap happens
// to carry, two taps of the same product (e.g. a stale/cached promo message
// tapped after a fresher one) must merge into a single cart line rather than
// fragmenting into two, even though their payloads carry different
// percentOff values - addProductToCart merges by productId + unitPrice, and
// both taps now resolve to the same catalog-sourced unitPrice (3.99).
test('AfroMarket: two promo_add taps for the same product with different payload percentages still merge into one cart line', async () => {
  const step = createStepper();

  await step('promo_add:bouillie_jaune_500g:20');
  await step('promo_add:bouillie_jaune_500g:50');

  const cartResult = await step('view_cart');
  assert.match(cartResult.outboundIntents[0].body, /2x Bouillie Jaune – Sèche 500g — €7\.98/);
  assert.doesNotMatch(cartResult.outboundIntents[0].body, /1x Bouillie Jaune/);
});

// Regression test for a real bug caught live by the business owner: tapping
// "Shop Now" on a promo template correctly charged the discounted price
// (via promo_add/_handleAddDiscounted), but then tapping "Add to Cart" on
// the very next screen (_handleProductAction's cart_add, the SAME button
// shown for any product) silently reverted to full price for that second
// unit - reported directly as "the price ... which is going to be charged".
// cart_add must now charge the catalog's live salePriceEur whenever the
// product still has one, exactly like the promo tap itself - both taps end
// up charging the same price and merge into one cart line, not two.
test('AfroMarket: "Add to Cart" after a discounted promo add still charges the sale price, not full price', async () => {
  const step = createStepper();

  await step('promo_add:bouillie_jaune_500g:20');
  const result = await step('cart_add');

  assert.match(result.outboundIntents[0].body, /Added \*Bouillie Jaune – Sèche 500g\* \(€3\.99\)/);
  assert.doesNotMatch(result.outboundIntents[0].body, /€4\.99/);

  const cartResult = await step('view_cart');
  assert.match(cartResult.outboundIntents[0].body, /2x Bouillie Jaune – Sèche 500g — €7\.98/);
  assert.doesNotMatch(cartResult.outboundIntents[0].body, /1x Bouillie Jaune/);
});

test('AfroMarket: promo_add for an unknown product falls back to the welcome menu instead of erroring', async () => {
  const step = createStepper();

  const result = await step('promo_add:no_such_product:20');

  assert.equal(result.outboundIntents[0].type, 'list');
  assert.match(result.outboundIntents[0].body, /Welcome to \*AfroMarket\*/);
});

test('AfroMarket: a malformed promo_add payload (matches the payloadTriggers prefix but not the stricter parse regex) falls back to welcome', async () => {
  const step = createStepper();

  // Starts with "promo_add:" (matches the payloadTriggers prefix, so it
  // still routes to promo_add_handler) but has no percentOff segment at
  // all - _handleAddDiscounted's own regex must reject it.
  const result = await step('promo_add:bouillie_jaune_500g');

  assert.equal(result.outboundIntents[0].type, 'list');
  assert.match(result.outboundIntents[0].body, /Welcome to \*AfroMarket\*/);
});

test('AfroMarket: a promo_add tap while mid-checkout still routes to the discounted add, not the checkout input prompt', async () => {
  const step = createStepper();

  await step('hi');
  await step('shop_online');
  await step('cat_beans_nuts');
  await step('product_haricot_rouge_1kg');
  await step('cart_add');
  await step('view_cart');
  await step('start_checkout'); // now sitting on a checkout input prompt

  const result = await step('promo_add:bouillie_jaune_500g:10');
  assert.match(result.outboundIntents[0].body, /Added \*Bouillie Jaune/);
});
