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

function undefinedColumnError(columnName) {
  const err = new Error(`column "${columnName}" of relation "customer_profile" does not exist`);
  err.code = '42703';
  return err;
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
    email: 'jane@example.com',
    customerId: 'canonical-1'
  });

  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].sql, /INSERT INTO customer_profile/);
  assert.match(pool.calls[0].sql, /ON CONFLICT/);
  assert.match(pool.calls[0].sql, /email = COALESCE\(EXCLUDED\.email, customer_profile\.email\)/);
  assert.match(pool.calls[0].sql, /customer_id = COALESCE\(EXCLUDED\.customer_id, customer_profile\.customer_id\)/);
  assert.deepEqual(pool.calls[0].params, [
    'afromarket',
    '+491701234567',
    'Jane Doe',
    '12 Main St',
    'jane@example.com',
    'canonical-1'
  ]);
});

test('CustomerProfileStore.upsert defaults email and customerId to null when not given, without breaking existing callers', async () => {
  const pool = fakePool();
  const store = new CustomerProfileStore({ pool });

  await store.upsert({ botId: 'afromarket', whatsappId: '+491701234567', name: 'Jane Doe', deliveryAddress: '12 Main St' });

  assert.deepEqual(pool.calls[0].params, ['afromarket', '+491701234567', 'Jane Doe', '12 Main St', null, null]);
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

test('CustomerProfileStore.upsert rethrows an undefined_column "email" error with a pointer to the migration', async () => {
  // Flagged in Copilot review: unconditionally reading/writing the email
  // column fails with a generic Postgres error on any environment where
  // migrations/003_add_customer_profile_email.sql hasn't been applied yet -
  // this makes that failure mode point straight at the fix instead of
  // leaving an operator to guess.
  const pool = fakePool(() => {
    throw undefinedColumnError('email');
  });
  const store = new CustomerProfileStore({ pool });

  await assert.rejects(
    () => store.upsert({ botId: 'afromarket', whatsappId: '+491701234567', name: 'Jane Doe' }),
    /migrations\/003_add_customer_profile_email\.sql/
  );
});

test('CustomerProfileStore.get rethrows an undefined_column "email" error with a pointer to the migration', async () => {
  const pool = fakePool(() => {
    throw undefinedColumnError('email');
  });
  const store = new CustomerProfileStore({ pool });

  await assert.rejects(
    () => store.get({ botId: 'afromarket', whatsappId: '+491701234567' }),
    /migrations\/003_add_customer_profile_email\.sql/
  );
});

test('CustomerProfileStore.upsert rethrows an undefined_column "customer_id" error with a pointer to migration 004', async () => {
  const pool = fakePool(() => {
    throw undefinedColumnError('customer_id');
  });
  const store = new CustomerProfileStore({ pool });

  await assert.rejects(
    () => store.upsert({ botId: 'afromarket', whatsappId: '+491701234567', name: 'Jane Doe' }),
    /migrations\/004_add_customer_identity_link\.sql/
  );
});

test('CustomerProfileStore.upsert passes through an unrelated database error unchanged', async () => {
  const pool = fakePool(() => {
    throw new Error('connection refused');
  });
  const store = new CustomerProfileStore({ pool });

  await assert.rejects(
    () => store.upsert({ botId: 'afromarket', whatsappId: '+491701234567', name: 'Jane Doe' }),
    (err) => err.message === 'connection refused'
  );
});

test('CustomerProfileStore.delete issues a DELETE scoped to botId and whatsappId', async () => {
  const pool = fakePool();
  const store = new CustomerProfileStore({ pool });

  await store.delete({ botId: 'afromarket', whatsappId: '+491701234567' });

  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].sql, /DELETE FROM customer_profile WHERE bot_id = \$1 AND whatsapp_id = \$2/);
  assert.deepEqual(pool.calls[0].params, ['afromarket', '+491701234567']);
});
