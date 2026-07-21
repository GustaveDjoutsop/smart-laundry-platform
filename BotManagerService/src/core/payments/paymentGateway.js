const { normalizeStatus } = require('./paymentTypes');

class PaymentGateway {
  constructor({ providers, logger, store, events } = {}) {
    this.providers = providers || {};
    this.logger = logger;
    this.store = store;
    this.events = events;
  }

  selectProvider({ preferredProvider } = {}) {
    if (preferredProvider && this.providers[preferredProvider]) return preferredProvider;
    if (this.providers.campay) return 'campay';
    const first = Object.keys(this.providers)[0];
    return first;
  }

  getProvider(name) {
    return this.providers[name] || null;
  }

  async initiatePayment({
    botId,
    amount,
    currency,
    phoneNumber,
    reference,
    description,
    preferredProvider,
    metadata,
    customerEmail,
    customerName,
    redirectUrl
  } = {}) {
    const providerName = this.selectProvider({ preferredProvider });
    const provider = this.getProvider(providerName);
    if (!provider) throw new Error('No payment provider available');

    const result = await provider.initiatePayment({
      amount,
      currency,
      phoneNumber,
      reference,
      description,
      preferredProvider,
      customerEmail,
      customerName,
      redirectUrl
    });

    const record = {
      botId,
      provider: providerName,
      transactionId: result.transactionId,
      externalRef: result.externalRef || reference || null,
      customerPhone: phoneNumber || null,
      amount,
      currency: currency || 'XAF',
      status: normalizeStatus(result.status),
      checkoutUrl: result.checkoutUrl || null,
      metadata: metadata && typeof metadata === 'object' ? metadata : null,
      createdAt: new Date().toISOString(),
      raw: result.raw || null
    };

    if (this.store) {
      await this.store.upsertPayment(record);
    }

    if (this.events && this.events.emit) {
      this.events.emit('payment.initiated', {
        botId,
        provider: providerName,
        transactionId: record.transactionId,
        externalRef: record.externalRef,
        customerPhone: record.customerPhone,
        status: record.status,
        metadata: record.metadata
      });
    }

    return record;
  }

  async checkStatus({ botId, provider: providerName, transactionId } = {}) {
    const provider = this.getProvider(providerName);
    if (!provider) throw new Error(`Unknown provider: ${providerName}`);
    const res = await provider.checkStatus(transactionId);

    const updated = {
      botId,
      provider: providerName,
      transactionId,
      status: normalizeStatus(res.status),
      checkedAt: new Date().toISOString(),
      raw: res.raw || null
    };

    if (this.store) {
      const existing = await this.store.getPayment({ botId, transactionId });
      await this.store.upsertPayment({
        ...(existing || {}),
        ...updated
      });
    }

    return updated;
  }

  handleWebhook({ botId, provider: providerName, payload } = {}) {
    const provider = this.getProvider(providerName);
    if (!provider) throw new Error(`Unknown provider: ${providerName}`);

    const parsed = provider.parseWebhook(payload);
    const normalized = {
      botId,
      provider: providerName,
      transactionId: parsed.transactionId,
      externalRef: parsed.externalRef || null,
      amount: parsed.amount,
      status: normalizeStatus(parsed.status),
      updatedAt: new Date().toISOString(),
      raw: parsed.raw || payload
    };

    return normalized;
  }
}

module.exports = { PaymentGateway };
