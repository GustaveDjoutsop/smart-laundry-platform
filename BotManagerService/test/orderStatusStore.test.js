const test = require('node:test');
const assert = require('node:assert/strict');

const { OrderStatusStore } = require('../src/core/orders/orderStatusStore');

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

test('shouldRejectInsertWhenOrderNumberMissing', async () => {
  const pool = fakePool();
  const store = new OrderStatusStore({ pool });

  await assert.rejects(() => store.insertConfirmed({}), /requires orderNumber/);

  assert.equal(pool.calls.length, 0, 'a missing order number must not reach the database');
});

test('shouldInsertConfirmedStatusKeyedOnOrderNumber', async () => {
  const pool = fakePool();
  const store = new OrderStatusStore({ pool });

  await store.insertConfirmed({ orderNumber: 'AFROMARKET-tx1' });

  assert.equal(pool.calls.length, 1);
  const { sql, params } = pool.calls[0];
  assert.match(sql, /INSERT INTO orders/);
  assert.match(sql, /'CONFIRMED'/);
  assert.deepEqual(params, ['AFROMARKET-tx1']);
});

test('shouldNotResetStatusWhenOrderAlreadyExists', async () => {
  const pool = fakePool();
  const store = new OrderStatusStore({ pool });

  await store.insertConfirmed({ orderNumber: 'AFROMARKET-tx1' });

  // The whole reason a redelivered payment webhook can't knock an already
  // SHIPPED order back to CONFIRMED - it must be DO NOTHING, never an
  // upsert that writes status/confirmed_at again.
  assert.match(pool.calls[0].sql, /ON CONFLICT \(order_number\) DO NOTHING/);
  assert.doesNotMatch(pool.calls[0].sql, /DO UPDATE/);
});

test('shouldNameMigration005WhenOrdersTableIsMissing', async () => {
  const undefinedTable = new Error('relation "orders" does not exist');
  undefinedTable.code = '42P01';
  const store = new OrderStatusStore({
    pool: fakePool(() => {
      throw undefinedTable;
    })
  });

  // when
  const thrown = await store.insertConfirmed({ orderNumber: 'AFROMARKET-tx1' }).catch((err) => err);

  // then
  assert.match(thrown.message, /005_orders_table\.sql/);
  assert.equal(thrown.code, '42P01', 'the pg error code must survive the rewrite');
  assert.equal(thrown.cause, undefinedTable);
});

test('shouldPassThroughUnrelatedDatabaseErrorsUnchanged', async () => {
  const fkViolation = new Error('insert or update on table "orders" violates foreign key constraint');
  fkViolation.code = '23503';
  const store = new OrderStatusStore({
    pool: fakePool(() => {
      throw fkViolation;
    })
  });

  const thrown = await store.insertConfirmed({ orderNumber: 'AFROMARKET-unknown' }).catch((err) => err);

  assert.equal(thrown, fkViolation, 'only 42P01 gets a migration hint; everything else is untouched');
});

test('shouldReturnNullWhenOrderHasNoStatusRow', async () => {
  const store = new OrderStatusStore({ pool: fakePool(() => ({ rows: [] })) });

  const order = await store.get({ orderNumber: 'AFROMARKET-missing' });

  assert.equal(order, null);
});

test('shouldReturnStatusRowWhenOrderExists', async () => {
  const row = { order_number: 'AFROMARKET-tx1', status: 'SHIPPED', confirmed_at: new Date(0), shipped_at: new Date(1), delivered_at: null };
  const pool = fakePool(() => ({ rows: [row] }));
  const store = new OrderStatusStore({ pool });

  const order = await store.get({ orderNumber: 'AFROMARKET-tx1' });

  assert.deepEqual(order, row);
  assert.deepEqual(pool.calls[0].params, ['AFROMARKET-tx1']);
});
