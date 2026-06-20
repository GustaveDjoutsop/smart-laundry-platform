const express = require('express');

const { botRegistry } = require('../core/botRegistry');
const { MachineStore } = require('../core/machines/machineStore');

function machinesRouter() {
  const router = express.Router();
  const store = new MachineStore();

  router.get('/:botId', async (req, res, next) => {
    try {
      const { botId } = req.params;
      const bot = botRegistry.getBotByName(botId);
      if (!bot) return res.status(404).json({ ok: false, error: 'Unknown bot' });

      const machineIds = Array.isArray(bot.config.machines) ? bot.config.machines.map((m) => m.id) : [];
      const machines = await store.listMachines({ botId, machineIds });
      return res.json({ ok: true, machines });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:botId/:machineId', async (req, res, next) => {
    try {
      const { botId, machineId } = req.params;
      const machine = await store.getMachine({ botId, machineId });
      return res.json({ ok: true, machine });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { machinesRouter };
