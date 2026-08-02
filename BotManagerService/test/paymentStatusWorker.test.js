const test = require('node:test');
const assert = require('node:assert/strict');

const { EventEmitter } = require('node:events');
const { PaymentStatusWorker } = require('../src/core/payments/paymentStatusWorker');
const { PaymentGateway } = require('../src/core/payments/paymentGateway');
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

  // The timeout must land in the ledger too, not just the derived snapshot -
  // otherwise a payment that silently expired leaves no audit trail entry
  // explaining why its status changed.
  const timeoutEvents = await store.getEvents({ botId: 'laundry', transactionId: 'tx-timeout' });
  assert.ok(timeoutEvents.some((e) => e.eventType === 'payment_timed_out'));

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

test('regression: payment.completed fires through the real PaymentGateway.checkStatus path, where the store already reflects the new status before payment.status is emitted', async () => {
  // The fake-gateway tests above never write to the store from checkStatus,
  // so they never exercised the actual bug: the real PaymentGateway.checkStatus
  // appends the new status to the store (via appendEvent) *before*
  // PaymentStatusWorker emits 'payment.status'. _onStatus must use the
  // previousStatus carried on the event, not re-derive it from the store
  // (which by then already holds the new status) - otherwise every real
  // transition looks like "no change" and payment.completed never fires.
  const events = new EventEmitter();
  const store = new PaymentStore({ ttlSeconds: 60 });

  let checks = 0;
  const provider = {
    checkStatus: async () => {
      checks += 1;
      return { status: checks >= 2 ? 'COMPLETED' : 'PENDING', raw: {} };
    }
  };
  const gateway = new PaymentGateway({ providers: { campay: provider }, store });

  const botRegistry = { getBotByName: () => null };

  const worker = new PaymentStatusWorker({
    gateway,
    store,
    events,
    botRegistry,
    pollIntervalMs: 5,
    timeoutMs: 200
  });

  worker.start();

  await store.appendEvent({
    botId: 'laundry-real-gateway',
    transactionId: 'tx-real-done',
    provider: 'campay',
    eventType: 'payment_initiated',
    status: PaymentStatus.PENDING,
    source: 'initiate'
  });

  // Await the actual event with a bounded timeout, rather than a fixed
  // sleep-then-check - this fails deterministically (not flakily) if the
  // regression this test guards against ever comes back and
  // payment.completed silently stops firing.
  const completed = await new Promise((resolve, reject) => {
    const timeoutTimer = setTimeout(() => reject(new Error('Timed out waiting for payment.completed')), 2000);
    events.once('payment.completed', () => {
      clearTimeout(timeoutTimer);
      resolve(true);
    });
    events.emit('payment.initiated', { botId: 'laundry-real-gateway', provider: 'campay', transactionId: 'tx-real-done' });
  });

  assert.equal(completed, true);

  worker.stop();
});
