// getCarouselFooterDelayMs() defaults to 6000ms in production (see
// flowEngine.js's comment on why) - none of these tests assert on actual
// wall-clock timing, only send order/content, so there's nothing to gain
// from eating that delay for real on every run. Set before requiring
// flowEngine.js since the value is read fresh per call, not cached.
process.env.CAROUSEL_FOOTER_DELAY_MS = '0';

const test = require('node:test');
const assert = require('node:assert/strict');

const { FlowEngine } = require('../src/core/flows/flowEngine');

test('FlowEngine runs message state and advances', async () => {
  const botConfig = {
    botId: 't',
    botName: 'TestBot',
    defaultFlowId: 'main_menu',
    flows: {
      main_menu: {
        states: [
          { id: 's1', type: 'message', template: 'Hello {{name}}', next: 's2' },
          { id: 's2', type: 'message', template: 'Done' }
        ]
      }
    }
  };

  const engine = new FlowEngine({ botConfig });
  const sent = [];

  const res = await engine.step({
    from: '237670000000',
    message: { text: { body: 'hi' } },
    state: { currentFlowId: null, currentStateId: null, context: { name: 'World' } },
    send: async (intent) => sent.push(intent)
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].body, 'Hello World');
  assert.equal(res.state.currentFlowId, 'main_menu');
  assert.equal(res.state.currentStateId, 's2');
});

test('FlowEngine route action branches on saved context value', async () => {
  const botConfig = {
    botId: 't',
    botName: 'TestBot',
    defaultFlowId: 'main_menu',
    flows: {
      main_menu: {
        states: [
          { id: 'ask', type: 'input', prompt: 'Pick', saveAs: 'choice', next: 'router' },
          {
            id: 'router',
            type: 'action',
            action: 'route',
            params: { from: 'choice', map: { LEFT: 'left', right: 'right' }, default: 'fallback' }
          },
          { id: 'left', type: 'message', template: 'went left' },
          { id: 'right', type: 'message', template: 'went right' },
          { id: 'fallback', type: 'message', template: 'went fallback' }
        ]
      }
    }
  };

  const engine = new FlowEngine({ botConfig });

  const runWithInput = async (text) => {
    const sent = [];
    await engine.step({
      from: '237670000000',
      message: { text: { body: text } },
      state: { currentFlowId: 'main_menu', currentStateId: 'ask', context: {} },
      send: async (intent) => sent.push(intent)
    });
    return sent;
  };

  assert.equal((await runWithInput('left'))[0].body, 'went left');
  assert.equal((await runWithInput('RIGHT'))[0].body, 'went right');
  assert.equal((await runWithInput('nonsense'))[0].body, 'went fallback');
});

test('FlowEngine image state chaining into a buttons state sends one merged image+buttons message, not two separate sends', async () => {
  // Regression test: two sequential sends (image, then buttons) don't have a
  // guaranteed display order on the WhatsApp client - the heavier image
  // message can visibly render after the lighter buttons message sent right
  // behind it. Merging into a single interactive image+buttons message
  // removes that reordering risk entirely.
  const botConfig = {
    botId: 't',
    botName: 'TestBot',
    defaultFlowId: 'main_menu',
    flows: {
      main_menu: {
        states: [
          {
            id: 'pic',
            type: 'image',
            link: 'https://example.com/{{dish}}.jpg',
            caption: 'Here is {{dish}}',
            next: 'follow_up'
          },
          {
            id: 'follow_up',
            type: 'buttons',
            template: 'What next?',
            buttons: [{ id: 'menu', title: 'Menu' }],
            saveAs: 'choice'
          }
        ]
      }
    }
  };

  const engine = new FlowEngine({ botConfig });
  const sent = [];

  const res = await engine.step({
    from: '237670000000',
    message: { text: { body: 'hi' } },
    state: { currentFlowId: null, currentStateId: null, context: { dish: 'jollof' } },
    send: async (intent) => sent.push(intent)
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'buttons');
  assert.equal(sent[0].image, 'https://example.com/jollof.jpg');
  assert.equal(sent[0].body, 'Here is jollof\n\nWhat next?');
  assert.deepEqual(sent[0].buttons, [{ id: 'menu', title: 'Menu' }]);
  assert.equal(res.state.currentStateId, 'follow_up');
});

test('FlowEngine image state chaining into a buttons state resolves buttonsFromContext via the plugin before sending', async () => {
  const botConfig = {
    botId: 't',
    botName: 'TestBot',
    defaultFlowId: 'main_menu',
    flows: {
      main_menu: {
        states: [
          { id: 'pic', type: 'image', link: 'https://example.com/dish.jpg', caption: 'Dish', next: 'follow_up' },
          { id: 'follow_up', type: 'buttons', template: 'What next?', buttonsFromContext: 'dynamicButtons' }
        ]
      }
    }
  };

  const plugin = {
    beforeState: async (ctx) => {
      if (ctx.stateId === 'follow_up') {
        ctx.set('dynamicButtons', [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]);
      }
    }
  };

  const engine = new FlowEngine({ botConfig, plugin });
  const sent = [];

  await engine.step({
    from: '237670000000',
    message: { text: { body: 'hi' } },
    state: { currentFlowId: null, currentStateId: null, context: {} },
    send: async (intent) => sent.push(intent)
  });

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].buttons, [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]);
});

test('FlowEngine image state chaining into a buttons state also filters hideInProd buttons in production', async () => {
  const botConfig = {
    botId: 't',
    botName: 'TestBot',
    defaultFlowId: 'main_menu',
    flows: {
      main_menu: {
        states: [
          { id: 'pic', type: 'image', link: 'https://example.com/dish.jpg', caption: 'Dish', next: 'follow_up' },
          {
            id: 'follow_up',
            type: 'buttons',
            template: 'What next?',
            buttons: [
              { id: 'a', title: 'A' },
              { id: 'b', title: 'B', hideInProd: true }
            ]
          }
        ]
      }
    }
  };

  const engine = new FlowEngine({ botConfig });
  const sent = [];

  const previousConfigEnv = process.env.CONFIG_ENV;
  process.env.CONFIG_ENV = 'production';
  try {
    await engine.step({
      from: '237670000000',
      message: { text: { body: 'hi' } },
      state: { currentFlowId: null, currentStateId: null, context: {} },
      send: async (intent) => sent.push(intent)
    });
  } finally {
    if (previousConfigEnv === undefined) {
      delete process.env.CONFIG_ENV;
    } else {
      process.env.CONFIG_ENV = previousConfigEnv;
    }
  }

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].buttons, [{ id: 'a', title: 'A' }]);
});

test('FlowEngine list state filters hideInProd rows in production and drops sections left empty', async () => {
  const botConfig = {
    botId: 't',
    botName: 'TestBot',
    defaultFlowId: 'main_menu',
    flows: {
      main_menu: {
        states: [
          {
            id: 'welcome',
            type: 'list',
            template: 'Pick one',
            buttonText: 'Select',
            sections: [
              {
                title: 'Explore',
                rows: [
                  { id: 'a', title: 'A' },
                  { id: 'b', title: 'B', hideInProd: true }
                ]
              },
              {
                title: 'Extras',
                rows: [{ id: 'c', title: 'C', hideInProd: true }]
              }
            ]
          }
        ]
      }
    }
  };

  const engine = new FlowEngine({ botConfig });
  const sent = [];

  const previousConfigEnv = process.env.CONFIG_ENV;
  process.env.CONFIG_ENV = 'production';
  try {
    await engine.step({
      from: '237670000000',
      message: { text: { body: 'hi' } },
      state: { currentFlowId: null, currentStateId: null, context: {} },
      send: async (intent) => sent.push(intent)
    });
  } finally {
    if (previousConfigEnv === undefined) {
      delete process.env.CONFIG_ENV;
    } else {
      process.env.CONFIG_ENV = previousConfigEnv;
    }
  }

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].sections, [{ title: 'Explore', rows: [{ id: 'a', title: 'A' }] }]);
});

test('FlowEngine image state without a next buttons state still sends a standalone image message', async () => {
  const botConfig = {
    botId: 't',
    botName: 'TestBot',
    defaultFlowId: 'main_menu',
    flows: {
      main_menu: {
        states: [{ id: 'pic', type: 'image', link: 'https://example.com/dish.jpg', caption: 'Dish' }]
      }
    }
  };

  const engine = new FlowEngine({ botConfig });
  const sent = [];

  await engine.step({
    from: '237670000000',
    message: { text: { body: 'hi' } },
    state: { currentFlowId: null, currentStateId: null, context: {} },
    send: async (intent) => sent.push(intent)
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'image');
  assert.equal(sent[0].caption, 'Dish');
});

test('FlowEngine rejects route action without params.default or next at construction', () => {
  const botConfig = {
    botId: 't',
    botName: 'TestBot',
    defaultFlowId: 'main_menu',
    flows: {
      main_menu: {
        states: [
          { id: 'router', type: 'action', action: 'route', params: { from: 'choice', map: { a: 'router' } } }
        ]
      }
    }
  };

  assert.throws(() => new FlowEngine({ botConfig }), /route action requires params\.default or next/);
});

test('FlowEngine rejects image state without a link at construction', () => {
  const botConfig = {
    botId: 't',
    botName: 'TestBot',
    defaultFlowId: 'main_menu',
    flows: {
      main_menu: {
        states: [{ id: 'pic', type: 'image', caption: 'no link here' }]
      }
    }
  };

  assert.throws(() => new FlowEngine({ botConfig }), /image state requires a non-empty link/);
});

test('FlowEngine image cycle sends each image at most once per turn', async () => {
  const botConfig = {
    botId: 't',
    botName: 'TestBot',
    defaultFlowId: 'main_menu',
    flows: {
      main_menu: {
        states: [
          { id: 'pic_a', type: 'image', link: 'https://example.com/a.jpg', caption: 'A', next: 'pic_b' },
          { id: 'pic_b', type: 'image', link: 'https://example.com/b.jpg', caption: 'B', next: 'pic_a' }
        ]
      }
    }
  };

  const engine = new FlowEngine({ botConfig });
  const sent = [];

  await engine.step({
    from: '237670000000',
    message: { text: { body: 'hi' } },
    state: { currentFlowId: null, currentStateId: null, context: {} },
    send: async (intent) => sent.push(intent)
  });

  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map((intent) => intent.caption), ['A', 'B']);
});

test('FlowEngine rejects cards state with an item missing an image', () => {
  const botConfig = {
    botId: 't',
    botName: 'TestBot',
    defaultFlowId: 'main_menu',
    flows: {
      main_menu: {
        states: [
          { id: 'picks', type: 'cards', items: [{ buttonId: 'a', caption: 'no image here' }] }
        ]
      }
    }
  };

  assert.throws(() => new FlowEngine({ botConfig }), /every card item requires a non-empty image/);
});

function buildCarouselBotConfig({ carouselCards, itemButtonIds }) {
  return {
    botId: 't',
    botName: 'TestBot',
    defaultFlowId: 'main_menu',
    flows: {
      main_menu: {
        states: [
          {
            id: 'picks',
            type: 'cards',
            carouselTemplate: {
              templateName: 'test_carousel',
              languageCode: 'en_US',
              cards: carouselCards
            },
            items: itemButtonIds.map((buttonId, i) => ({
              image: `https://example.com/${i}.jpg`,
              caption: `card ${i}`,
              buttonId
            }))
          }
        ]
      }
    }
  };
}

test('FlowEngine rejects a carouselTemplate with fewer than 2 cards', () => {
  const botConfig = buildCarouselBotConfig({
    carouselCards: [{ imageLink: 'https://example.com/a.jpg', quickReplyPayload: 'a' }],
    itemButtonIds: ['a']
  });

  assert.throws(() => new FlowEngine({ botConfig }), /carouselTemplate\.cards must have between 2 and 10 cards/);
});

test('FlowEngine rejects a carouselTemplate with more than 10 cards', () => {
  const carouselCards = Array.from({ length: 11 }, (_, i) => ({
    imageLink: `https://example.com/${i}.jpg`,
    quickReplyPayload: `p${i}`
  }));
  const botConfig = buildCarouselBotConfig({
    carouselCards,
    itemButtonIds: carouselCards.map((c) => c.quickReplyPayload)
  });

  assert.throws(() => new FlowEngine({ botConfig }), /carouselTemplate\.cards must have between 2 and 10 cards/);
});

test('FlowEngine rejects a carouselTemplate whose quickReplyPayload values drift from the fallback items[].buttonId values', () => {
  const botConfig = buildCarouselBotConfig({
    carouselCards: [
      { imageLink: 'https://example.com/a.jpg', quickReplyPayload: 'recipe_a' },
      { imageLink: 'https://example.com/b.jpg', quickReplyPayload: 'recipe_b' }
    ],
    itemButtonIds: ['recipe_a', 'recipe_DIFFERENT']
  });

  assert.throws(
    () => new FlowEngine({ botConfig }),
    /carouselTemplate quickReplyPayload values must exactly match items\[\]\.buttonId values/
  );
});

test('FlowEngine accepts a carouselTemplate whose quickReplyPayload values match the fallback items[].buttonId values', () => {
  const botConfig = buildCarouselBotConfig({
    carouselCards: [
      { imageLink: 'https://example.com/a.jpg', quickReplyPayload: 'recipe_a' },
      { imageLink: 'https://example.com/b.jpg', quickReplyPayload: 'recipe_b' }
    ],
    itemButtonIds: ['recipe_a', 'recipe_b']
  });

  assert.doesNotThrow(() => new FlowEngine({ botConfig }));
});

test('FlowEngine cards state sends intro + one image-button message per item + footer, then gates on the reply', async () => {
  const botConfig = {
    botId: 't',
    botName: 'TestBot',
    defaultFlowId: 'main_menu',
    flows: {
      main_menu: {
        states: [
          {
            id: 'dish_picker',
            type: 'cards',
            intro: 'Pick a dish, {{user.phone}}:',
            items: [
              { image: 'https://example.com/a.jpg', caption: 'Dish A', buttonId: 'dish_a', buttonTitle: 'Get A' },
              { image: 'https://example.com/b.jpg', caption: 'Dish B', buttonId: 'dish_b', buttonTitle: 'Get B' }
            ],
            footerButtons: [{ id: 'back', title: 'Back' }],
            saveAs: 'dishChoice',
            next: 'confirm_dish'
          },
          { id: 'confirm_dish', type: 'message', template: 'You picked {{dishChoice}}' }
        ]
      }
    }
  };

  const engine = new FlowEngine({ botConfig });
  let state = { currentFlowId: null, currentStateId: null, context: {} };

  const step = async (text) => {
    const sent = [];
    ({ state } = await engine.step({
      from: '237670000000',
      message: { text: { body: text } },
      state,
      send: async (intent) => sent.push(intent)
    }));
    return sent;
  };

  const rendered = await step('hi');
  assert.equal(rendered.length, 4);
  assert.equal(rendered[0].type, 'text');
  assert.match(rendered[0].body, /Pick a dish, 237670000000/);
  assert.equal(rendered[1].type, 'buttons');
  assert.equal(rendered[1].image, 'https://example.com/a.jpg');
  assert.equal(rendered[1].buttons[0].id, 'dish_a');
  assert.equal(rendered[2].image, 'https://example.com/b.jpg');
  assert.equal(rendered[3].buttons[0].id, 'back');

  const answered = await step('dish_b');
  assert.equal(answered.length, 1);
  assert.equal(answered[0].body, 'You picked dish_b');
});

test('FlowEngine rejects cards item with an empty caption at construction', () => {
  const botConfig = {
    botId: 't',
    botName: 'TestBot',
    defaultFlowId: 'main_menu',
    flows: {
      main_menu: {
        states: [
          { id: 'picks', type: 'cards', items: [{ image: 'https://example.com/a.jpg', buttonId: 'a', caption: '' }] }
        ]
      }
    }
  };

  assert.throws(() => new FlowEngine({ botConfig }), /every card item requires a non-empty caption/);
});

test('FlowEngine cards state survives a mid-loop send() failure: later cards, footer, and state persistence are unaffected', async () => {
  const botConfig = {
    botId: 't',
    botName: 'TestBot',
    defaultFlowId: 'main_menu',
    flows: {
      main_menu: {
        states: [
          {
            id: 'dish_picker',
            type: 'cards',
            intro: 'Pick a dish:',
            items: [
              { image: 'https://example.com/a.jpg', caption: 'Dish A', buttonId: 'dish_a', buttonTitle: 'Get A' },
              { image: 'https://example.com/b.jpg', caption: 'Dish B', buttonId: 'dish_b', buttonTitle: 'Get B' },
              { image: 'https://example.com/c.jpg', caption: 'Dish C', buttonId: 'dish_c', buttonTitle: 'Get C' }
            ],
            footerButtons: [{ id: 'back', title: 'Back' }],
            saveAs: 'dishChoice',
            next: 'confirm_dish'
          },
          { id: 'confirm_dish', type: 'message', template: 'You picked {{dishChoice}}' }
        ]
      }
    }
  };

  const engine = new FlowEngine({ botConfig });
  const delivered = [];

  // Simulate item B's send failing transiently (e.g. a WhatsApp API error),
  // exactly the scenario flagged in review: step() must not throw, and
  // rendering must continue past the failure to item C and the footer.
  const flakySend = async (intent) => {
    if (intent.body === 'Dish B') {
      throw new Error('simulated WhatsApp API failure');
    }
    delivered.push(intent);
  };

  const result = await engine.step({
    from: '237670000000',
    message: { text: { body: 'hi' } },
    state: { currentFlowId: null, currentStateId: null, context: {} },
    send: flakySend
  });

  // step() resolved normally (did not throw) and the state machine landed
  // exactly where a normal 'cards' render leaves it: still on the cards
  // state itself, waiting for the next reply - so ConfigBot's Redis persist
  // afterward reflects reality instead of being skipped by an uncaught throw.
  assert.equal(result.state.currentStateId, 'dish_picker');

  // Intro, Dish A, Dish C and the footer all still made it out despite the
  // Dish B failure in between.
  assert.deepEqual(
    delivered.map((i) => i.body),
    ['Pick a dish:', 'Dish A', 'Dish C', 'More options:']
  );

  // The conversation is still fully usable afterward - tapping a card
  // (including the one that "failed" to send, since the user's WhatsApp
  // client only shows what actually arrived) still routes correctly.
  const answered = await engine.step({
    from: '237670000000',
    message: { text: { body: 'dish_c' } },
    state: result.state,
    send: async () => {}
  });
  assert.equal(answered.intents[0].body, 'You picked dish_c');
});

test('FlowEngine rejects a cards item with both buttonId and buttonUrl, or neither', () => {
  const makeConfig = (item) => ({
    botId: 't',
    botName: 'TestBot',
    defaultFlowId: 'main_menu',
    flows: {
      main_menu: { states: [{ id: 'picks', type: 'cards', items: [{ image: 'https://example.com/a.jpg', caption: 'x', ...item }] }] }
    }
  });

  assert.throws(
    () => new FlowEngine({ botConfig: makeConfig({ buttonId: 'a', buttonUrl: 'https://example.com' }) }),
    /exactly one of buttonId or buttonUrl/
  );
  assert.throws(
    () => new FlowEngine({ botConfig: makeConfig({}) }),
    /exactly one of buttonId or buttonUrl/
  );
});

test('FlowEngine cards state sends CTA-URL (not quick-reply) messages for items with buttonUrl', async () => {
  const botConfig = {
    botId: 't',
    botName: 'TestBot',
    defaultFlowId: 'main_menu',
    flows: {
      main_menu: {
        states: [
          {
            id: 'restaurant_picker',
            type: 'cards',
            intro: 'Restaurants near you:',
            items: [
              { image: 'https://example.com/dakar.jpg', caption: 'Le Petit Dakar', buttonUrl: 'https://www.lepetitdakar.com/en', buttonTitle: '🌐 Visit Website' },
              { image: 'https://example.com/ohinene.jpg', caption: 'Ohinéné', buttonUrl: 'https://www.ohinene.fr/', buttonTitle: '🌐 Visit Website' }
            ],
            footerButtons: [{ id: 'menu', title: 'Main Menu' }],
            saveAs: 'restaurantChoice',
            next: 'welcome'
          },
          { id: 'welcome', type: 'message', template: 'Back at the menu' }
        ]
      }
    }
  };

  const engine = new FlowEngine({ botConfig });
  const sent = [];

  const rendered = await engine.step({
    from: '237670000000',
    message: { text: { body: 'hi' } },
    state: { currentFlowId: null, currentStateId: null, context: {} },
    send: async (intent) => sent.push(intent)
  });

  assert.equal(sent.length, 4);
  assert.equal(sent[1].type, 'cta_url');
  assert.equal(sent[1].url, 'https://www.lepetitdakar.com/en');
  assert.equal(sent[1].buttonText, '🌐 Visit Website');
  assert.equal(sent[1].image, 'https://example.com/dakar.jpg');
  assert.equal(sent[2].type, 'cta_url');
  assert.equal(sent[2].url, 'https://www.ohinene.fr/');
  assert.equal(sent[3].type, 'buttons');
  assert.equal(sent[3].buttons[0].id, 'menu');

  // A cta_url tap produces no reply for the bot to route on; the only
  // real path forward is the footer's quick-reply button.
  const afterMenu = await engine.step({
    from: '237670000000',
    message: { text: { body: 'menu' } },
    state: rendered.state,
    send: async () => {}
  });
  assert.equal(afterMenu.intents[0].body, 'Back at the menu');
});

test('FlowEngine action without goto or next ends the turn instead of looping', async () => {
  const botConfig = {
    botId: 't',
    botName: 'TestBot',
    defaultFlowId: 'main_menu',
    flows: {
      main_menu: {
        states: [{ id: 'noop', type: 'action', action: 'set', params: { seen: true } }]
      }
    }
  };

  const engine = new FlowEngine({ botConfig });

  const res = await engine.step({
    from: '237670000000',
    message: { text: { body: 'hi' } },
    state: { currentFlowId: null, currentStateId: null, context: {} },
    send: async () => {}
  });

  assert.equal(res.state.context.seen, true);
  assert.equal(res.intents.length, 0);
});

test('FlowEngine input state saves value then transitions', async () => {
  const botConfig = {
    botId: 't',
    botName: 'TestBot',
    defaultFlowId: 'main_menu',
    flows: {
      main_menu: {
        states: [
          { id: 'ask', type: 'input', prompt: 'Enter', saveAs: 'x', next: 'done' },
          { id: 'done', type: 'message', template: 'x={{x}}' }
        ]
      }
    }
  };

  const engine = new FlowEngine({ botConfig });

  const res = await engine.step({
    from: '237670000000',
    message: { text: { body: '42' } },
    state: { currentFlowId: 'main_menu', currentStateId: 'ask', context: {} },
    send: async () => {}
  });

  assert.equal(res.state.context.x, '42');
  assert.equal(res.state.currentStateId, 'done');
});
