const test = require('node:test');
const assert = require('node:assert/strict');

const { RetentionWorker } = require('../src/core/retention/retentionWorker');

function fakePool(results) {
  const calls = [];
  return {
    calls,
    query: async (sql) => {
      calls.push(sql);
      if (/DELETE FROM invoice_record/.test(sql)) return results.invoices;
      if (/DELETE FROM customer_profile/.test(sql)) return results.profiles;
      throw new Error(`Unexpected query in test: ${sql}`);
    }
  };
}

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

test('RetentionWorker requires a pool', () => {
  assert.throws(() => new RetentionWorker({}), /requires a pool/);
});

test('RetentionWorker.runOnce deletes expired invoices and inactive profiles, and reports counts', async () => {
  const pool = fakePool({
    invoices: { rowCount: 2, rows: [{ id: 1 }, { id: 2 }] },
    profiles: { rowCount: 1, rows: [{ bot_id: 'afromarket', whatsapp_id: '+491701234567' }] }
  });
  const worker = new RetentionWorker({ pool, logger: silentLogger() });

  const result = await worker.runOnce();

  assert.equal(pool.calls.length, 2);
  assert.match(pool.calls[0], /DELETE FROM invoice_record WHERE retain_until < now\(\)/);
  assert.match(pool.calls[1], /DELETE FROM customer_profile WHERE last_active_at < now\(\) - interval '3 years'/);
  assert.deepEqual(result, { invoicesPurged: 2, profilesPurged: 1 });
});

test('RetentionWorker.runOnce is a no-op report when nothing is due for purging', async () => {
  const pool = fakePool({ invoices: { rowCount: 0, rows: [] }, profiles: { rowCount: 0, rows: [] } });
  const worker = new RetentionWorker({ pool, logger: silentLogger() });

  const result = await worker.runOnce();

  assert.deepEqual(result, { invoicesPurged: 0, profilesPurged: 0 });
});

test('RetentionWorker.start runs one sweep immediately rather than waiting a full interval', async () => {
  const pool = fakePool({ invoices: { rowCount: 0, rows: [] }, profiles: { rowCount: 0, rows: [] } });
  const worker = new RetentionWorker({ pool, intervalMs: 24 * 60 * 60 * 1000, logger: silentLogger() });

  worker.start();
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(pool.calls.length, 2, 'expected one immediate sweep (2 queries) on start()');
  } finally {
    worker.stop();
  }
});
