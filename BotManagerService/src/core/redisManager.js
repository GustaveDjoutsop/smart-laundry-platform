const { logger } = require('../utils/logger');
const { getAppConfig } = require('./appConfig');

let createClient;
try {
  // Optional dependency at runtime; will be installed as part of wiring Redis.
  // eslint-disable-next-line global-require
  ({ createClient } = require('redis'));
} catch (_err) {
  createClient = null;
}

// setTimeout's delay is a 32-bit signed int internally; anything past ~24.8
// days silently overflows to a 1ms timeout instead of throwing, which would
// expire an in-memory fallback cache entry almost immediately for any caller
// using a longer TTL (observed with a 25-day media-id cache). Real Redis's
// EX/setEx isn't affected - this only clamps the in-memory fallback's timer.
const MAX_SETTIMEOUT_DELAY_MS = 2 ** 31 - 1;

class RedisManager {
  constructor() {
    this.connected = false;
    this.fallbackCache = new Map();
    // Separate from fallbackCache: list values shouldn't be conflated with
    // the scalar get/setex/setnx cache above.
    this.fallbackLists = new Map();

    this.client = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    this.initialized = true;

    const config = getAppConfig();
    if (!config.redis.url) {
      logger.warn('REDIS_URL not set: using in-memory fallback');
      return;
    }

    if (!createClient) {
      logger.warn('Redis client dependency not available: using in-memory fallback');
      return;
    }

    try {
      this.client = createClient({ url: config.redis.url });
      this.client.on('error', (err) => {
        this.connected = false;
        logger.warn('Redis error: falling back to in-memory cache', err && err.message ? err.message : String(err));
      });
      await this.client.connect();
      this.connected = true;
      logger.info('Redis connected');
    } catch (err) {
      this.connected = false;
      this.client = null;
      logger.warn('Redis unavailable: using in-memory fallback', err && err.message ? err.message : String(err));
    }
  }

  async get(key) {
    if (this.connected && this.client) {
      try {
        return await this.client.get(key);
      } catch (err) {
        logger.warn('Redis get failed: using fallback', err && err.message ? err.message : String(err));
        return this.fallbackCache.get(key);
      }
    }

    return this.fallbackCache.get(key);
  }

  async setex(key, ttlSeconds, value) {
    if (this.connected && this.client) {
      try {
        await this.client.setEx(key, Math.max(1, Number(ttlSeconds) || 1), value);
        return;
      } catch (err) {
        logger.warn('Redis setex failed: using fallback', err && err.message ? err.message : String(err));
      }
    }

    this.fallbackCache.set(key, value);
    const delayMs = Math.min(Math.max(1, Number(ttlSeconds) || 1) * 1000, MAX_SETTIMEOUT_DELAY_MS);
    setTimeout(() => {
      this.fallbackCache.delete(key);
    }, delayMs).unref?.();
  }

  async setnx(key, value, ttlSeconds) {
    if (this.connected && this.client) {
      try {
        const result = await this.client.set(key, value, {
          NX: true,
          EX: Math.max(1, Number(ttlSeconds) || 1)
        });
        return result === 'OK';
      } catch (err) {
        logger.warn('Redis setnx failed: using fallback', err && err.message ? err.message : String(err));
      }
    }

    if (this.fallbackCache.has(key)) return false;
    this.fallbackCache.set(key, value);
    const delayMs = Math.min(Math.max(1, Number(ttlSeconds) || 1) * 1000, MAX_SETTIMEOUT_DELAY_MS);
    setTimeout(() => {
      this.fallbackCache.delete(key);
    }, delayMs).unref?.();
    return true;
  }

  async set(key, value) {
    if (this.connected && this.client) {
      try {
        await this.client.set(key, value);
        return;
      } catch (err) {
        logger.warn('Redis set failed: using fallback', err && err.message ? err.message : String(err));
      }
    }

    this.fallbackCache.set(key, value);
  }

  async rpush(key, value) {
    if (this.connected && this.client) {
      try {
        await this.client.rPush(key, value);
        return;
      } catch (err) {
        logger.warn('Redis rpush failed: using fallback', err && err.message ? err.message : String(err));
      }
    }

    const list = this.fallbackLists.get(key) || [];
    list.push(value);
    this.fallbackLists.set(key, list);
  }

  async lrange(key, start, stop) {
    if (this.connected && this.client) {
      try {
        return await this.client.lRange(key, start, stop);
      } catch (err) {
        logger.warn('Redis lrange failed: using fallback', err && err.message ? err.message : String(err));
        return (this.fallbackLists.get(key) || []).slice(start, stop === -1 ? undefined : stop + 1);
      }
    }

    return (this.fallbackLists.get(key) || []).slice(start, stop === -1 ? undefined : stop + 1);
  }

  async expire(key, ttlSeconds) {
    if (this.connected && this.client) {
      try {
        await this.client.expire(key, Math.max(1, Number(ttlSeconds) || 1));
        return;
      } catch (err) {
        logger.warn('Redis expire failed: using fallback', err && err.message ? err.message : String(err));
      }
    }

    if (!this.fallbackLists.has(key)) return;
    const delayMs = Math.min(Math.max(1, Number(ttlSeconds) || 1) * 1000, MAX_SETTIMEOUT_DELAY_MS);
    setTimeout(() => {
      this.fallbackLists.delete(key);
    }, delayMs).unref?.();
  }
}

const redisManager = new RedisManager();

module.exports = { redisManager, RedisManager };
