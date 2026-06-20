const test = require('node:test');
const assert = require('node:assert/strict');

const { FlowEngine } = require('../src/core/flows/flowEngine');
const { ThomasNetworkFlowPlugin, calculateFinalAmount } = require('../src/bots/thomasNetwork/thomasNetworkFlowPlugin');
const { PaymentStore } = require('../src/core/payments/paymentStore');
const { MachineStore } = require('../src/core/machines/machineStore');
const { MachineStatus } = require('../src/core/machines/machineTypes');
const { redisManager } = require('../src/core/redisManager');

test('ThomasNetwork: calculateFinalAmount computes base + per-device increments', async () => {
  assert.equal(calculateFinalAmount({ baseAmount: 3000, perDeviceAmount: 1000, deviceCount: 1 }), 3000);
  assert.equal(calculateFinalAmount({ baseAmount: 3000, perDeviceAmount: 1000, deviceCount: 2 }), 4000);
  assert.equal(calculateFinalAmount({ baseAmount: 3000, perDeviceAmount: 1000, deviceCount: 3 }), 5000);
});

test('ThomasNetwork flow: select bandwidth -> select devices -> initiate payment with metadata', async () => {
  // eslint-disable-next-line global-require
  const botConfig = require('../configs/bots/thomasNetwork.bot.json');

  const flowEngine = new FlowEngine({ botConfig, plugin: new ThomasNetworkFlowPlugin({ botConfig }) });
  const outboundIntents = [];
  const captureOutboundIntent = async (outboundIntent) => outboundIntents.push(outboundIntent);

  let conversationState = { currentFlowId: null, currentStateId: null, context: {} };

  // 1) Enter menu
  outboundIntents.length = 0;
  ({ state: conversationState } = await flowEngine.step({
    from: '+237600000000',
    message: { text: { body: 'hi' } },
    state: conversationState,
    send: captureOutboundIntent
  }));
  assert.equal(outboundIntents.length, 1);
  assert.equal(outboundIntents[0].type, 'buttons');
  assert.match(outboundIntents[0].body, /Thomas business Network/);

  // 2) Choose service 1
  outboundIntents.length = 0;
  ({ state: conversationState } = await flowEngine.step({
    from: '+237600000000',
    message: { text: { body: '1' } },
    state: conversationState,
    send: captureOutboundIntent
  }));
  assert.equal(outboundIntents.length, 1);
  assert.equal(outboundIntents[0].type, 'buttons');
  assert.match(outboundIntents[0].body, /Choix du d/);

  // 3) Choose bandwidth option 1
  outboundIntents.length = 0;
  ({ state: conversationState } = await flowEngine.step({
    from: '+237600000000',
    message: { text: { body: '1' } },
    state: conversationState,
    send: captureOutboundIntent
  }));
  assert.equal(outboundIntents.length, 1);
  assert.equal(outboundIntents[0].type, 'buttons');
  assert.match(outboundIntents[0].body, /Nombre d'appareils/);

  // 4) Choose 2 devices -> payment initiated
  outboundIntents.length = 0;
  ({ state: conversationState } = await flowEngine.step({
    from: '+237600000000',
    message: { text: { body: '2' } },
    state: conversationState,
    send: captureOutboundIntent
  }));
  assert.equal(outboundIntents.length, 1);
  assert.match(outboundIntents[0].body, /Paiement/);

  const transactionId = conversationState.context.paymentTransactionId;
  assert.ok(transactionId);

  const paymentStore = new PaymentStore({ ttlSeconds: 3600 });
  const payment = await paymentStore.getPayment({ botId: botConfig.botId, transactionId });
  assert.ok(payment);
  assert.equal(payment.metadata.service, 'thomas_network_access');
  assert.equal(payment.metadata.deviceCount, 2);
  assert.equal(payment.metadata.bandwidthId, '10gbps');
});

test('ThomasNetwork pressing: check washer availability and pressing code readiness', async () => {
  // eslint-disable-next-line global-require
  const botConfig = require('../configs/bots/thomasNetwork.bot.json');

  // Seed laundry washer statuses
  const machineStore = new MachineStore();
  await machineStore.upsertMachine({ botId: 'laundry', machineId: 'W1', status: MachineStatus.IN_USE, remainingSeconds: 3600 });
  await machineStore.upsertMachine({ botId: 'laundry', machineId: 'W2', status: MachineStatus.AVAILABLE });

  // Seed a pressing order
  const code = 'PRS123';
  await redisManager.setex(
    `pressingOrder:${botConfig.botId}:${code}`,
    3600,
    JSON.stringify({ code, status: 'IN_PROGRESS', readyAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() })
  );

  const flowEngine = new FlowEngine({ botConfig, plugin: new ThomasNetworkFlowPlugin({ botConfig }) });
  const outboundIntents = [];
  const captureOutboundIntent = async (outboundIntent) => outboundIntents.push(outboundIntent);

  let conversationState = { currentFlowId: null, currentStateId: null, context: {} };

  // 1) Enter menu
  outboundIntents.length = 0;
  ({ state: conversationState } = await flowEngine.step({
    from: '+237600000000',
    message: { text: { body: 'hi' } },
    state: conversationState,
    send: captureOutboundIntent
  }));
  assert.equal(outboundIntents.length, 1);
  assert.equal(outboundIntents[0].type, 'buttons');

  // 2) Choose pressing service
  outboundIntents.length = 0;
  ({ state: conversationState } = await flowEngine.step({
    from: '+237600000000',
    message: { text: { body: '2' } },
    state: conversationState,
    send: captureOutboundIntent
  }));
  assert.equal(outboundIntents.length, 1);
  assert.equal(outboundIntents[0].type, 'buttons');
  assert.match(outboundIntents[0].body, /Pressing/);

  // 3) Check washer availability
  outboundIntents.length = 0;
  ({ state: conversationState } = await flowEngine.step({
    from: '+237600000000',
    message: { interactive: { button_reply: { id: 'pressing_washers', title: 'Disponibilit\u00E9 machines' } } },
    state: conversationState,
    send: captureOutboundIntent
  }));
  assert.equal(outboundIntents.length, 1);
  if (outboundIntents[0].type !== 'buttons') {
    // Debug: printed only on unexpected type
    // eslint-disable-next-line no-console
    console.log('DEBUG pressing washers outboundIntent=', outboundIntents[0]);
    // eslint-disable-next-line no-console
    console.log('DEBUG state=', conversationState);
  }
  assert.equal(outboundIntents[0].type, 'buttons');
  assert.match(outboundIntents[0].body, /machine disponible/i);
  assert.match(outboundIntents[0].body, /W2/);
  assert.ok(outboundIntents[0].buttons?.some((b) => b.title === 'Menu'));

  // 4) Track pressing by code
  outboundIntents.length = 0;
  ({ state: conversationState } = await flowEngine.step({
    from: '+237600000000',
    message: { interactive: { button_reply: { id: 'pressing_track', title: 'Suivi pressing' } } },
    state: conversationState,
    send: captureOutboundIntent
  }));
  assert.equal(outboundIntents.length, 1);
  assert.equal(outboundIntents[0].type, 'text');
  assert.match(outboundIntents[0].body, /code pressing/i);

  outboundIntents.length = 0;
  ({ state: conversationState } = await flowEngine.step({
    from: '+237600000000',
    message: { text: { body: code } },
    state: conversationState,
    send: captureOutboundIntent
  }));
  assert.equal(outboundIntents.length, 1);
  assert.equal(outboundIntents[0].type, 'buttons');
  assert.match(outboundIntents[0].body, /Pas encore|Traitement en cours/);
  assert.match(outboundIntents[0].body, new RegExp(code));
  assert.ok(outboundIntents[0].buttons?.some((b) => b.title === 'Menu'));
});
