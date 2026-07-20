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

test('FlowEngine image state sends image then continues to next state in same turn', async () => {
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

  assert.equal(sent.length, 2);
  assert.equal(sent[0].type, 'image');
  assert.equal(sent[0].link, 'https://example.com/jollof.jpg');
  assert.equal(sent[0].caption, 'Here is jollof');
  assert.equal(sent[1].type, 'buttons');
  assert.equal(res.state.currentStateId, 'follow_up');
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

test('FlowEngine rejects cards state with an item missing a buttonId', () => {
  const botConfig = {
    botId: 't',
    botName: 'TestBot',
    defaultFlowId: 'main_menu',
    flows: {
      main_menu: {
        states: [
          { id: 'picks', type: 'cards', items: [{ image: 'https://example.com/a.jpg', caption: 'x' }] }
        ]
      }
    }
  };

  assert.throws(() => new FlowEngine({ botConfig }), /every card item requires a buttonId/);
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
