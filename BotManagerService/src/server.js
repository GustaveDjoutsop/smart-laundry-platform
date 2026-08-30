require('dotenv').config();

const { createApp } = require('./app');
const { getAppConfig } = require('./core/appConfig');
const { botRegistry } = require('./core/botRegistry');
const { queueManager } = require('./core/messageQueue');
const { redisManager } = require('./core/redisManager');
const { getPaymentService } = require('./core/payments/paymentService');
const { PaymentStatusWorker } = require('./core/payments/paymentStatusWorker');
const { paymentEvents } = require('./core/payments/paymentEvents');
const { MqttManager } = require('./core/mqtt/mqttManager');
const { MachineService } = require('./core/machines/machineService');
const { RetentionWorker } = require('./core/retention/retentionWorker');
const { getPool } = require('./core/db/pgClient');
const { logger } = require('./utils/logger');

async function bootstrap() {
  const config = getAppConfig();
  await redisManager.init();

  const { gateway, store, events } = getPaymentService();
  const paymentWorker = new PaymentStatusWorker({
    gateway,
    store,
    events,
    botRegistry,
    logger,
    pollIntervalMs: Number(process.env.PAYMENT_POLL_INTERVAL_MS || 10_000),
    timeoutMs: Number(process.env.PAYMENT_TIMEOUT_MS || 10 * 60 * 1000)
  });
  paymentWorker.start();

  const mqttManager = new MqttManager({
    url: process.env.MQTT_URL || null,
    username: process.env.MQTT_USERNAME || null,
    password: process.env.MQTT_PASSWORD || null
  });

  const machineService = new MachineService({
    botRegistry,
    mqttManager,
    paymentEvents
  });

  await machineService.init();

  let retentionWorker = null;
  if (config.database.url) {
    retentionWorker = new RetentionWorker({ pool: getPool() });
    retentionWorker.start();
  } else {
    logger.warn('DATABASE_URL not set: retention worker disabled, invoice/customer-profile stores unavailable');
  }

  queueManager.setProcessor(async (job) => {
    const bot = botRegistry.getBotByPhoneId(job.phoneNumberId);
    if (!bot) return;

    const botId = bot.config && bot.config.botId ? bot.config.botId : 'unknown';
    const messageId = job.messageId || (job.message && job.message.id ? job.message.id : null);
    if (messageId) {
      const lockKey = `lock:${botId}:${job.from}:${messageId}`;
      const acquired = await redisManager.setnx(lockKey, '1', 60);
      if (!acquired) return;
    }

    await bot.handleMessage(job);
  });

  const app = createApp({ redisManager, mqttManager });
  const server = app.listen(config.server.port, () => {
    logger.info(`BotManagerService listening on port ${config.server.port}`);
  });

  // Ordered so in-flight work has the best chance to finish cleanly: stop
  // taking new HTTP requests and polling/background work first, then drop
  // the connections those workers were using. A stuck client holding a
  // keep-alive connection open must not hang the process forever on
  // SIGTERM/SIGINT - Railway (and most orchestrators) send SIGKILL after a
  // fixed grace period regardless, so force-exiting slightly ahead of that
  // is strictly better than being killed mid-cleanup.
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received, shutting down gracefully`);

    const forceExitTimer = setTimeout(() => {
      logger.warn('Graceful shutdown timed out after 10s, forcing exit');
      process.exit(1);
    }, 10_000);
    forceExitTimer.unref();

    server.close(async () => {
      paymentWorker.stop();
      if (retentionWorker) retentionWorker.stop();

      await mqttManager.disconnect();
      await redisManager.close();
      if (config.database.url) {
        await getPool()
          .end()
          .catch((err) => logger.warn('Postgres pool close failed', err && err.message ? err.message : String(err)));
      }

      clearTimeout(forceExitTimer);
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('Failed to start BotManagerService', err && err.message ? err.message : String(err));
  process.exitCode = 1;
});
