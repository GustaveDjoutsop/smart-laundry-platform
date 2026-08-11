const test = require('node:test');
const assert = require('node:assert/strict');

const { CustomerIdentityLinkStore } = require('../src/core/customers/customerIdentityLinkStore');

function fakePool(queryImpl) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return queryImpl ? queryImpl(sql, params) : { rows: [{ customer_id: params[1] }] };
    }
  };
}

test('CustomerIdentityLinkStore.findByIdentifier returns null when identifierType or identifierValue is missing', async () => {
  const store = new CustomerIdentityLinkStore({ pool: fakePool() });

  assert.equal(await store.findByIdentifier({ identifierValue: 'x' }), null);
  assert.equal(await store.findByIdentifier({ identifierType: 'phone' }), null);
});

test('CustomerIdentityLinkStore.findByIdentifier returns the linked customer_id when found', async () => {
  const pool = fakePool(() => ({ rows: [{ customer_id: 'canonical-1' }] }));
  const store = new CustomerIdentityLinkStore({ pool });

  const result = await store.findByIdentifier({ identifierType: 'phone', identifierValue: '+491701234567' });

  assert.equal(result, 'canonical-1');
  assert.match(pool.calls[0].sql, /SELECT customer_id FROM customer_identity_link/);
  assert.deepEqual(pool.calls[0].params, ['phone', '+491701234567']);
});

test('CustomerIdentityLinkStore.findByIdentifier returns null when no row exists', async () => {
  const store = new CustomerIdentityLinkStore({ pool: fakePool(() => ({ rows: [] })) });

  assert.equal(await store.findByIdentifier({ identifierType: 'bsuid', identifierValue: 'user.x' }), null);
});

test('CustomerIdentityLinkStore.findIdentifiersByCustomerId returns [] without a customerId', async () => {
  const store = new CustomerIdentityLinkStore({ pool: fakePool() });

  assert.deepEqual(await store.findIdentifiersByCustomerId({}), []);
});

test('CustomerIdentityLinkStore.findIdentifiersByCustomerId returns every linked identifier row', async () => {
  const rows = [
    { identifier_type: 'phone', identifier_value: '+491701234567' },
    { identifier_type: 'bsuid', identifier_value: 'user.x' }
  ];
  const pool = fakePool(() => ({ rows }));
  const store = new CustomerIdentityLinkStore({ pool });

  const result = await store.findIdentifiersByCustomerId({ customerId: 'canonical-1' });

  assert.deepEqual(result, rows);
  assert.deepEqual(pool.calls[0].params, ['canonical-1']);
});

test('CustomerIdentityLinkStore.link requires customerId, identifierType, identifierValue, and linkMethod', async () => {
  const store = new CustomerIdentityLinkStore({ pool: fakePool() });

  await assert.rejects(
    () => store.link({ identifierType: 'phone', identifierValue: '+491701234567', linkMethod: 'meta_contact_book' }),
    /requires customerId, identifierType, identifierValue, linkMethod/
  );
});

test('CustomerIdentityLinkStore.link issues an atomic upsert-and-return, and returns the given customer_id on a fresh insert', async () => {
  const pool = fakePool();
  const store = new CustomerIdentityLinkStore({ pool });

  const result = await store.link({
    customerId: 'canonical-1',
    identifierType: 'phone',
    identifierValue: '+491701234567',
    linkMethod: 'meta_contact_book'
  });

  assert.equal(result, 'canonical-1');
  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].sql, /INSERT INTO customer_identity_link/);
  assert.match(pool.calls[0].sql, /ON CONFLICT \(identifier_type, identifier_value\)/);
  assert.match(pool.calls[0].sql, /DO UPDATE SET/);
  assert.match(pool.calls[0].sql, /RETURNING customer_id/);
  assert.equal(pool.calls[0].params[1], 'canonical-1');
  assert.equal(pool.calls[0].params[2], 'phone');
  assert.equal(pool.calls[0].params[3], '+491701234567');
  assert.equal(pool.calls[0].params[4], 'meta_contact_book');
});

test('CustomerIdentityLinkStore.link returns the already-persisted customer_id on a conflict, not the one it was called with', async () => {
  // Simulates RETURNING surfacing the row a concurrent caller already won -
  // see IdentityResolver's race-safety note.
  const pool = fakePool(() => ({ rows: [{ customer_id: 'winner-from-concurrent-caller' }] }));
  const store = new CustomerIdentityLinkStore({ pool });

  const result = await store.link({
    customerId: 'my-own-candidate',
    identifierType: 'phone',
    identifierValue: '+491701234567',
    linkMethod: 'meta_contact_book'
  });

  assert.equal(result, 'winner-from-concurrent-caller');
});
