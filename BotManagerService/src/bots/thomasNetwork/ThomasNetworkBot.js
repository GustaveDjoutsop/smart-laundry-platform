const { ConfigBot } = require('../base/ConfigBot');
const { redisManager } = require('../../core/redisManager');
const { ThomasNetworkFlowPlugin } = require('./thomasNetworkFlowPlugin');
const { paymentEvents } = require('../../core/payments/paymentEvents');
const { getPaymentService } = require('../../core/payments/paymentService');
const { logger } = require('../../utils/logger');

function buildConversationKey({ botId, customerPhone }) {
  return `conv:${botId}:${customerPhone}`;
}

function buildAccessCodeLockKey({ botId, transactionId }) {
  return `accessCodeIssue:${botId}:${transactionId}`;
}

function generateAccessCode() {
  // Short, human-friendly-ish code
  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
  const timePart = Date.now().toString(36).slice(-4).toUpperCase();
  return `${randomPart}${timePart}`;
}

class ThomasNetworkBot extends ConfigBot {
  constructor(config) {
    super(config, { plugin: new ThomasNetworkFlowPlugin({ botConfig: config }) });

    this._onPaymentCompleted = this._onPaymentCompleted.bind(this);
    if (paymentEvents && paymentEvents.on) {
      paymentEvents.on('payment.completed', this._onPaymentCompleted);
    }
  }

  async _onPaymentCompleted(event) {
    const botId = this.config && this.config.botId ? this.config.botId : 'thomas_network';
    if (!event || event.botId !== botId) return;

    const payment = event.payment || null;
    const paymentMetadata = payment && payment.metadata ? payment.metadata : null;

    if (!paymentMetadata || paymentMetadata.service !== 'thomas_network_access') return;

    const transactionId = event.transactionId;
    const customerPhone = payment && payment.customerPhone ? payment.customerPhone : null;
    if (!transactionId || !customerPhone) return;

    const lockKey = buildAccessCodeLockKey({ botId, transactionId });
    const acquiredLock = await redisManager.setnx(lockKey, '1', 60 * 60 * 24);
    if (!acquiredLock) return;

    const accessCode = generateAccessCode();

    try {
      const { store } = getPaymentService();
      const existingPaymentRecord = await store.getPayment({ botId, transactionId });
      if (existingPaymentRecord) {
        await store.upsertPayment({
          ...existingPaymentRecord,
          metadata: {
            ...(existingPaymentRecord.metadata || {}),
            accessCode,
            accessCodeIssuedAt: new Date().toISOString()
          }
        });
      }
    } catch (err) {
      logger.warn('Failed to persist access code to PaymentStore', { error: err && err.message ? err.message : String(err) });
    }

    if (!this.whatsapp.isConfigured()) {
      logger.info('Access code issued (WhatsApp not configured)', { botId, transactionId, customerPhone, accessCode });
      return;
    }

    const messageBody = `Merci pour votre paiement ✅\n\nVotre code est : ${accessCode}`;
    await this.whatsapp.sendText({ to: customerPhone, body: messageBody });
  }
}

module.exports = { ThomasNetworkBot, generateAccessCode, buildConversationKey };
