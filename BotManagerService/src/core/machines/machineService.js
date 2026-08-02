const { MachineStore } = require('./machineStore');
const { MachineStatus } = require('./machineTypes');
const { logger } = require('../../utils/logger');
const { redisManager } = require('../redisManager');

function getTopicPrefix(botConfig) {
  return (
    (botConfig && botConfig.mqtt && botConfig.mqtt.topicPrefix) ||
    process.env.MQTT_TOPIC_PREFIX ||
    (botConfig && botConfig.botId) ||
    'laundry'
  );
}

function parseJson(payload) {
  try {
    return JSON.parse(payload.toString('utf8'));
  } catch (_err) {
    return null;
  }
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractMachineId(prefix, topic) {
  // {prefix}/machine-{id}/status
  const re = new RegExp(`^${escapeRegExp(prefix)}/machine-(.+)/(status|heartbeat)$`);
  const match = re.exec(topic);
  return match ? match[1] : null;
}

class MachineService {
  constructor({ botRegistry, mqttManager, paymentEvents } = {}) {
    this.botRegistry = botRegistry;
    this.mqttManager = mqttManager;
    this.paymentEvents = paymentEvents;

    this.store = new MachineStore();

    this._onMqttMessage = this._onMqttMessage.bind(this);
    this._onPaymentCompleted = this._onPaymentCompleted.bind(this);
  }

  async init() {
    if (this.mqttManager) {
      await this.mqttManager.init();
      this.mqttManager.on('message', this._onMqttMessage);

      // Subscribe per bot topic prefix
      for (const botId of this._registeredBotIds()) {
        const bot = this.botRegistry.getBotByName(botId);
        const prefix = getTopicPrefix(bot && bot.config);
        // eslint-disable-next-line no-await-in-loop
        await this.mqttManager.subscribe(`${prefix}/machine-+/status`);
        // eslint-disable-next-line no-await-in-loop
        await this.mqttManager.subscribe(`${prefix}/machine-+/heartbeat`);
      }
    }

    if (this.paymentEvents && this.paymentEvents.on) {
      this.paymentEvents.on('payment.completed', this._onPaymentCompleted);
    }

    // Seed machines from bot configs
    for (const botId of this._registeredBotIds()) {
      const bot = this.botRegistry.getBotByName(botId);
      // eslint-disable-next-line no-await-in-loop
      await this._seedMachines(bot && bot.config);
    }
  }

  _registeredBotIds() {
    // BotRegistry keeps a Map internally; expose bot IDs via known config files.
    // We can derive by iterating registered bots.
    if (!this.botRegistry || !this.botRegistry.bots) return ['laundry'];
    return Array.from(this.botRegistry.bots.keys());
  }

  async _seedMachines(botConfig) {
    const botId = botConfig && botConfig.botId;
    if (!botId) return;

    const machines = Array.isArray(botConfig.machines) ? botConfig.machines : [];
    for (const machineConfig of machines) {
      if (!machineConfig || !machineConfig.id) continue;
      // eslint-disable-next-line no-await-in-loop
      const existingMachineRecord = await this.store.getMachine({ botId, machineId: machineConfig.id });
      if (existingMachineRecord) continue;
      // eslint-disable-next-line no-await-in-loop
      await this.store.upsertMachine({
        botId,
        machineId: machineConfig.id,
        type: machineConfig.type,
        name: machineConfig.name,
        status: MachineStatus.AVAILABLE
      });
    }
  }

  async _onMqttMessage(topic, payload) {
    const payloadAsUtf8 = payload ? payload.toString('utf8') : '';
    const parsedPayload = parseJson(payload);

    // Determine which bot prefix matched
    for (const botId of this._registeredBotIds()) {
      const bot = this.botRegistry.getBotByName(botId);
      const prefix = getTopicPrefix(bot && bot.config);
      const machineId = extractMachineId(prefix, topic);
      if (!machineId) continue;

      const messageKind = topic.endsWith('/heartbeat') ? 'heartbeat' : 'status';

      if (messageKind === 'heartbeat') {
        await this.store.upsertMachine({
          botId,
          machineId,
          lastHeartbeatAt: new Date().toISOString()
        });
        return;
      }

      // status
      const machineStatus = parsedPayload && parsedPayload.status ? String(parsedPayload.status).toUpperCase() : null;
      const remainingSeconds =
        parsedPayload && (parsedPayload.remainingSeconds !== undefined || parsedPayload.remaining_seconds !== undefined)
          ? parsedPayload.remainingSeconds !== undefined
            ? parsedPayload.remainingSeconds
            : parsedPayload.remaining_seconds
          : undefined;
      await this.store.upsertMachine({
        botId,
        machineId,
        status: machineStatus || undefined,
        program: parsedPayload && parsedPayload.program ? parsedPayload.program : undefined,
        remainingSeconds,
        currentUser: parsedPayload && parsedPayload.currentUser ? parsedPayload.currentUser : undefined,
        updatedAt: new Date().toISOString()
      });

      logger.info('Machine status update received', { topic, payload: parsedPayload || payloadAsUtf8 });
      return;
    }
  }

  async startMachine({ botId, machineId, program, transactionId } = {}) {
    const bot = this.botRegistry.getBotByName(botId);
    const prefix = getTopicPrefix(bot && bot.config);

    const machine = await this.store.getMachine({ botId, machineId });
    if (machine && machine.status && machine.status !== MachineStatus.AVAILABLE) {
      logger.warn('Machine not AVAILABLE; refusing to start', { botId, machineId, status: machine.status });
      return false;
    }

    const topic = `${prefix}/machine-${machineId}/command`;
    const payload = JSON.stringify({ command: 'START', machineId, program, transactionId });

    if (!this.mqttManager) return false;
    const ok = await this.mqttManager.publish(topic, payload);
    if (ok) {
      await this.store.upsertMachine({
        botId,
        machineId,
        status: MachineStatus.IN_USE,
        program: program || null,
        updatedAt: new Date().toISOString()
      });
    }
    return ok;
  }

  async stopMachine({ botId, machineId, transactionId } = {}) {
    const bot = this.botRegistry.getBotByName(botId);
    const prefix = getTopicPrefix(bot && bot.config);
    const topic = `${prefix}/machine-${machineId}/command`;
    const payload = JSON.stringify({ command: 'STOP', machineId, transactionId });

    if (!this.mqttManager) return false;
    return this.mqttManager.publish(topic, payload);
  }

  async requestStatus({ botId, machineId } = {}) {
    const bot = this.botRegistry.getBotByName(botId);
    const prefix = getTopicPrefix(bot && bot.config);
    const topic = `${prefix}/machine-${machineId}/command`;
    const payload = JSON.stringify({ command: 'STATUS', machineId });

    if (!this.mqttManager) return false;
    return this.mqttManager.publish(topic, payload);
  }

  async _onPaymentCompleted(paymentCompletedEvent) {
    if (!paymentCompletedEvent || !paymentCompletedEvent.botId || !paymentCompletedEvent.transactionId) return;

    const payment = paymentCompletedEvent.payment || null;
    const paymentMetadata = payment && payment.metadata ? payment.metadata : null;
    const machineId = paymentMetadata && paymentMetadata.machineId ? String(paymentMetadata.machineId) : null;
    const program = paymentMetadata && paymentMetadata.program ? paymentMetadata.program : null;

    if (!machineId) {
      logger.info('Payment completed but no machineId in payment metadata', {
        botId: paymentCompletedEvent.botId,
        transactionId: paymentCompletedEvent.transactionId
      });
      return;
    }

    const lockKey = `machineStart:${paymentCompletedEvent.botId}:${paymentCompletedEvent.transactionId}`;
    const hasStartLock = await redisManager.setnx(lockKey, '1', 10 * 60);
    if (!hasStartLock) return;

    const didStartMachine = await this.startMachine({
      botId: paymentCompletedEvent.botId,
      machineId,
      program,
      transactionId: paymentCompletedEvent.transactionId
    });

    if (didStartMachine && payment && payment.customerPhone) {
      await this.store.upsertMachine({
        botId: paymentCompletedEvent.botId,
        machineId,
        currentUser: payment.customerPhone,
        program: program || null,
        updatedAt: new Date().toISOString()
      });
    }
  }
}

module.exports = { MachineService, getTopicPrefix };
