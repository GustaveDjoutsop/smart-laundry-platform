const { normalizeStatus } = require('./paymentTypes');

class PaymentGateway {
  constructor({ providers, logger, store, events } = {}) {
    this.providers = providers || {};
    this.logger = logger;
    this.store = store;
    this.events = events;
  }

  selectProvider({ preferredProvider } = {}) {
    if (preferredProvider) {
      if (!this.providers[preferredProvider]) {
        throw new Error(`Payment provider "${preferredProvider}" is not configured`);
      }
      return preferredProvider;
    }

    // No silent cross-tenant fallback: with exactly one provider registered
    // this is unambiguous, but with 2+ registered (e.g. CamPay for
    // thomas_network alongside Stripe for AfroMarket in the same process)
    // guessing one would silently route a bot's payment to the wrong
    // provider/currency instead of failing loudly.
    const names = Object.keys(this.providers);
    if (names.length === 1) return names[0];
    throw new Error('preferredProvider is required when more than one payment provider is registered');
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
    redirectUrl,
    idempotencyKey
  } = {}) {
    if (!currency) {
      throw new Error('initiatePayment requires currency');
    }

    // A retry (double-tap, or a redelivered inbound message) reusing the
    // same client-generated key must never re-call the provider - return
    // the already-initiated payment instead of minting a second one.
    if (idempotencyKey && this.store && this.store.getPaymentByIdempotencyKey) {
      const existing = await this.store.getPaymentByIdempotencyKey({ botId, idempotencyKey });
      if (existing) return existing;
    }

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
      redirectUrl,
      idempotencyKey
    });

    const record = {
      botId,
      provider: providerName,
      transactionId: result.transactionId,
      externalRef: result.externalRef || reference || null,
      customerPhone: phoneNumber || null,
      amount,
      currency,
      status: normalizeStatus(result.status),
      checkoutUrl: result.checkoutUrl || null,
      idempotencyKey: idempotencyKey || null,
      metadata: metadata && typeof metadata === 'object' ? metadata : null,
      createdAt: new Date().toISOString(),
      raw: result.raw || null
    };

    if (this.store) {
      if (this.store.appendEvent) {
        await this.store.appendEvent({
          ...record,
          eventType: 'payment_initiated',
          source: 'initiate'
        });
      } else {
        await this.store.upsertPayment(record);
      }

      if (idempotencyKey && this.store.setIdempotencyRef) {
        await this.store.setIdempotencyRef({ botId, idempotencyKey, transactionId: record.transactionId });
      }
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
      if (this.store.appendEvent) {
        await this.store.appendEvent({
          ...updated,
          eventType: 'payment_status_polled',
          source: 'poll'
        });
      } else {
        const existing = await this.store.getPayment({ botId, transactionId });
        await this.store.upsertPayment({ ...(existing || {}), ...updated });
      }
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
      eventId: parsed.eventId || null,
      amount: parsed.amount,
      status: normalizeStatus(parsed.status),
      updatedAt: new Date().toISOString(),
      raw: parsed.raw || payload
    };

    return normalized;
  }
}

module.exports = { PaymentGateway };
