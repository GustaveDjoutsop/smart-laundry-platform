const test = require('node:test');
const assert = require('node:assert/strict');

const { CustomerProfileStore } = require('../src/core/customers/customerProfileStore');

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

test('CustomerProfileStore.upsert requires botId and whatsappId', async () => {
  const store = new CustomerProfileStore({ pool: fakePool() });

  await assert.rejects(() => store.upsert({ whatsappId: '+491701234567' }), /requires botId and whatsappId/);
  await assert.rejects(() => store.upsert({ botId: 'afromarket' }), /requires botId and whatsappId/);
});

test('CustomerProfileStore.upsert issues an INSERT ... ON CONFLICT with the given fields', async () => {
  const pool = fakePool();
  const store = new CustomerProfileStore({ pool });

  await store.upsert({
    botId: 'afromarket',
    whatsappId: '+491701234567',
    name: 'Jane Doe',
    deliveryAddress: '12 Main St',
    email: 'jane@example.com'
  });

  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].sql, /INSERT INTO customer_profile/);
  assert.match(pool.calls[0].sql, /ON CONFLICT/);
  assert.match(pool.calls[0].sql, /email = COALESCE\(EXCLUDED\.email, customer_profile\.email\)/);
  assert.deepEqual(pool.calls[0].params, ['afromarket', '+491701234567', 'Jane Doe', '12 Main St', 'jane@example.com']);
});

test('CustomerProfileStore.upsert defaults email to null when not given, without breaking existing callers', async () => {
  const pool = fakePool();
  const store = new CustomerProfileStore({ pool });

  await store.upsert({ botId: 'afromarket', whatsappId: '+491701234567', name: 'Jane Doe', deliveryAddress: '12 Main St' });

  assert.deepEqual(pool.calls[0].params, ['afromarket', '+491701234567', 'Jane Doe', '12 Main St', null]);
});

test('CustomerProfileStore.get returns null when no row exists', async () => {
  const store = new CustomerProfileStore({ pool: fakePool(() => ({ rows: [] })) });

  const result = await store.get({ botId: 'afromarket', whatsappId: '+491701234567' });

  assert.equal(result, null);
});

test('CustomerProfileStore.get returns the row when one exists', async () => {
  const row = { bot_id: 'afromarket', whatsapp_id: '+491701234567', name: 'Jane Doe', email: 'jane@example.com' };
  const pool = fakePool(() => ({ rows: [row] }));
  const store = new CustomerProfileStore({ pool });

  const result = await store.get({ botId: 'afromarket', whatsappId: '+491701234567' });

  assert.deepEqual(result, row);
  assert.match(pool.calls[0].sql, /SELECT bot_id, whatsapp_id, name, delivery_address, email,/);
});

test('CustomerProfileStore.delete issues a DELETE scoped to botId and whatsappId', async () => {
  const pool = fakePool();
  const store = new CustomerProfileStore({ pool });

  await store.delete({ botId: 'afromarket', whatsappId: '+491701234567' });

  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].sql, /DELETE FROM customer_profile WHERE bot_id = \$1 AND whatsapp_id = \$2/);
  assert.deepEqual(pool.calls[0].params, ['afromarket', '+491701234567']);
});
