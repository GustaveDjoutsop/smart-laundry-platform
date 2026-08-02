const { ConfigBot } = require('../base/ConfigBot');
const { AfroMarketFlowPlugin, buildOrderConfirmationText } = require('./afromarketFlowPlugin');
const { redisManager } = require('../../core/redisManager');
const { paymentEvents } = require('../../core/payments/paymentEvents');
const { logger } = require('../../utils/logger');

function buildOrderConfirmLockKey({ botId, transactionId }) {
  return `orderConfirmSent:${botId}:${transactionId}`;
}

class AfroMarketBot extends ConfigBot {
  constructor(config) {
    super(config, { plugin: new AfroMarketFlowPlugin({ botConfig: config }) });

    this._onPaymentCompleted = this._onPaymentCompleted.bind(this);
    if (paymentEvents && paymentEvents.on) {
      paymentEvents.on('payment.completed', this._onPaymentCompleted);
    }
  }

  async _onPaymentCompleted(event) {
    const botId = this.config && this.config.botId ? this.config.botId : 'afromarket';
    if (!event || event.botId !== botId) return;

    const payment = event.payment || null;
    const metadata = payment && payment.metadata ? payment.metadata : null;
    if (!metadata || metadata.service !== 'afromarket_order') return;

    const transactionId = event.transactionId;
    const customerPhone = payment && payment.customerPhone ? payment.customerPhone : null;
    if (!transactionId || !customerPhone) return;

    const lockKey = buildOrderConfirmLockKey({ botId, transactionId });
    const acquiredLock = await redisManager.setnx(lockKey, '1', 60 * 60 * 24);
    if (!acquiredLock) return;

    const confirmationText = buildOrderConfirmationText({
      orderNumber: metadata.orderNumber,
      cart: metadata.cart || [],
      name: metadata.name,
      address: metadata.address,
      phone: metadata.phone
    });

    if (!this.whatsapp.isConfigured()) {
      logger.info('AfroMarket order paid (WhatsApp not configured)', { botId, transactionId, customerPhone });
      return;
    }

    await this.whatsapp.sendButtons({
      to: customerPhone,
      body: confirmationText,
      buttons: [
        { id: 'shop_again', title: '🛍 Shop Again' },
        { id: 'menu', title: '🏠 Main Menu' }
      ]
    });
  }
}

module.exports = { AfroMarketBot };
