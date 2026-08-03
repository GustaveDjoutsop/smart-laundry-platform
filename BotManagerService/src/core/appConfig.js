const path = require('path');

const { loadEnvironmentConfig } = require('./configLoader');

let cached;

function boolFromEnv(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return String(value).toLowerCase() === 'true' || String(value) === '1';
}

function getAppConfig() {
  if (cached) return cached;

  const envName = process.env.CONFIG_ENV || process.env.NODE_ENV || 'dev';
  const configDir = path.join(process.cwd(), 'config');

  const envConfig = loadEnvironmentConfig({ configDir, envName });

  const serverPort = Number(process.env.PORT || envConfig?.server?.port || 3000);
  const redisUrl = process.env.REDIS_URL || process.env.REDISCLOUD_URL || null;
  const redisTtlSeconds = Number(envConfig?.redis?.ttl_seconds || 1800);
  const databaseUrl = process.env.DATABASE_URL || null;

  const verifySignature = boolFromEnv(process.env.WHATSAPP_VERIFY_SIGNATURE, false);
  const whatsappAppSecret = process.env.WHATSAPP_APP_SECRET || null;

  if (verifySignature && !whatsappAppSecret) {
    throw new Error('WHATSAPP_VERIFY_SIGNATURE=true requires WHATSAPP_APP_SECRET');
  }

  cached = {
    envName,
    server: {
      port: serverPort
    },
    redis: {
      url: redisUrl,
      ttlSeconds: redisTtlSeconds
    },
    database: {
      url: databaseUrl
    },
    whatsapp: {
      verifySignature,
      appSecret: whatsappAppSecret
    },
    queue: {
      maxSize: Number(process.env.QUEUE_MAX_SIZE || 500)
    }
  };

  return cached;
}

module.exports = { getAppConfig };
