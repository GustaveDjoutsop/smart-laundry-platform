const { getAppConfig } = require('../core/appConfig');

function healthRouter({ redisManager, mqttManager } = {}) {
  const express = require('express');
  const router = express.Router();

  router.get('/', (req, res) => {
    const config = getAppConfig();
    const redisConfigured = Boolean(config && config.redis && config.redis.url);
    const redisConnected = Boolean(redisManager && redisManager.connected);

    const mqttConfigured = Boolean(mqttManager && mqttManager.url);
    const mqttConnected = Boolean(mqttManager && mqttManager.connected);

    res.json({
      ok: true,
      service: 'BotManagerService',
      ts: new Date().toISOString(),
      dependencies: {
        redis: {
          configured: redisConfigured,
          connected: redisConfigured ? redisConnected : false
        },
        mqtt: {
          configured: mqttConfigured,
          connected: mqttConfigured ? mqttConnected : false
        }
      }
    });
  });

  return router;
}

module.exports = { healthRouter };
