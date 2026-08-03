const test = require('node:test');
const assert = require('node:assert/strict');

const { RedisManager } = require('../src/core/redisManager');

test('RedisManager.setex clamps an overflowing TTL to the 32-bit setTimeout max instead of expiring almost immediately', async () => {
  const originalSetTimeout = global.setTimeout;
  const capturedDelays = [];
  global.setTimeout = (fn, delay) => {
    capturedDelays.push(delay);
    return originalSetTimeout(fn, 0); // fire soon so the test doesn't hang, delay value already captured
  };

  try {
    const manager = new RedisManager();
    // 25 days in seconds - the value that overflowed setTimeout's 32-bit ms limit in production.
    const twentyFiveDaysSeconds = 25 * 24 * 60 * 60;
    await manager.setex('some-key', twentyFiveDaysSeconds, 'some-value');

    assert.equal(capturedDelays.length, 1);
    assert.ok(capturedDelays[0] <= 2 ** 31 - 1, `delay ${capturedDelays[0]} exceeds the 32-bit setTimeout max`);
    assert.equal(capturedDelays[0], 2 ** 31 - 1);

    // The value itself must still be readable immediately (not evicted early
    // just because the requested TTL was longer than setTimeout can express).
    assert.equal(await manager.get('some-key'), 'some-value');
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test('RedisManager.setnx clamps an overflowing TTL to the 32-bit setTimeout max', async () => {
  const originalSetTimeout = global.setTimeout;
  const capturedDelays = [];
  global.setTimeout = (fn, delay) => {
    capturedDelays.push(delay);
    return originalSetTimeout(fn, 0);
  };

  try {
    const manager = new RedisManager();
    const thirtyDaysSeconds = 30 * 24 * 60 * 60;
    const acquired = await manager.setnx('lock-key', '1', thirtyDaysSeconds);

    assert.equal(acquired, true);
    assert.equal(capturedDelays.length, 1);
    assert.equal(capturedDelays[0], 2 ** 31 - 1);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test('RedisManager.setex passes the real ttlSeconds through untouched to Redis (no clamping needed server-side)', async () => {
  const setExCalls = [];
  const manager = new RedisManager();
  manager.connected = true;
  manager.client = {
    setEx: async (key, ttl, value) => {
      setExCalls.push({ key, ttl, value });
    }
  };

  const twentyFiveDaysSeconds = 25 * 24 * 60 * 60;
  await manager.setex('some-key', twentyFiveDaysSeconds, 'some-value');

  assert.equal(setExCalls.length, 1);
  assert.equal(setExCalls[0].ttl, twentyFiveDaysSeconds);
});

test('RedisManager.del removes a key from the in-memory fallback', async () => {
  const manager = new RedisManager();
  await manager.set('some-key', 'some-value');
  assert.equal(await manager.get('some-key'), 'some-value');

  await manager.del('some-key');

  assert.equal(await manager.get('some-key'), undefined);
});

test('RedisManager.del calls the real client when connected', async () => {
  const delCalls = [];
  const manager = new RedisManager();
  manager.connected = true;
  manager.client = {
    del: async (key) => delCalls.push(key)
  };

  await manager.del('some-key');

  assert.deepEqual(delCalls, ['some-key']);
});
