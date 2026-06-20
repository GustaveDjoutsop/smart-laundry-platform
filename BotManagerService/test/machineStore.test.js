const test = require('node:test');
const assert = require('node:assert/strict');

const { MachineStore } = require('../src/core/machines/machineStore');
const { MachineStatus } = require('../src/core/machines/machineTypes');

test('MachineStore upsert + get works', async () => {
  const machineStore = new MachineStore();
  const upsertedMachineRecord = await machineStore.upsertMachine({
    botId: 'laundry',
    machineId: 'W1',
    type: 'WASHER',
    name: 'Washer 1',
    status: MachineStatus.AVAILABLE
  });

  assert.equal(upsertedMachineRecord.machineId, 'W1');

  const loadedMachineRecord = await machineStore.getMachine({ botId: 'laundry', machineId: 'W1' });
  assert.equal(loadedMachineRecord.status, MachineStatus.AVAILABLE);
});
