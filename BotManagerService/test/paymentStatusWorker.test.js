const test = require('node:test');
const assert = require('node:assert/strict');

const { EventEmitter } = require('node:events');
const { PaymentStatusWorker } = require('../src/core/payments/paymentStatusWorker');
const { PaymentStore } = require('../src/core/payments/paymentStore');
const { PaymentStatus } = require('../src/core/payments/paymentTypes');

test('PaymentStatusWorker times out pending payment and marks FAILED', async () => {
  const events = new EventEmitter();
  const store = new PaymentStore({ ttlSeconds: 60 });

  const gateway = {
    checkStatus: async () => ({ status: PaymentStatus.PENDING })
  };

  const botRegistry = {
    getBotByName: () => null
  };

  const worker = new PaymentStatusWorker({
    gateway,
    store,
    events,
    botRegistry,
    pollIntervalMs: 5,
    timeoutMs: 30
  });

  worker.start();

  await store.upsertPayment({
    botId: 'laundry',
    provider: 'campay',
    transactionId: 'tx-timeout',
    status: PaymentStatus.PENDING
  });

  events.emit('payment.initiated', { botId: 'laundry', provider: 'campay', transactionId: 'tx-timeout' });

  await new Promise((r) => setTimeout(r, 60));

  const payment = await store.getPayment({ botId: 'laundry', transactionId: 'tx-timeout' });
  assert.equal(payment.status, PaymentStatus.FAILED);
  assert.equal(payment.failureReason, 'TIMEOUT');

  worker.stop();
});

test('PaymentStatusWorker emits payment.completed and stops tracking', async () => {
  const events = new EventEmitter();
  const store = new PaymentStore({ ttlSeconds: 60 });

  let checks = 0;
  const gateway = {
    checkStatus: async () => {
      checks += 1;
      return { status: checks >= 2 ? PaymentStatus.COMPLETED : PaymentStatus.PENDING };
    }
  };

  const botRegistry = {
    getBotByName: () => null
  };

  const worker = new PaymentStatusWorker({
    gateway,
    store,
    events,
    botRegistry,
    pollIntervalMs: 5,
    timeoutMs: 200
  });

  worker.start();

  await store.upsertPayment({
    botId: 'laundry',
    provider: 'campay',
    transactionId: 'tx-done',
    status: PaymentStatus.PENDING
  });

  let completed = false;
  events.on('payment.completed', () => {
    completed = true;
  });

  events.emit('payment.initiated', { botId: 'laundry', provider: 'campay', transactionId: 'tx-done' });

  await new Promise((r) => setTimeout(r, 80));

  assert.equal(completed, true);

  worker.stop();
});
