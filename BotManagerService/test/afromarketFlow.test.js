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

  result = await step('cat_grains');
  assert.match(result.outboundIntents[0].body, /Grains & Starches/);

  result = await step('product_rice_1kg');
  assert.equal(result.outboundIntents.length, 2);
  assert.equal(result.outboundIntents[0].type, 'image');
  assert.match(result.outboundIntents[0].caption, /Long-Grain Rice 1kg/);
  assert.match(result.outboundIntents[0].caption, /€3\.50/);
  assert.equal(result.outboundIntents[1].type, 'buttons');
  assert.deepEqual(
    result.outboundIntents[1].buttons.map((b) => b.id),
    ['cart_add', 'view_cart', 'back_category']
  );

  result = await step('cart_add');
  assert.match(result.outboundIntents[0].body, /Added \*Long-Grain Rice 1kg\* \(€3\.50\)/);

  result = await step('cart_add');
  assert.match(result.outboundIntents[0].body, /Added \*Long-Grain Rice 1kg\*/);

  result = await step('view_cart');
  assert.match(result.outboundIntents[0].body, /2x Long-Grain Rice 1kg — €7\.00/);
  assert.match(result.outboundIntents[0].body, /Total: €7\.00/);

  result = await step('start_checkout');
  assert.match(result.outboundIntents[0].body, /full name/);

  result = await step('Jane Doe');
  assert.match(result.outboundIntents[0].body, /delivery address/);

  result = await step('12 Main St, Berlin');
  assert.match(result.outboundIntents[0].body, /phone number/);

  result = await step('+49 170 1234567');
  assert.match(result.outboundIntents[0].body, /confirm your order/i);
  assert.match(result.outboundIntents[0].body, /Name: Jane Doe/);
  assert.match(result.outboundIntents[0].body, /Address: 12 Main St, Berlin/);
  assert.match(result.outboundIntents[0].body, /Phone: \+49 170 1234567/);
  assert.deepEqual(
    result.outboundIntents[0].buttons.map((b) => b.id),
    ['confirm_order', 'restart_checkout', 'cancel_checkout']
  );

  result = await step('confirm_order');
  const confirmation = result.outboundIntents[0].body;
  assert.match(confirmation, /Order confirmed/);
  assert.match(confirmation, /Hi Jane Doe/);
  assert.match(confirmation, /order number is \*AM-/);
  assert.match(confirmation, /2x Long-Grain Rice 1kg/);
  assert.match(confirmation, /Total: \*€7\.00\*/);
  assert.match(confirmation, /Delivering to: 12 Main St, Berlin/);
  assert.match(confirmation, /Contact: \+49 170 1234567/);
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
  await step('cat_grains');
  await step('product_rice_1kg');
  await step('view_cart');
  await step('start_checkout');
  await step('Jane Doe');
  await step('Some Address');
  await step('+49123456');
  const result = await step('confirm_order');

  assert.match(result.outboundIntents[0].body, /cart was empty/);
});

test('AfroMarket: typing a reserved word mid-checkout does not silently place an order', async () => {
  // Regression test: before the checkout_review confirm step existed, typing
  // "menu" as the address (or "cancel" as the phone) was captured as literal
  // text and the order completed automatically with garbage delivery data,
  // permanently emptying the cart with no way back.
  const step = createStepper();

  await step('hi');
  await step('shop_online');
  await step('cat_grains');
  await step('product_rice_1kg');
  await step('cart_add');
  await step('view_cart');
  await step('start_checkout');
  await step('Jane Doe');
  await step('menu');
  const afterPhone = await step('cancel');

  assert.match(afterPhone.outboundIntents[0].body, /confirm your order/i);
  assert.notEqual(afterPhone.outboundIntents[0].body, undefined);

  const result = await step('cancel_checkout');
  assert.match(result.outboundIntents[0].body, /Your Cart/);
  assert.match(result.outboundIntents[0].body, /1x Long-Grain Rice 1kg/);
  assert.equal(result.conversationState.context.cart.length, 1);
});

test('AfroMarket: recipe detail can add its mapped ingredients to the cart', async () => {
  const step = createStepper();

  await step('hi');
  await step('recipes');
  await step('browse_recipes');
  await step('region_west');
  await step('recipe_jollof_rice');

  const result = await step('buy_ingredients');
  assert.match(result.outboundIntents[0].body, /Added ingredients for \*Jollof Rice\*/);
  assert.match(result.outboundIntents[0].body, /Long-Grain Rice 1kg/);
  assert.match(result.outboundIntents[0].body, /Tomato Paste 400g/);
  assert.match(result.outboundIntents[0].body, /Fresh Scotch Bonnet Peppers 250g/);

  const cart = result.conversationState.context.cart;
  assert.equal(cart.length, 3);
  assert.deepEqual(
    cart.map((line) => line.productId).sort(),
    ['rice_1kg', 'scotch_bonnet_250g', 'tomato_paste_400g'].sort()
  );
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
  assert.match(result.outboundIntents[0].body, /This Week's Deal/);
  result = await step('menu');
  assert.equal(result.outboundIntents[0].type, 'list');

  result = await step('afro_restaurant');
  assert.match(result.outboundIntents[0].body, /Afro Restaurant/);
  assert.match(result.outboundIntents[0].body, /Rue de la Diaspora/);
  assert.match(result.outboundIntents[0].body, /Opening Hours/);
  result = await step('menu');
  assert.equal(result.outboundIntents[0].type, 'list');

  result = await step('afromarket_store');
  assert.match(result.outboundIntents[0].body, /AfroMarket Store/);
  assert.match(result.outboundIntents[0].body, /Avenue des Épices/);
  assert.match(result.outboundIntents[0].body, /Opening Hours/);
});

test('AfroMarket: recipes hub still exposes meal plans, dinner ideas and shopping tips', async () => {
  const step = createStepper();

  await step('hi');
  await step('recipes');
  let result = await step('meal_plans');
  assert.match(result.outboundIntents[0].body, /Healthy Meal Plans/);

  result = await step('plan_vegan');
  assert.match(result.outboundIntents[0].body, /Vegan African Plan/);

  await step('menu');
  await step('recipes');
  result = await step('dinner_ideas');
  assert.match(result.outboundIntents[0].body, /Dinner Ideas/);

  await step('menu');
  await step('recipes');
  result = await step('shopping_tips');
  assert.match(result.outboundIntents[0].body, /Pantry Essentials/);

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

test('AfroMarket: all route/product_route/recipe_route targets reference existing states', () => {
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
  }
});
