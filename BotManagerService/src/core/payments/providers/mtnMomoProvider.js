const { normalizeStatus } = require('../paymentTypes');

class MtnMomoProvider {
  constructor({ logger } = {}) {
    this.logger = logger;
  }

  async initiatePayment(options) {
    this.logger && this.logger.info && this.logger.info('MTN MoMo initiatePayment (stub)');
    return {
      transactionId: `mtn_stub_${Date.now()}`,
      status: normalizeStatus('PENDING'),
      externalRef: options && options.reference ? options.reference : null,
      raw: { stub: true }
    };
  }

  async checkStatus(transactionId) {
    return { status: normalizeStatus('PENDING'), transactionId };
  }

  verifyWebhook(_payload, _signatureHeader) {
    return false;
  }

  parseWebhook(payload) {
    return payload;
  }
}

module.exports = { MtnMomoProvider };
