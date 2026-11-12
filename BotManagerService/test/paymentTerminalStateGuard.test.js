// Regression suite for the 2026-11-11 production leak: a PayPal payment link
// stayed usable after the bot had already told the customer the payment failed
// (TIMEOUT), and a later PAYMENT.CAPTURE.COMPLETED webhook walked straight
// through to "✅ Payment received!". See
// docs/bugfixes/afromarket-paypal-terminal-state-bugfix.md.
//
// The rule under test: PaymentStore.appendEvent is the single write boundary
// every success path funnels through, and a payment that is already terminal
// can never transition to COMPLETED there - no matter which path reports it.
// Store-level cases live here; the route-level end-to-end cases live in
// paypalWebhookRoute.test.js next to the rest of the webhook harness.
const test = require('node:test');
const assert = require('node:assert/strict');

const { PaymentStore } = require('../src/core/payments/paymentStore');
const { PaymentStatus, isTerminalStatus } = require('../src/core/payments/paymentTypes');

function newStore() {
  return new PaymentStore({ ttlSeconds: 60 });
}

// The three terminal states the guard must refuse a COMPLETED against. Note
// there is no distinct CANCELLED status in this system: normalizeStatus folds
// CANCELLED/CANCELED into FAILED, so a cancelled order is a FAILED payment
// carrying that failureReason. Driving all three through one parameterized
// case is deliberate - they must not drift apart.
// isIncident marks the cases where money moved for a payment the customer was
// told had failed. An already-paid payment receiving a second COMPLETED signal
// is NOT an incident - that is simply how PayPal reports a completion (capture
// response, then PAYMENT.CAPTURE.COMPLETED, plus the backstop poll).
const TERMINAL_CASES = [
  { label: 'timed out', status: PaymentStatus.FAILED, failureReason: 'TIMEOUT', isIncident: true },
  { label: 'cancelled', status: PaymentStatus.FAILED, failureReason: 'CANCELLED', isIncident: true },
  { label: 'already paid', status: PaymentStatus.COMPLETED, failureReason: null, isIncident: false }
];

for (const terminalCase of TERMINAL_CASES) {
  test(`appendEvent refuses to mark a ${terminalCase.label} payment COMPLETED`, async () => {
    const store = newStore();
    const transactionId = `tx-terminal-${terminalCase.failureReason || 'paid'}`;

    await store.appendEvent({
      botId: 'afromarket',
      transactionId,
      provider: 'paypal',
      eventId: `seed-${transactionId}`,
      eventType: 'payment_status_updated',
      status: terminalCase.status,
      failureReason: terminalCase.failureReason,
      customerPhone: '+237600000000',
      amount: 20,
      currency: 'EUR',
      metadata: { orderNumber: 'AM-SEED' },
      source: 'seed'
    });

    const result = await store.appendEvent({
      botId: 'afromarket',
      transactionId,
      provider: 'paypal',
      eventId: `late-capture-${transactionId}`,
      eventType: 'payment_completed',
      status: PaymentStatus.COMPLETED,
      // Same amount as the order: this is an idempotent repeat of the same
      // completion, not a second capture. A differing amount is its own case,
      // covered separately below.
      amount: 20,
      currency: 'EUR',
      metadata: { paypalPayerContact: 'payer@example.com' },
      source: 'webhook'
    });

    assert.equal(result.duplicate, false);
    assert.equal(result.blocked, true, 'the transition into COMPLETED must be refused');
    assert.equal(result.terminalStatus, terminalCase.status);
    assert.equal(
      result.capturedAfterDeath,
      terminalCase.isIncident,
      'only a completion against a FAILED payment is an incident'
    );

    const stored = await store.getPayment({ botId: 'afromarket', transactionId });
    assert.equal(stored.status, terminalCase.status, 'stored status must not move to COMPLETED');
    assert.equal(stored.failureReason || null, terminalCase.failureReason);
    assert.equal(stored.amount, 20, 'a refused transition must not restate the order amount');
    assert.equal(stored.currency, 'EUR', 'a refused transition must not restate the currency');
    assert.deepEqual(
      stored.metadata,
      { orderNumber: 'AM-SEED', paypalPayerContact: 'payer@example.com' },
      'a refused write may add payer details the record lacked, but must not overwrite the order metadata'
    );

    const queued = await store.getCapturedAfterTerminal({ botId: 'afromarket' });
    const entry = queued.find((item) => item.transactionId === transactionId);
    const ledger = await store.getEvents({ botId: 'afromarket', transactionId });

    if (terminalCase.isIncident) {
      // The money must not go quiet: flagged on the record and queued for a human.
      assert.equal(stored.capturedAfterTerminal, true);
      assert.equal(stored.capturedAfterTerminalAmount, 20, 'the capture amount is kept under its own key');
      assert.equal(stored.capturedAfterTerminalCurrency, 'EUR');
      assert.deepEqual(
        stored.capturedAfterTerminalMetadata,
        { paypalPayerContact: 'payer@example.com' },
        'the payer details a refund needs are kept without overwriting order metadata'
      );

      assert.ok(entry, 'a captured-after-terminal entry must be queued for manual review');
      assert.equal(entry.amount, 20);
      assert.equal(entry.terminalStatus, terminalCase.status);
      assert.equal(entry.customerPhone, undefined, 'the review queue must stay free of PII');
      assert.equal(entry.metadata, undefined, 'the review queue must stay free of PII');
      assert.ok(
        ledger.some((item) => item.eventType === 'payment_completed_blocked_after_terminal'),
        'the blocked event must still be appended to the ledger'
      );
    } else {
      assert.equal(stored.capturedAfterTerminal, undefined, 'a repeat completion of a paid order is not an incident');
      assert.equal(entry, undefined, 'a repeat completion must not be filed in the manual-review queue');
      assert.ok(
        ledger.some((item) => item.eventType === 'payment_completed_duplicate_signal'),
        'the repeat signal is still recorded, just not as an incident'
      );
    }
  });
}

test('appendEvent still allows COMPLETED -> FAILED so a reversal is never masked', async () => {
  const store = newStore();

  await store.appendEvent({
    botId: 'afromarket',
    transactionId: 'tx-reversal',
    provider: 'paypal',
    eventId: 'seed-reversal',
    eventType: 'payment_completed',
    status: PaymentStatus.COMPLETED,
    amount: 10,
    currency: 'EUR',
    source: 'webhook'
  });

  const result = await store.appendEvent({
    botId: 'afromarket',
    transactionId: 'tx-reversal',
    provider: 'paypal',
    eventId: 'capture-denied',
    eventType: 'payment_failed',
    status: PaymentStatus.FAILED,
    failureReason: 'DENIED',
    source: 'webhook'
  });

  assert.equal(result.blocked, false, 'the guard is one-directional: only transitions INTO COMPLETED are refused');

  const stored = await store.getPayment({ botId: 'afromarket', transactionId: 'tx-reversal' });
  assert.equal(stored.status, PaymentStatus.FAILED);
  assert.equal(stored.capturedAfterTerminal, undefined);
});

test('appendEvent lets a normal PENDING -> COMPLETED payment through untouched', async () => {
  const store = newStore();

  await store.appendEvent({
    botId: 'afromarket',
    transactionId: 'tx-happy-path',
    provider: 'paypal',
    eventId: 'seed-happy',
    eventType: 'payment_initiated',
    status: PaymentStatus.PENDING,
    source: 'initiate'
  });

  const result = await store.appendEvent({
    botId: 'afromarket',
    transactionId: 'tx-happy-path',
    provider: 'paypal',
    eventId: 'capture-happy',
    eventType: 'payment_completed',
    status: PaymentStatus.COMPLETED,
    amount: 12.5,
    currency: 'EUR',
    source: 'capture-response'
  });

  assert.equal(result.blocked, false);
  assert.equal(result.previousStatus, PaymentStatus.PENDING);

  const stored = await store.getPayment({ botId: 'afromarket', transactionId: 'tx-happy-path' });
  assert.equal(stored.status, PaymentStatus.COMPLETED);
  assert.equal(stored.capturedAfterTerminal, undefined);
});

// The duplicate-webhook race in its store-level form: PayPal sends the capture
// response and PAYMENT.CAPTURE.COMPLETED as two separate deliveries with
// different event ids, so event-id dedup does not catch the second one. Only
// the first may count as a completion; the second must not produce a duplicate
// order, and must not be mistaken for money captured after death either.
test('a second COMPLETED delivery for an already-paid payment is blocked, not treated as a new completion', async () => {
  const store = newStore();

  const first = await store.appendEvent({
    botId: 'afromarket',
    transactionId: 'tx-dup-race',
    provider: 'paypal',
    eventId: 'capture-response:CAP-1',
    eventType: 'payment_completed',
    status: PaymentStatus.COMPLETED,
    amount: 20,
    currency: 'EUR',
    source: 'capture-response'
  });

  const second = await store.appendEvent({
    botId: 'afromarket',
    transactionId: 'tx-dup-race',
    provider: 'paypal',
    eventId: 'WH-PAYMENT-CAPTURE-COMPLETED-1',
    eventType: 'payment_completed',
    status: PaymentStatus.COMPLETED,
    // Same amount: a genuine idempotent repeat of the first completion.
    amount: 20,
    currency: 'EUR',
    source: 'webhook'
  });

  assert.equal(first.blocked, false, 'the first completion is the real one');
  assert.equal(second.duplicate, false, 'different event ids, so event-id dedup does not apply here');
  assert.equal(second.blocked, true, 'the second completion must be refused rather than emitted again');
  assert.equal(second.capturedAfterDeath, false, 'a repeat completion of a paid order is not money captured after death');

  const stored = await store.getPayment({ botId: 'afromarket', transactionId: 'tx-dup-race' });
  assert.equal(stored.status, PaymentStatus.COMPLETED);
  assert.equal(stored.amount, 20, 'the amount must not be restated by the refused repeat');
  assert.equal(stored.currency, 'EUR', 'the currency must not be restated by the refused repeat');
});

test('an identical redelivery of the same event id is still deduped before the guard', async () => {
  const store = newStore();

  await store.appendEvent({
    botId: 'afromarket',
    transactionId: 'tx-redelivery',
    provider: 'paypal',
    eventId: 'WH-SAME-ID',
    eventType: 'payment_completed',
    status: PaymentStatus.COMPLETED,
    amount: 5,
    currency: 'EUR',
    source: 'webhook'
  });

  const redelivered = await store.appendEvent({
    botId: 'afromarket',
    transactionId: 'tx-redelivery',
    provider: 'paypal',
    eventId: 'WH-SAME-ID',
    eventType: 'payment_completed',
    status: PaymentStatus.COMPLETED,
    amount: 5,
    currency: 'EUR',
    source: 'webhook'
  });

  assert.equal(redelivered.duplicate, true);
  assert.equal(redelivered.blocked, undefined, 'dedup short-circuits before the terminal-state guard runs');

  const stored = await store.getPayment({ botId: 'afromarket', transactionId: 'tx-redelivery' });
  assert.equal(stored.capturedAfterTerminal, undefined, 'a plain redelivery is not money captured after death');
});

test('isTerminalStatus covers exactly COMPLETED and FAILED', () => {
  assert.equal(isTerminalStatus(PaymentStatus.COMPLETED), true);
  assert.equal(isTerminalStatus(PaymentStatus.FAILED), true);
  assert.equal(isTerminalStatus(PaymentStatus.PENDING), false);
  assert.equal(isTerminalStatus(PaymentStatus.PROCESSING), false);
  assert.equal(isTerminalStatus(null), false);
});

// Positive control for everything above: the guard must never cost a paying
// customer their order. A blocked repeat delivery lands BEFORE the worker
// processes the legitimate first completion - the ordering that an earlier
// draft of the worker guard got wrong by also keying on the record's
// capturedAfterTerminal flag. (That exact flag is no longer set in this
// scenario, since a repeat against a COMPLETED payment is not an incident, so
// this test pins the outcome rather than reproducing that draft's internals.)
test('the legitimate first completion still emits payment.completed even after a blocked repeat flags the record', async () => {
  const { EventEmitter } = require('node:events');
  const { PaymentStatusWorker } = require('../src/core/payments/paymentStatusWorker');

  const events = new EventEmitter();
  const store = newStore();
  const worker = new PaymentStatusWorker({
    gateway: { checkStatus: async () => ({ status: 'PENDING', raw: {} }) },
    store,
    events,
    botRegistry: { getBotByName: () => null },
    logger: { warn: () => {} },
    pollIntervalMs: 50000,
    timeoutMs: 50000
  });

  let completedCount = 0;
  events.on('payment.completed', () => {
    completedCount += 1;
  });

  await store.upsertPayment({
    botId: 'afromarket',
    transactionId: 'tx-positive-control',
    provider: 'paypal',
    status: PaymentStatus.PENDING,
    amount: 15,
    currency: 'EUR'
  });

  // Delivery 1: the capture response - a real completion.
  const first = await store.appendEvent({
    botId: 'afromarket',
    transactionId: 'tx-positive-control',
    provider: 'paypal',
    eventId: 'capture-response:CAP-POS',
    eventType: 'payment_completed',
    status: PaymentStatus.COMPLETED,
    amount: 15,
    currency: 'EUR',
    source: 'capture-response'
  });
  assert.equal(first.blocked, false);

  // Delivery 2 lands first, before the worker has processed delivery 1.
  await store.appendEvent({
    botId: 'afromarket',
    transactionId: 'tx-positive-control',
    provider: 'paypal',
    eventId: 'WH-POS-CAPTURE-COMPLETED',
    eventType: 'payment_completed',
    status: PaymentStatus.COMPLETED,
    amount: 15,
    currency: 'EUR',
    source: 'webhook'
  });

  await worker._onStatus({
    botId: 'afromarket',
    provider: 'paypal',
    transactionId: 'tx-positive-control',
    status: PaymentStatus.COMPLETED,
    previousStatus: first.previousStatus
  });

  assert.equal(completedCount, 1, 'the paying customer must still get their order confirmed');

  worker.stop();
});

// The race appendEvent cannot see: _handleTimeout's read-then-write is not
// atomic, so a capture that legitimately wrote COMPLETED (nothing to block)
// can be overwritten by a timeout that read PENDING a moment earlier. The
// worker drops the COMPLETED - correctly - but the money still moved, so it
// must not drop it silently.
test('a COMPLETED dropped by the worker against a FAILED record is queued for manual review', async () => {
  const { EventEmitter } = require('node:events');
  const { PaymentStatusWorker } = require('../src/core/payments/paymentStatusWorker');

  const events = new EventEmitter();
  const store = newStore();
  const warnings = [];
  const worker = new PaymentStatusWorker({
    gateway: { checkStatus: async () => ({ status: 'PENDING', raw: {} }) },
    store,
    events,
    botRegistry: { getBotByName: () => null },
    logger: { warn: (...args) => warnings.push(args) },
    pollIntervalMs: 50000,
    timeoutMs: 50000
  });

  let completedCount = 0;
  events.on('payment.completed', () => {
    completedCount += 1;
  });

  await store.upsertPayment({
    botId: 'afromarket',
    transactionId: 'tx-worker-drop',
    provider: 'paypal',
    status: PaymentStatus.FAILED,
    failureReason: 'TIMEOUT',
    externalRef: 'AM-WORKER-DROP',
    amount: 42,
    currency: 'EUR'
  });

  // previousStatus PENDING: the emitter genuinely saw PENDING before its own
  // write, so appendEvent had nothing to block - only the stored FAILED
  // reveals that the timeout overtook it.
  await worker._onStatus({
    botId: 'afromarket',
    provider: 'paypal',
    transactionId: 'tx-worker-drop',
    status: PaymentStatus.COMPLETED,
    previousStatus: PaymentStatus.PENDING
  });

  assert.equal(completedCount, 0, 'the dropped COMPLETED must not confirm an order');
  assert.ok(warnings.length > 0, 'the drop must be logged');

  const queued = await store.getCapturedAfterTerminal({ botId: 'afromarket' });
  const entry = queued.find((item) => item.transactionId === 'tx-worker-drop');
  assert.ok(entry, 'the dropped completion must still reach the manual-review queue');
  assert.equal(entry.amount, 42);
  assert.equal(entry.terminalStatus, PaymentStatus.FAILED);
  assert.equal(entry.source, 'status-event-dropped');

  const stored = await store.getPayment({ botId: 'afromarket', transactionId: 'tx-worker-drop' });
  assert.equal(stored.status, PaymentStatus.FAILED, 'the payment stays FAILED');
  assert.equal(stored.capturedAfterTerminal, true);

  worker.stop();
});

// Finding from review: mapCaptureStatus folds REFUNDED/REVERSED/
// PARTIALLY_REFUNDED into PENDING (deliberately - no refund concept exists
// elsewhere in the payment system). Keyed on the snapshot alone, a reversal
// therefore demoted a COMPLETED payment back out of terminal and a late
// COMPLETED walked straight through, resurrecting it. The durable terminal
// marker is what closes that.
test('a reversal does not demote a completed payment out of terminal', async () => {
  const store = newStore();

  await store.appendEvent({
    botId: 'afromarket',
    transactionId: 'tx-reversal-resurrect',
    provider: 'paypal',
    eventId: 'capture-completed',
    eventType: 'payment_completed',
    status: PaymentStatus.COMPLETED,
    amount: 30,
    currency: 'EUR',
    source: 'capture-response'
  });

  // PAYMENT.CAPTURE.REVERSED -> mapCaptureStatus -> PENDING.
  await store.appendEvent({
    botId: 'afromarket',
    transactionId: 'tx-reversal-resurrect',
    provider: 'paypal',
    eventId: 'capture-reversed',
    eventType: 'payment_status_updated',
    status: PaymentStatus.PENDING,
    source: 'webhook'
  });

  const stored = await store.getPayment({ botId: 'afromarket', transactionId: 'tx-reversal-resurrect' });
  assert.equal(stored.status, PaymentStatus.PENDING, 'the reversal itself is recorded, as before');

  const late = await store.appendEvent({
    botId: 'afromarket',
    transactionId: 'tx-reversal-resurrect',
    provider: 'paypal',
    eventId: 'late-completed',
    eventType: 'payment_completed',
    status: PaymentStatus.COMPLETED,
    amount: 30,
    currency: 'EUR',
    source: 'webhook'
  });

  assert.equal(late.blocked, true, 'the payment reached COMPLETED once; a reversal must not make it completable again');
});

// Finding from review: the payment record's own TTL is 24h, but PayPal retries
// a failed webhook delivery with backoff over roughly three days. Once the
// record expired, previousStatus was null and a late COMPLETED resurrected the
// payment as a fresh completion - emitting a second order confirmation for a
// payment made once. The marker outlives the record for exactly this reason.
test('the guard still holds after the payment record itself has expired', async () => {
  const store = newStore();

  await store.appendEvent({
    botId: 'afromarket',
    transactionId: 'tx-record-expired',
    provider: 'paypal',
    eventId: 'first-completion',
    eventType: 'payment_completed',
    status: PaymentStatus.COMPLETED,
    amount: 25,
    currency: 'EUR',
    source: 'capture-response'
  });

  // Simulate the 24h record TTL elapsing while the 30-day marker survives.
  const { redisManager } = require('../src/core/redisManager');
  await redisManager.del(`payment:afromarket:tx-record-expired`);
  assert.equal(
    await store.getPayment({ botId: 'afromarket', transactionId: 'tx-record-expired' }),
    null,
    'precondition: the record is gone'
  );

  const retried = await store.appendEvent({
    botId: 'afromarket',
    transactionId: 'tx-record-expired',
    provider: 'paypal',
    eventId: 'retried-capture-webhook',
    eventType: 'payment_completed',
    status: PaymentStatus.COMPLETED,
    amount: 25,
    currency: 'EUR',
    source: 'webhook'
  });

  assert.equal(retried.blocked, true, 'a retried delivery must not resurrect an expired completed payment');
});

// A repeat of the same completion carries the same amount. A different amount
// is a second capture, not a second signal about the first - so it is an
// incident even though the payment was already COMPLETED rather than FAILED.
test('a late capture for a different amount is an incident, not a harmless repeat', async () => {
  const store = newStore();

  await store.appendEvent({
    botId: 'afromarket',
    transactionId: 'tx-amount-mismatch',
    provider: 'paypal',
    eventId: 'first-capture',
    eventType: 'payment_completed',
    status: PaymentStatus.COMPLETED,
    amount: 20,
    currency: 'EUR',
    source: 'capture-response'
  });

  const second = await store.appendEvent({
    botId: 'afromarket',
    transactionId: 'tx-amount-mismatch',
    provider: 'paypal',
    eventId: 'second-capture',
    eventType: 'payment_completed',
    status: PaymentStatus.COMPLETED,
    amount: 99,
    currency: 'EUR',
    source: 'webhook'
  });

  assert.equal(second.blocked, true);
  assert.equal(second.capturedAfterDeath, true, 'a mismatched amount must not be filed away as an idempotent repeat');

  const queued = await store.getCapturedAfterTerminal({ botId: 'afromarket' });
  assert.ok(queued.some((entry) => entry.transactionId === 'tx-amount-mismatch'));

  const stored = await store.getPayment({ botId: 'afromarket', transactionId: 'tx-amount-mismatch' });
  assert.equal(stored.amount, 20, 'the order total stands; the capture amount is recorded separately');
  assert.equal(stored.capturedAfterTerminalAmount, 99);
});

// The review queue is the safety net; two rows for one incident, disagreeing
// on the amount, is worse than none. appendEvent and the worker's own drop
// path both claim the same atomic key, so only one of them files it.
test('appendEvent and the worker drop path cannot both file the same incident', async () => {
  const store = newStore();

  await store.upsertPayment({
    botId: 'afromarket',
    transactionId: 'tx-single-entry',
    provider: 'paypal',
    status: PaymentStatus.FAILED,
    failureReason: 'TIMEOUT',
    amount: 42,
    currency: 'EUR'
  });
  await store.markTerminal({ botId: 'afromarket', transactionId: 'tx-single-entry', status: PaymentStatus.FAILED });

  await store.appendEvent({
    botId: 'afromarket',
    transactionId: 'tx-single-entry',
    provider: 'paypal',
    eventId: 'late-capture-webhook',
    eventType: 'payment_completed',
    status: PaymentStatus.COMPLETED,
    amount: 39.94,
    currency: 'USD',
    source: 'webhook'
  });

  const filedAgain = await store.flagCapturedAfterTerminal({
    botId: 'afromarket',
    transactionId: 'tx-single-entry',
    provider: 'paypal',
    terminalStatus: PaymentStatus.FAILED,
    source: 'status-event-dropped'
  });

  assert.equal(filedAgain, false, 'the second filer must stand down rather than add a conflicting row');

  const queued = await store.getCapturedAfterTerminal({ botId: 'afromarket' });
  const entries = queued.filter((entry) => entry.transactionId === 'tx-single-entry');
  assert.equal(entries.length, 1, 'exactly one review-queue entry per incident');

  // The entry that survived must still carry the capture details a refund needs.
  const stored = await store.getPayment({ botId: 'afromarket', transactionId: 'tx-single-entry' });
  assert.equal(stored.capturedAfterTerminalAmount, 39.94);
  assert.equal(stored.capturedAfterTerminalCurrency, 'USD');
});
