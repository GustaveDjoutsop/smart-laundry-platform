const test = require('node:test');
const assert = require('node:assert/strict');

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
      from: '+33600000000',
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
  assert.match(result.outboundIntents[0].body, /one message/);
  assert.match(result.outboundIntents[0].body, /Name:/);
  assert.match(result.outboundIntents[0].body, /WhatsApp number/);

  result = await step('Name: Jane Doe\nAddress: 12 Main St, Berlin\nEmail: jane@example.com');
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
  await step('Name: Jane Doe\nAddress: Some Address\nEmail: jane@example.com');
  const result = await step('confirm_order');

  assert.match(result.outboundIntents[0].body, /cart was empty/);
});

test('AfroMarket: a wrapped multi-line address is joined into the field, not silently truncated', async () => {
  const step = createStepper();

  await step('hi');
  await step('shop_online');
  await step('cat_beans_nuts');
  await step('product_haricot_rouge_1kg');
  await step('view_cart');
  await step('start_checkout');
  const result = await step('Name: Jane Doe\nAddress: 12 Main St\nApt 4B, near the market\nEmail: jane@example.com');

  assert.match(result.outboundIntents[0].body, /confirm your order/i);
  assert.match(result.outboundIntents[0].body, /Address: 12 Main St Apt 4B, near the market/);
});

test('AfroMarket: checkout phone is derived from the WhatsApp sender even without a leading +', async () => {
  const flowEngine = new FlowEngine({ botConfig, plugin: new AfroMarketFlowPlugin({ botConfig }) });
  let conversationState = { currentFlowId: null, currentStateId: null, context: {} };
  const step = async (text) => {
    const outboundIntents = [];
    ({ state: conversationState } = await flowEngine.step({
      from: '491701234567',
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
  const result = await step('Name: Jane Doe\nAddress: 12 Main St, Berlin');

  assert.match(result.outboundIntents[0].body, /Phone: \+491701234567/);
});

test('AfroMarket: an unstructured reply to checkout_details re-prompts instead of silently placing an order', async () => {
  // Regression coverage for the combined name/address/email message: free
  // text with no "Name:"/"Address:" prefixes (e.g. a reserved word like
  // "menu") must never be captured as garbage delivery data - it should
  // re-show the checkout prompt with an error, leaving the cart untouched.
  const step = createStepper();

  await step('hi');
  await step('shop_online');
  await step('cat_beans_nuts');
  await step('product_haricot_rouge_1kg');
  await step('cart_add');
  await step('view_cart');
  await step('start_checkout');
  const afterBadReply = await step('menu');

  assert.match(afterBadReply.outboundIntents[0].body, /couldn't find both a name and an address/);
  assert.match(afterBadReply.outboundIntents[0].body, /one message/);

  const afterGoodReply = await step('Name: Jane Doe\nAddress: 12 Main St, Berlin');
  assert.match(afterGoodReply.outboundIntents[0].body, /confirm your order/i);
  assert.match(afterGoodReply.outboundIntents[0].body, /Name: Jane Doe/);

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

test('AfroMarket: current promo, restaurant info and store info are reachable and loop back', async () => {
  const step = createStepper();

  await step('hi');
  let result = await step('current_promo');
  assert.match(result.outboundIntents[0].body, /New in the shop/);
  result = await step('menu');
  assert.equal(result.outboundIntents[0].type, 'list');

  result = await step('afromarket_store');
  assert.match(result.outboundIntents[0].body, /AfroMarket Store/);
  assert.match(result.outboundIntents[0].body, /Gewürzstraße/);
  assert.match(result.outboundIntents[0].body, /Opening Hours/);
});

test('AfroMarket: Afro Restaurant fires its real approved carousel template, with URL buttons and footer after it', async () => {
  const step = createStepper();

  await step('hi');
  const result = await step('afro_restaurant');

  assert.equal(result.outboundIntents.length, 2);
  const carousel = result.outboundIntents[0];
  assert.equal(carousel.type, 'template_carousel');
  assert.equal(carousel.templateName, 'afromarket_restaurants_v1');
  assert.equal(carousel.cards.length, 3);
  for (const card of carousel.cards) {
    assert.equal(card.buttonType, 'url');
    assert.match(card.imageLink, /^https:\/\//);
    assert.match(card.url, /^https:\/\//);
  }
  assert.equal(carousel.cards[0].url, 'https://bantabaafooddealer.eu/');
  assert.equal(carousel.cards[1].url, 'https://www.yajee.de/');
  assert.equal(carousel.cards[2].url, 'https://www.afropotberlin.de/en');

  // "More options:" must always come after the carousel, never before it.
  const footer = result.outboundIntents[1];
  assert.equal(footer.type, 'buttons');
  assert.deepEqual(footer.buttons.map((b) => b.id), ['menu']);

  const afterTap = await step('menu');
  assert.equal(afterTap.outboundIntents[0].type, 'list');
  assert.match(afterTap.outboundIntents[0].body, /Welcome to \*AfroMarket\*/);
});

test('AfroMarket: Afro Restaurant falls back to cta_url cards (still followed by the footer) if the template send fails', async () => {
  const flowEngine = new FlowEngine({ botConfig, plugin: new AfroMarketFlowPlugin({ botConfig }) });
  let conversationState = { currentFlowId: null, currentStateId: null, context: {} };
  const step = async (text) => {
    const outboundIntents = [];
    ({ state: conversationState } = await flowEngine.step({
      from: '+33600000000',
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

  assert.equal(result.outboundIntents.length, 5);
  assert.equal(result.outboundIntents[0].type, 'text');
  assert.match(result.outboundIntents[0].body, /Afro Restaurants/);

  const cards = result.outboundIntents.slice(1, 4);
  for (const card of cards) {
    assert.equal(card.type, 'cta_url');
    assert.ok(card.image, `${card.body} card is missing its image`);
    assert.match(card.url, /^https:\/\//);
    assert.match(card.buttonText, /Visit Website/);
  }
  assert.match(cards[0].body, /Bantabaa/);
  assert.equal(cards[0].url, 'https://bantabaafooddealer.eu/');
  assert.match(cards[1].body, /Yajee/);
  assert.equal(cards[1].url, 'https://www.yajee.de/');
  assert.match(cards[2].body, /Afropot Berlin/);
  assert.equal(cards[2].url, 'https://www.afropotberlin.de/en');

  const footer = result.outboundIntents[4];
  assert.equal(footer.type, 'buttons');
  assert.deepEqual(footer.buttons.map((b) => b.id), ['menu']);
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
  assert.equal(carousel.templateName, 'afromarket_partner_stores_v1');
  assert.equal(carousel.cards.length, 3);
  for (const card of carousel.cards) {
    assert.equal(card.buttonType, 'quick_reply');
    assert.match(card.imageLink, /^https:\/\//);
    assert.ok(card.quickReplyPayload);
  }

  // "Main Menu" footer must always come after the carousel, never before it.
  const footer = result.outboundIntents[1];
  assert.equal(footer.type, 'buttons');
  assert.deepEqual(footer.buttons.map((b) => b.id), ['menu']);

  // Tapping a store's quick-reply loops back to the AfroMarket Store screen.
  const afterTap = await step('partner_mama_africa');
  assert.match(afterTap.outboundIntents[0].body, /AfroMarket Store/);
});

test('AfroMarket: Partner Stores falls back to vertical cards (still followed by the footer) if the template send fails', async () => {
  const flowEngine = new FlowEngine({ botConfig, plugin: new AfroMarketFlowPlugin({ botConfig }) });
  let conversationState = { currentFlowId: null, currentStateId: null, context: {} };
  const step = async (text) => {
    const outboundIntents = [];
    ({ state: conversationState } = await flowEngine.step({
      from: '+33600000000',
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
