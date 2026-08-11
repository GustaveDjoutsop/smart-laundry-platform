const test = require('node:test');
const assert = require('node:assert/strict');

const { DeletionRequestService } = require('../src/core/customers/deletionRequestService');
const { redisManager } = require('../src/core/redisManager');

function fakeCustomerProfileStore() {
  const deleted = [];
  return { deleted, delete: async (args) => deleted.push(args) };
}

function fakeDeletionRequestLogStore() {
  const calls = { requested: [], completed: [], failed: [] };
  return {
    calls,
    logRequested: async (args) => {
      calls.requested.push(args);
      return 42;
    },
    markCompleted: async (id) => calls.completed.push(id),
    markFailed: async (id) => calls.failed.push(id)
  };
}

test('DeletionRequestService.execute requires botId and whatsappId', async () => {
  const service = new DeletionRequestService({
    customerProfileStore: fakeCustomerProfileStore(),
    deletionRequestLogStore: fakeDeletionRequestLogStore()
  });

  await assert.rejects(() => service.execute({ whatsappId: '+491701234567' }), /requires botId and whatsappId/);
});

test('DeletionRequestService.execute logs the request, deletes the profile, clears the conv: key, and marks the log completed', async () => {
  const customerProfileStore = fakeCustomerProfileStore();
  const deletionRequestLogStore = fakeDeletionRequestLogStore();
  const service = new DeletionRequestService({ customerProfileStore, deletionRequestLogStore });

  await redisManager.set('conv:afromarket:+491701234567', JSON.stringify({ currentFlowId: 'main_menu' }));

  await service.execute({ botId: 'afromarket', whatsappId: '+491701234567' });

  assert.deepEqual(deletionRequestLogStore.calls.requested, [{ botId: 'afromarket', whatsappId: '+491701234567' }]);
  assert.deepEqual(customerProfileStore.deleted, [{ botId: 'afromarket', whatsappId: '+491701234567' }]);
  assert.equal(await redisManager.get('conv:afromarket:+491701234567'), undefined);
  assert.deepEqual(deletionRequestLogStore.calls.completed, [42]);
  assert.deepEqual(deletionRequestLogStore.calls.failed, []);
});

test('DeletionRequestService.execute marks the log failed and rethrows if the profile deletion fails', async () => {
  const customerProfileStore = {
    delete: async () => {
      throw new Error('db unreachable');
    }
  };
  const deletionRequestLogStore = fakeDeletionRequestLogStore();
  const service = new DeletionRequestService({ customerProfileStore, deletionRequestLogStore });

  await assert.rejects(
    () => service.execute({ botId: 'afromarket', whatsappId: '+491701234567' }),
    /db unreachable/
  );

  assert.deepEqual(deletionRequestLogStore.calls.failed, [42]);
  assert.deepEqual(deletionRequestLogStore.calls.completed, []);
});

// Identity-linkage coverage (ADR-008 open question #4) - see
// afromarket-identity-linkage-design.md.
function fakeCustomerIdentityLinkStore({ linkedIdentifiers = null } = {}) {
  return {
    findByIdentifier: async () => (linkedIdentifiers ? 'canonical-1' : null),
    findIdentifiersByCustomerId: async () =>
      (linkedIdentifiers || []).map((value) => ({
        identifier_type: value.startsWith('user.') ? 'bsuid' : 'phone',
        identifier_value: value
      }))
  };
}

test('DeletionRequestService.execute erases only the arriving identifier when no linkage store is configured', async () => {
  const customerProfileStore = fakeCustomerProfileStore();
  const deletionRequestLogStore = fakeDeletionRequestLogStore();
  const service = new DeletionRequestService({ customerProfileStore, deletionRequestLogStore });

  await service.execute({ botId: 'afromarket', whatsappId: '+491701234567' });

  assert.deepEqual(customerProfileStore.deleted, [{ botId: 'afromarket', whatsappId: '+491701234567' }]);
});

test('DeletionRequestService.execute erases only the arriving identifier when it has no recorded link', async () => {
  const customerProfileStore = fakeCustomerProfileStore();
  const deletionRequestLogStore = fakeDeletionRequestLogStore();
  const service = new DeletionRequestService({
    customerProfileStore,
    deletionRequestLogStore,
    customerIdentityLinkStore: fakeCustomerIdentityLinkStore({ linkedIdentifiers: null })
  });

  await service.execute({ botId: 'afromarket', whatsappId: '+491701234567' });

  assert.deepEqual(customerProfileStore.deleted, [{ botId: 'afromarket', whatsappId: '+491701234567' }]);
});

test('DeletionRequestService.execute erases every linked identifier, not just the one the request arrived on', async () => {
  const customerProfileStore = fakeCustomerProfileStore();
  const deletionRequestLogStore = fakeDeletionRequestLogStore();
  const service = new DeletionRequestService({
    customerProfileStore,
    deletionRequestLogStore,
    customerIdentityLinkStore: fakeCustomerIdentityLinkStore({
      linkedIdentifiers: ['+491701234567', 'user.same-customer-bsuid']
    })
  });

  await redisManager.set('conv:afromarket:+491701234567', JSON.stringify({ currentFlowId: 'main_menu' }));
  await redisManager.set('conv:afromarket:user.same-customer-bsuid', JSON.stringify({ currentFlowId: 'main_menu' }));

  await service.execute({ botId: 'afromarket', whatsappId: 'user.same-customer-bsuid' });

  assert.deepEqual(customerProfileStore.deleted, [
    { botId: 'afromarket', whatsappId: '+491701234567' },
    { botId: 'afromarket', whatsappId: 'user.same-customer-bsuid' }
  ]);
  assert.equal(await redisManager.get('conv:afromarket:+491701234567'), undefined);
  assert.equal(await redisManager.get('conv:afromarket:user.same-customer-bsuid'), undefined);
});
