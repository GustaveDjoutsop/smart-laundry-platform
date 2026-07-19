const test = require('node:test');
const assert = require('node:assert/strict');

const { FlowEngine } = require('../src/core/flows/flowEngine');

// eslint-disable-next-line global-require
const botConfig = require('../configs/bots/afromarket.bot.json');

function createStepper() {
  const flowEngine = new FlowEngine({ botConfig });
  let conversationState = { currentFlowId: null, currentStateId: null, context: {} };

  return async function step(text) {
    const outboundIntents = [];
    ({ state: conversationState } = await flowEngine.step({
      from: '+237600000000',
      message: { text: { body: text } },
      state: conversationState,
      send: async (outboundIntent) => outboundIntents.push(outboundIntent)
    }));
    return { outboundIntents, conversationState };
  };
}

test('AfroMarket: greeting shows main menu list', async () => {
  const step = createStepper();

  const { outboundIntents } = await step('hi');

  assert.equal(outboundIntents.length, 1);
  assert.equal(outboundIntents[0].type, 'list');
  assert.match(outboundIntents[0].body, /AfroMarket/);

  const rowIds = outboundIntents[0].sections.flatMap((section) => section.rows.map((row) => row.id));
  assert.deepEqual(rowIds, ['browse_recipes', 'meal_plans', 'dinner_ideas', 'shopping_tips', 'about']);
});

test('AfroMarket: browse recipes -> region -> recipe detail image -> follow-up buttons', async () => {
  const step = createStepper();

  await step('hi');

  let result = await step('browse_recipes');
  assert.equal(result.outboundIntents.length, 1);
  assert.equal(result.outboundIntents[0].type, 'list');
  assert.match(result.outboundIntents[0].body, /region/i);

  result = await step('region_west');
  assert.equal(result.outboundIntents.length, 1);
  assert.equal(result.outboundIntents[0].type, 'list');
  assert.match(result.outboundIntents[0].body, /West African/);

  result = await step('recipe_jollof_rice');
  assert.equal(result.outboundIntents.length, 2);
  assert.equal(result.outboundIntents[0].type, 'image');
  assert.match(result.outboundIntents[0].link, /^https:\/\/upload\.wikimedia\.org\//);
  assert.match(result.outboundIntents[0].caption, /Jollof Rice/);
  assert.match(result.outboundIntents[0].caption, /Ingredients/);
  assert.equal(result.outboundIntents[1].type, 'buttons');
});

test('AfroMarket: every recipe row in region lists routes to an image state', async () => {
  const flow = botConfig.flows.main_menu;
  const stateById = new Map(flow.states.map((stateDefinition) => [stateDefinition.id, stateDefinition]));
  const recipeRouteMap = stateById.get('recipe_route').params.map;

  const regionListStates = ['west_recipes', 'east_recipes', 'north_recipes', 'central_recipes'];
  for (const regionStateId of regionListStates) {
    const rows = stateById.get(regionStateId).sections.flatMap((section) => section.rows);
    for (const row of rows) {
      if (!row.id.startsWith('recipe_')) continue;
      const targetStateId = recipeRouteMap[row.id];
      assert.ok(targetStateId, `recipe_route is missing mapping for ${row.id}`);

      const targetState = stateById.get(targetStateId);
      assert.ok(targetState, `state ${targetStateId} not found`);
      assert.equal(targetState.type, 'image');
      assert.ok(targetState.link, `image state ${targetStateId} needs a link`);
      assert.ok(targetState.caption.length <= 1024, `caption of ${targetStateId} exceeds 1024 chars`);
    }
  }
});

test('AfroMarket: all route targets reference existing states', async () => {
  const flow = botConfig.flows.main_menu;
  const stateIds = new Set(flow.states.map((stateDefinition) => stateDefinition.id));

  for (const stateDefinition of flow.states) {
    if (stateDefinition.next) {
      assert.ok(stateIds.has(stateDefinition.next), `next '${stateDefinition.next}' of ${stateDefinition.id} missing`);
    }

    if (stateDefinition.type === 'action' && stateDefinition.action === 'route') {
      const { map = {}, default: defaultTarget } = stateDefinition.params || {};
      for (const [inputValue, targetStateId] of Object.entries(map)) {
        assert.ok(stateIds.has(targetStateId), `route target '${targetStateId}' for '${inputValue}' missing`);
      }
      if (defaultTarget) {
        assert.ok(stateIds.has(defaultTarget), `route default '${defaultTarget}' missing`);
      }
    }
  }
});

test('AfroMarket: meal plans and dinner ideas paths respond', async () => {
  const step = createStepper();

  await step('hi');
  let result = await step('meal_plans');
  assert.equal(result.outboundIntents[0].type, 'list');
  assert.match(result.outboundIntents[0].body, /Meal Plans/);

  result = await step('plan_vegan');
  assert.equal(result.outboundIntents[0].type, 'buttons');
  assert.match(result.outboundIntents[0].body, /Vegan African Plan/);

  result = await step('menu');
  assert.equal(result.outboundIntents[0].type, 'list');

  result = await step('dinner_ideas');
  assert.equal(result.outboundIntents[0].type, 'buttons');
  assert.match(result.outboundIntents[0].body, /Dinner Ideas/);

  result = await step('recipe_shakshuka');
  assert.equal(result.outboundIntents[0].type, 'image');
  assert.match(result.outboundIntents[0].caption, /Shakshuka/);
});

test('AfroMarket: typing "menu" inside a submenu returns to the main menu', async () => {
  const step = createStepper();

  await step('hi');
  await step('browse_recipes');

  const { outboundIntents } = await step('menu');

  assert.equal(outboundIntents.length, 1);
  assert.equal(outboundIntents[0].type, 'list');
  assert.match(outboundIntents[0].body, /explore today/);
});

test('AfroMarket: unknown input falls back to main menu', async () => {
  const step = createStepper();

  await step('hi');
  const { outboundIntents } = await step('random gibberish');

  assert.equal(outboundIntents.length, 1);
  assert.equal(outboundIntents[0].type, 'list');
  assert.match(outboundIntents[0].body, /explore today/);
});

test('AfroMarket: WhatsApp UI limits respected (button/list titles, buttons per message)', async () => {
  const flow = botConfig.flows.main_menu;

  for (const stateDefinition of flow.states) {
    if (stateDefinition.type === 'buttons' && Array.isArray(stateDefinition.buttons)) {
      assert.ok(stateDefinition.buttons.length <= 3, `${stateDefinition.id} has more than 3 buttons`);
      for (const button of stateDefinition.buttons) {
        assert.ok(button.title.length <= 20, `${stateDefinition.id} button '${button.title}' exceeds 20 chars`);
      }
    }

    if (stateDefinition.type === 'list' && Array.isArray(stateDefinition.sections)) {
      for (const section of stateDefinition.sections) {
        assert.ok(section.rows.length <= 10, `${stateDefinition.id} section has more than 10 rows`);
        for (const row of section.rows) {
          assert.ok(row.title.length <= 24, `${stateDefinition.id} row '${row.title}' exceeds 24 chars`);
          if (row.description) {
            assert.ok(row.description.length <= 72, `${stateDefinition.id} row description exceeds 72 chars`);
          }
        }
      }
    }
  }
});
