const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { MachineService } = require('../src/core/machines/machineService');
const { MachineStore } = require('../src/core/machines/machineStore');
const { MachineStatus } = require('../src/core/machines/machineTypes');

class FakeMqtt extends EventEmitter {
  constructor() {
    super();
    this.publishes = [];
    this.subscriptions = [];
    this.connected = true;
  }

  async init() {
    return;
  }

  async publish(topic, payload) {
    this.publishes.push({ topic, payload });
    return true;
  }

  async subscribe(topic) {
    this.subscriptions.push(topic);
    return true;
  }
}

test('MachineService starts machine on payment.completed when metadata has machineId', async () => {
  const events = new EventEmitter();
  const mqtt = new FakeMqtt();

  const botRegistry = {
    bots: new Map([
      [
        'laundry',
        {
          config: {
            botId: 'laundry',
            mqtt: { topicPrefix: 'laundry' },
            machines: [{ id: 'W1', type: 'WASHER', name: 'Washer 1' }]
          }
        }
      ]
    ]),
    getBotByName(name) {
      return this.bots.get(name) || null;
    }
  };

  const svc = new MachineService({ botRegistry, mqttManager: mqtt, paymentEvents: events });
  await svc.init();

  const store = new MachineStore();
  await store.upsertMachine({ botId: 'laundry', machineId: 'W1', status: MachineStatus.AVAILABLE });

  events.emit('payment.completed', {
    botId: 'laundry',
    provider: 'campay',
    transactionId: 'tx-123',
    payment: {
      customerPhone: '+237600000000',
      metadata: { machineId: 'W1', program: 'quick' }
    }
  });

  await new Promise((r) => setTimeout(r, 10));

  assert.equal(mqtt.publishes.length, 1);
  assert.equal(mqtt.publishes[0].topic, 'laundry/machine-W1/command');
  const body = JSON.parse(mqtt.publishes[0].payload);
  assert.equal(body.command, 'START');
  assert.equal(body.machineId, 'W1');
  assert.equal(body.transactionId, 'tx-123');

  const updated = await store.getMachine({ botId: 'laundry', machineId: 'W1' });
  assert.equal(updated.status, MachineStatus.IN_USE);
  assert.equal(updated.currentUser, '+237600000000');
});
