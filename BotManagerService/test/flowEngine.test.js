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
