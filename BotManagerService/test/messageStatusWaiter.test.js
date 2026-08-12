const test = require('node:test');
const assert = require('node:assert/strict');

const { MessageStatusWaiter, waitForCarouselDelivery } = require('../src/core/whatsapp/messageStatusWaiter');

test('MessageStatusWaiter.waitFor resolves immediately when messageId is falsy', async () => {
  const waiter = new MessageStatusWaiter();
  const result = await waiter.waitFor(null, 30000);

  assert.deepEqual(result, { status: null, timedOut: true });
});

test('MessageStatusWaiter.waitFor resolves via notify() before the timeout, not after', async () => {
  const waiter = new MessageStatusWaiter();
  const resultPromise = waiter.waitFor('wamid.abc', 30000);

  waiter.notify('wamid.abc', 'sent');

  const result = await resultPromise;
  assert.deepEqual(result, { status: 'sent', timedOut: false });
});

test('MessageStatusWaiter.waitFor times out when notify() never arrives', async () => {
  const waiter = new MessageStatusWaiter();
  const result = await waiter.waitFor('wamid.never-notified', 5);

  assert.deepEqual(result, { status: null, timedOut: true });
});

test('MessageStatusWaiter.waitFor resolves the earlier caller instead of hanging it forever when a second call reuses the same messageId', async () => {
  // Defends the "shouldn't happen, but defensively handled" overwrite path:
  // the first waitFor() must still settle - as timedOut:true, the same way
  // an actual timeout does, since a collision isn't a real delivery
  // confirmation - rather than being abandoned when a second call for the
  // same id registers before the first one resolves.
  const waiter = new MessageStatusWaiter();
  const firstPromise = waiter.waitFor('wamid.reused', 30000);
  const secondPromise = waiter.waitFor('wamid.reused', 30000);

  const firstResult = await firstPromise;
  assert.deepEqual(firstResult, { status: null, timedOut: true });

  waiter.notify('wamid.reused', 'delivered');
  const secondResult = await secondPromise;
  assert.deepEqual(secondResult, { status: 'delivered', timedOut: false });
});

test('waitForCarouselDelivery times out and proceeds when a real messageId never gets notified', async (t) => {
  // Deterministic (mocked timers) rather than measuring real elapsed wall
  // time - a tight `Date.now()` threshold like this one used to fail
  // intermittently in CI (confirmed, not hypothetical: see PR #85's first
  // CI run) since setTimeout/Date.now() granularity isn't guaranteed down
  // to single milliseconds on every runner.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolved = false;
  const promise = waitForCarouselDelivery('wamid.never-notified-integration', 10).then(() => {
    resolved = true;
  });

  await Promise.resolve();
  assert.equal(resolved, false, 'should not resolve before the timer fires');

  t.mock.timers.tick(10);
  await promise;
  assert.equal(resolved, true);
});

test('MessageStatusWaiter.notify is a no-op for an id nobody is waiting on', () => {
  const waiter = new MessageStatusWaiter();
  assert.doesNotThrow(() => waiter.notify('wamid.unknown', 'delivered'));
});

test('MessageStatusWaiter.reset clears pending waiters without resolving or rejecting them', async () => {
  const waiter = new MessageStatusWaiter();
  const resultPromise = waiter.waitFor('wamid.reset-me', 30000);
  waiter.reset();

  // Notifying after reset must be a no-op (the waiter entry is gone), and
  // the original promise must simply never settle - proven by racing it
  // against a short timer instead of awaiting it directly.
  waiter.notify('wamid.reset-me', 'sent');
  const outcome = await Promise.race([
    resultPromise.then(() => 'resolved'),
    new Promise((resolve) => {
      setTimeout(() => resolve('still-pending'), 20);
    })
  ]);

  assert.equal(outcome, 'still-pending');
});

test('waitForCarouselDelivery falls back to a timed sleep when there is no messageId to correlate', async (t) => {
  // Deterministic (mocked timers), same reasoning as the test above.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolved = false;
  const promise = waitForCarouselDelivery(null, 10).then(() => {
    resolved = true;
  });

  await Promise.resolve();
  assert.equal(resolved, false, 'should not resolve before the timer fires');

  t.mock.timers.tick(10);
  await promise;
  assert.equal(resolved, true);
});
