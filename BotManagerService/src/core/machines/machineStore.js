const { redisManager } = require('../redisManager');
const { MachineStatus } = require('./machineTypes');

function machineKey({ botId, machineId }) {
  return `machine:${botId}:${machineId}`;
}

class MachineStore {
  async getMachine({ botId, machineId }) {
    const serializedRecord = await redisManager.get(machineKey({ botId, machineId }));
    return serializedRecord ? JSON.parse(serializedRecord) : null;
  }

  async upsertMachine({ botId, machineId, type, name, status, currentUser, program, remainingSeconds, lastHeartbeatAt, updatedAt } = {}) {
    if (!botId || !machineId) throw new Error('MachineStore requires botId and machineId');

    const existingRecord = (await this.getMachine({ botId, machineId })) || {};

    const record = {
      botId,
      machineId,
      type: type || existingRecord.type || null,
      name: name || existingRecord.name || null,
      status: status || existingRecord.status || MachineStatus.AVAILABLE,
      currentUser: currentUser !== undefined ? currentUser : existingRecord.currentUser || null,
      program: program !== undefined ? program : existingRecord.program || null,
      remainingSeconds:
        remainingSeconds !== undefined
          ? remainingSeconds
          : existingRecord.remainingSeconds !== undefined
            ? existingRecord.remainingSeconds
            : null,
      lastHeartbeatAt: lastHeartbeatAt || existingRecord.lastHeartbeatAt || null,
      updatedAt: updatedAt || new Date().toISOString()
    };

    await redisManager.set(machineKey({ botId, machineId }), JSON.stringify(record));
    return record;
  }

  async listMachines({ botId, machineIds } = {}) {
    const ids = Array.isArray(machineIds) ? machineIds : [];
    const results = [];

    for (const machineId of ids) {
      // eslint-disable-next-line no-await-in-loop
      const machineRecord = await this.getMachine({ botId, machineId });
      if (machineRecord) results.push(machineRecord);
    }

    return results;
  }
}

module.exports = { MachineStore, machineKey };
