const { redisManager } = require('../redisManager');

const DEFAULT_TTL_SECONDS = 60 * 60 * 24; // 24h

function paymentKey({ botId, transactionId }) {
  return `payment:${botId}:${transactionId}`;
}

function paymentRefKey({ botId, externalRef }) {
  return `paymentRef:${botId}:${externalRef}`;
}

class PaymentStore {
  constructor({ ttlSeconds } = {}) {
    this.ttlSeconds = typeof ttlSeconds === 'number' ? ttlSeconds : DEFAULT_TTL_SECONDS;
  }

  async upsertPayment(record) {
    const { botId, transactionId, externalRef } = record;
    if (!botId || !transactionId) throw new Error('PaymentStore requires botId and transactionId');

    const key = paymentKey({ botId, transactionId });
    await redisManager.setex(key, this.ttlSeconds, JSON.stringify(record));

    if (externalRef) {
      const refKey = paymentRefKey({ botId, externalRef });
      await redisManager.setex(refKey, this.ttlSeconds, String(transactionId));
    }
  }

  async getPayment({ botId, transactionId }) {
    const key = paymentKey({ botId, transactionId });
    const raw = await redisManager.get(key);
    return raw ? JSON.parse(raw) : null;
  }

  async getPaymentByExternalRef({ botId, externalRef }) {
    const refKey = paymentRefKey({ botId, externalRef });
    const transactionId = await redisManager.get(refKey);
    if (!transactionId) return null;
    return this.getPayment({ botId, transactionId });
  }
}

module.exports = { PaymentStore };
