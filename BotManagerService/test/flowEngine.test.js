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
