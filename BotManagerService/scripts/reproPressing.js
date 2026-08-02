/* eslint-disable no-console */
const { FlowEngine } = require('../src/core/flows/flowEngine');
const { ThomasNetworkFlowPlugin } = require('../src/bots/thomasNetwork/thomasNetworkFlowPlugin');
const { MachineStore } = require('../src/core/machines/machineStore');
const { MachineStatus } = require('../src/core/machines/machineTypes');

async function main() {
  // eslint-disable-next-line global-require
  const botConfig = require('../configs/bots/thomasNetwork.bot.json');

  // Seed a washer as available
  const machineStore = new MachineStore();
  await machineStore.upsertMachine({ botId: 'laundry', machineId: 'W2', status: MachineStatus.AVAILABLE });

  const flowEngine = new FlowEngine({ botConfig, plugin: new ThomasNetworkFlowPlugin({ botConfig }) });

  const out = [];
  const send = async (intent) => out.push(intent);
  let state = { currentFlowId: null, currentStateId: null, context: {} };

  out.length = 0;
  ({ state } = await flowEngine.step({ from: '+1', message: { text: { body: 'hi' } }, state, send }));
  console.log('1 outbound', out[0]);
  console.log('1 state', state);

  out.length = 0;
  ({ state } = await flowEngine.step({ from: '+1', message: { text: { body: '2' } }, state, send }));
  console.log('2 outbound', out[0]);
  console.log('2 state', state);

  out.length = 0;
  ({ state } = await flowEngine.step({
    from: '+1',
    message: { interactive: { button_reply: { id: 'pressing_washers', title: 'Disponibilité machines' } } },
    state,
    send
  }));
  console.log('3 outbound', out[0]);
  console.log('3 state', state);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
