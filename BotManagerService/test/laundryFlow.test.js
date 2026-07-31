// laundry.bot.json pays via preferredProvider: 'campay' - register a real
// CamPay provider (with a stubbed fetch) instead of relying on the MTN stub
// PaymentGateway.selectProvider used to silently fall through to whenever
// CamPay wasn't actually configured. That silent fallback is exactly the
// cross-tenant footgun PaymentGateway.selectProvider was hardened against
// (see paymentGateway.js), so this bot's own tests must configure CamPay for
// real rather than depend on the old accidental MTN-stub routing.
process.env.CAMPAY_TOKEN = 'test-token';

const test = require('node:test');
const assert = require('node:assert/strict');

let currentFetchImpl = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ reference: `campay_test_${Date.now()}`, status: 'PENDING' })
});
global.fetch = (...args) => currentFetchImpl(...args);

const { FlowEngine } = require('../src/core/flows/flowEngine');
const { LaundryFlowPlugin } = require('../src/bots/laundry/laundryFlowPlugin');
const { MachineStore } = require('../src/core/machines/machineStore');
const { MachineStatus } = require('../src/core/machines/machineTypes');
const { PaymentStore } = require('../src/core/payments/paymentStore');

// Make business-hours checks deterministic for tests.
const previousOpenHour = process.env.LAUDRY_OPEN_HOUR;
const previousCloseHour = process.env.LAUDRY_CLOSE_HOUR;

test.before(() => {
  // In LaundryFlowPlugin, if closeHour <= openHour we treat the business as always open.
  process.env.LAUDRY_OPEN_HOUR = '0';
  process.env.LAUDRY_CLOSE_HOUR = '0';
});

test.after(() => {
  if (previousOpenHour === undefined) delete process.env.LAUDRY_OPEN_HOUR;
  else process.env.LAUDRY_OPEN_HOUR = previousOpenHour;

  if (previousCloseHour === undefined) delete process.env.LAUDRY_CLOSE_HOUR;
  else process.env.LAUDRY_CLOSE_HOUR = previousCloseHour;
});

test('Laundry flow: select machine -> select program -> initiate payment with metadata', async () => {
  // Load bot config JSON
  // eslint-disable-next-line global-require
  const botConfig = require('../configs/bots/laundry.bot.json');

  const machineStore = new MachineStore();
  await machineStore.upsertMachine({ botId: botConfig.botId, machineId: 'W1', status: MachineStatus.AVAILABLE });
  await machineStore.upsertMachine({ botId: botConfig.botId, machineId: 'W2', status: MachineStatus.IN_USE });

  const flowEngine = new FlowEngine({ botConfig, plugin: new LaundryFlowPlugin({ botConfig }) });
  const outboundIntents = [];
  const captureOutboundIntent = async (outboundIntent) => outboundIntents.push(outboundIntent);

  let conversationState = { currentFlowId: null, currentStateId: null, context: {} };

  // 1) Enter flow: language prompt
  outboundIntents.length = 0;
  ({ state: conversationState } = await flowEngine.step({
    from: '+237600000000',
    message: { text: { body: 'hi' } },
    state: conversationState,
    send: captureOutboundIntent
  }));
  assert.equal(outboundIntents.length, 1);
  assert.equal(outboundIntents[0].type, 'buttons');
  assert.match(outboundIntents[0].body, /Language/i);

  // 2) Choose language => main menu list
  outboundIntents.length = 0;
  ({ state: conversationState } = await flowEngine.step({
    from: '+237600000000',
    message: { interactive: { button_reply: { id: 'lang_en', title: 'English' } } },
    state: conversationState,
    send: captureOutboundIntent
  }));
  assert.equal(outboundIntents.length, 1);
  assert.equal(outboundIntents[0].type, 'list');
  assert.ok(Array.isArray(outboundIntents[0].sections));

  // 3) Select Start laundry from menu
  outboundIntents.length = 0;
  ({ state: conversationState } = await flowEngine.step({
    from: '+237600000000',
    message: { interactive: { list_reply: { id: 'action_start', title: 'Start laundry' } } },
    state: conversationState,
    send: captureOutboundIntent
  }));
  assert.equal(outboundIntents.length, 1);
  assert.equal(outboundIntents[0].type, 'list');
  // Machine list should include W1 and exclude W2 (in use)
  const machineRows = outboundIntents[0].sections?.[0]?.rows || [];
  assert.ok(machineRows.some((r) => r.id === 'W1'));
  assert.ok(!machineRows.some((r) => r.id === 'W2'));

  // 4) Choose machine => program list
  outboundIntents.length = 0;
  ({ state: conversationState } = await flowEngine.step({
    from: '+237600000000',
    message: { interactive: { list_reply: { id: 'W1', title: 'W1' } } },
    state: conversationState,
    send: captureOutboundIntent
  }));
  assert.equal(outboundIntents.length, 1);
  assert.equal(outboundIntents[0].type, 'list');

  // 5) Choose a program id from list -> payment initiated
  const programRows = outboundIntents[0].sections?.[0]?.rows || [];
  assert.ok(programRows.length >= 1);
  const firstProgramId = programRows[0].id;

  outboundIntents.length = 0;
  ({ state: conversationState } = await flowEngine.step({
    from: '+237600000000',
    message: { interactive: { list_reply: { id: firstProgramId, title: programRows[0].title } } },
    state: conversationState,
    send: captureOutboundIntent
  }));
  assert.equal(outboundIntents.length, 1);
  assert.equal(outboundIntents[0].type, 'text');
  assert.match(outboundIntents[0].body, /Payment initiated/i);

  const transactionId = conversationState.context.paymentTransactionId;
  assert.ok(transactionId);

  const paymentStore = new PaymentStore({ ttlSeconds: 3600 });
  const payment = await paymentStore.getPayment({ botId: botConfig.botId, transactionId });
  assert.ok(payment);
  assert.equal(payment.metadata.machineId, 'W1');
  assert.equal(payment.metadata.program, conversationState.context.programId);
});

test('Laundry flow: status check renders last known machine state with remaining time', async () => {
  // eslint-disable-next-line global-require
  const botConfig = require('../configs/bots/laundry.bot.json');

  const machineStore = new MachineStore();
  await machineStore.upsertMachine({
    botId: botConfig.botId,
    machineId: 'W1',
    status: MachineStatus.IN_USE,
    program: 'quick',
    remainingSeconds: 300,
    lastHeartbeatAt: '2026-01-28T00:00:00.000Z'
  });

  const flowEngine = new FlowEngine({ botConfig, plugin: new LaundryFlowPlugin({ botConfig }) });
  const outboundIntents = [];
  const captureOutboundIntent = async (outboundIntent) => outboundIntents.push(outboundIntent);

  let conversationState = { currentFlowId: null, currentStateId: null, context: {} };

  outboundIntents.length = 0;
  ({ state: conversationState } = await flowEngine.step({
    from: '+237600000000',
    message: { text: { body: 'hi' } },
    state: conversationState,
    send: captureOutboundIntent
  }));
  assert.equal(outboundIntents.length, 1);
  assert.equal(outboundIntents[0].type, 'buttons');

  // Pick FR for this test
  outboundIntents.length = 0;
  ({ state: conversationState } = await flowEngine.step({
    from: '+237600000000',
    message: { interactive: { button_reply: { id: 'lang_fr', title: 'Français' } } },
    state: conversationState,
    send: captureOutboundIntent
  }));
  assert.equal(outboundIntents.length, 1);
  assert.equal(outboundIntents[0].type, 'list');

  outboundIntents.length = 0;
  ({ state: conversationState } = await flowEngine.step({
    from: '+237600000000',
    message: { interactive: { list_reply: { id: 'action_status', title: 'Statut' } } },
    state: conversationState,
    send: captureOutboundIntent
  }));
  assert.equal(outboundIntents.length, 1);
  assert.equal(outboundIntents[0].type, 'list');
  const statusRows = outboundIntents[0].sections?.[0]?.rows || [];
  assert.ok(statusRows.some((r) => r.id === 'W1'));

  outboundIntents.length = 0;
  ({ state: conversationState } = await flowEngine.step({
    from: '+237600000000',
    message: { interactive: { list_reply: { id: 'W1', title: 'W1' } } },
    state: conversationState,
    send: captureOutboundIntent
  }));
  assert.equal(outboundIntents.length, 1);
  assert.match(outboundIntents[0].body, /Machine W1: IN_USE/);
  assert.match(outboundIntents[0].body, /Time remaining: 5 min/);
});
