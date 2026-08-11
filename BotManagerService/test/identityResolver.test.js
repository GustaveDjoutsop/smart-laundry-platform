const test = require('node:test');
const assert = require('node:assert/strict');

const { IdentityResolver } = require('../src/core/customers/identityResolver');

function fakeCustomerIdentityLinkStore({ existing = {} } = {}) {
  // existing: { 'type:value': customerId }
  const links = new Map(Object.entries(existing));
  const linkCalls = [];

  return {
    linkCalls,
    links,
    findByIdentifier: async ({ identifierType, identifierValue }) => links.get(`${identifierType}:${identifierValue}`) || null,
    // Mirrors the real store's atomic upsert-and-return: an identifier
    // already present keeps its existing customer_id (the given one is
    // discarded, same as a real ON CONFLICT ... RETURNING), otherwise it's
    // set to the given customer_id. Always returns the value now on record.
    link: async ({ customerId, identifierType, identifierValue, linkMethod }) => {
      linkCalls.push({ customerId, identifierType, identifierValue, linkMethod });
      const key = `${identifierType}:${identifierValue}`;
      if (!links.has(key)) links.set(key, customerId);
      return links.get(key);
    }
  };
}

test('IdentityResolver requires a customerIdentityLinkStore', () => {
  assert.throws(() => new IdentityResolver({}), /requires customerIdentityLinkStore/);
});

test('IdentityResolver.resolve requires a primary identifier', async () => {
  const resolver = new IdentityResolver({ customerIdentityLinkStore: fakeCustomerIdentityLinkStore() });

  await assert.rejects(() => resolver.resolve({}), /requires a primary/);
});

test('IdentityResolver.resolve creates a new canonical customer_id and links a lone primary identifier', async () => {
  const customerIdentityLinkStore = fakeCustomerIdentityLinkStore();
  const resolver = new IdentityResolver({ customerIdentityLinkStore });

  const customerId = await resolver.resolve({ primary: { type: 'phone', value: '+491701234567' } });

  assert.ok(customerId);
  assert.deepEqual(customerIdentityLinkStore.linkCalls, [
    { customerId, identifierType: 'phone', identifierValue: '+491701234567', linkMethod: 'meta_contact_book' }
  ]);
});

test('IdentityResolver.resolve links both identifiers under the same customer_id when paired', async () => {
  const customerIdentityLinkStore = fakeCustomerIdentityLinkStore();
  const resolver = new IdentityResolver({ customerIdentityLinkStore });

  const customerId = await resolver.resolve({
    primary: { type: 'phone', value: '+491701234567' },
    pairedWith: { type: 'bsuid', value: 'user.paired-customer' }
  });

  assert.equal(customerIdentityLinkStore.links.get('phone:+491701234567'), customerId);
  assert.equal(customerIdentityLinkStore.links.get('bsuid:user.paired-customer'), customerId);
  assert.equal(customerIdentityLinkStore.linkCalls.length, 2);
});

test('IdentityResolver.resolve reuses the existing canonical customer_id for an already-linked primary', async () => {
  const customerIdentityLinkStore = fakeCustomerIdentityLinkStore({ existing: { 'phone:+491701234567': 'canonical-1' } });
  const resolver = new IdentityResolver({ customerIdentityLinkStore });

  const customerId = await resolver.resolve({ primary: { type: 'phone', value: '+491701234567' } });

  // link() is still called (it's now an atomic upsert, not a conditional
  // insert) but is a no-op against the already-linked row - the returned
  // customer_id is the existing one, never the locally generated candidate.
  assert.equal(customerId, 'canonical-1');
  assert.equal(customerIdentityLinkStore.links.get('phone:+491701234567'), 'canonical-1');
});

test('IdentityResolver.resolve links a new BSUID under an existing phone customer_id when paired', async () => {
  const customerIdentityLinkStore = fakeCustomerIdentityLinkStore({ existing: { 'phone:+491701234567': 'canonical-1' } });
  const resolver = new IdentityResolver({ customerIdentityLinkStore });

  const customerId = await resolver.resolve({
    primary: { type: 'phone', value: '+491701234567' },
    pairedWith: { type: 'bsuid', value: 'user.new-bsuid' }
  });

  assert.equal(customerId, 'canonical-1');
  assert.equal(customerIdentityLinkStore.links.get('bsuid:user.new-bsuid'), 'canonical-1');
});

test('IdentityResolver.resolve does not reassign a pairedWith identifier already linked to a different customer_id', async () => {
  const customerIdentityLinkStore = fakeCustomerIdentityLinkStore({
    existing: { 'bsuid:user.already-elsewhere': 'canonical-other' }
  });
  const resolver = new IdentityResolver({ customerIdentityLinkStore });

  const customerId = await resolver.resolve({
    primary: { type: 'phone', value: '+491701234567' },
    pairedWith: { type: 'bsuid', value: 'user.already-elsewhere' }
  });

  // Deliberate: the primary identifier (previously unlinked) attaches to
  // whichever customer_id the paired identifier already belongs to;
  // pairedWith's existing link itself is left untouched rather than moved
  // (its link() call is a harmless no-op against the already-current row).
  assert.equal(customerId, 'canonical-other');
  assert.equal(customerIdentityLinkStore.links.get('bsuid:user.already-elsewhere'), 'canonical-other');
  assert.equal(customerIdentityLinkStore.links.get('phone:+491701234567'), 'canonical-other');
  assert.equal(customerIdentityLinkStore.linkCalls.length, 2);
});

test('IdentityResolver.resolve converges on one customer_id when two concurrent calls race for the same new customer', async () => {
  // Regression test for the check-then-insert race flagged in review: two
  // overlapping resolve() calls for the same brand-new primary identifier
  // (e.g. WhatsApp's at-least-once webhook redelivery) must not each trust
  // their own locally generated UUID - they must both end up agreeing on
  // whichever one actually won the row.
  const customerIdentityLinkStore = fakeCustomerIdentityLinkStore();
  const resolver = new IdentityResolver({ customerIdentityLinkStore });
  const primary = { type: 'phone', value: '+491701234567' };

  const [customerIdA, customerIdB] = await Promise.all([resolver.resolve({ primary }), resolver.resolve({ primary })]);

  assert.equal(customerIdA, customerIdB);
  assert.equal(customerIdentityLinkStore.links.get('phone:+491701234567'), customerIdA);
});
