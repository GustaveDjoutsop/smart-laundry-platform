const test = require('node:test');
const assert = require('node:assert/strict');

const { DeletionRequestLogStore } = require('../src/core/customers/deletionRequestLogStore');

function fakePool(queryImpl) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return queryImpl ? queryImpl(sql, params) : { rows: [] };
    }
  };
}

test('DeletionRequestLogStore.logRequested inserts a pending row and returns its id', async () => {
  const pool = fakePool(() => ({ rows: [{ id: 7 }] }));
  const store = new DeletionRequestLogStore({ pool });

  const id = await store.logRequested({ botId: 'afromarket', whatsappId: '+491701234567' });

  assert.equal(id, 7);
  assert.match(pool.calls[0].sql, /INSERT INTO deletion_request_log/);
  assert.match(pool.calls[0].sql, /'pending'/);
  assert.deepEqual(pool.calls[0].params, ['afromarket', '+491701234567']);
});

test('DeletionRequestLogStore.markCompleted updates status and completed_at for the given id', async () => {
  const pool = fakePool();
  const store = new DeletionRequestLogStore({ pool });

  await store.markCompleted(7);

  assert.match(pool.calls[0].sql, /UPDATE deletion_request_log SET status = 'completed'/);
  assert.deepEqual(pool.calls[0].params, [7]);
});

test('DeletionRequestLogStore.markFailed updates status and completed_at for the given id', async () => {
  const pool = fakePool();
  const store = new DeletionRequestLogStore({ pool });

  await store.markFailed(7);

  assert.match(pool.calls[0].sql, /UPDATE deletion_request_log SET status = 'failed'/);
  assert.deepEqual(pool.calls[0].params, [7]);
});
