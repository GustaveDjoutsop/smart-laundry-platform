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

    // PayPal's checkStatus self-heals an order stuck at APPROVED by capturing
    // it directly (see paypalProvider.js) - a genuine alternate route to the
    // same capture response the CHECKOUT.ORDER.APPROVED webhook's own capture
    // normally feeds into routes/payments.js's recordPaypalCapture. When this
    // poll is what actually drove the capture (e.g. because that webhook's
    // delivery failed signature verification), the payer/shipping/contact
    // data it returned must still reach payment metadata the same way -
    // otherwise afromarketFlowPlugin's post-payment-address flow (which reads
    // metadata.paypalPayerName/paypalShippingAddress) always falls through to
    // asking the customer for an address they already gave PayPal, and the
    // order confirmation's Contact: line renders empty (see
    // afromarket-dual-completion-trigger-and-contact-field.md). Read-merge-
    // write, not a fresh object - appendEvent's metadata field replaces
    // wholesale, and this must not drop the cart/name/address/etc. captured
    // at initiatePayment time.
    let metadata;
    if (
      (res.payerName !== undefined || res.shippingAddress !== undefined || res.payerContact !== undefined) &&
      this.store &&
      this.store.getPayment
    ) {
      const existing = await this.store.getPayment({ botId, transactionId });
      const existingMetadata = (existing && existing.metadata) || {};
      metadata = {
        ...existingMetadata,
        paypalPayerName: res.payerName,
        paypalShippingAddress: res.shippingAddress,
        paypalPayerContact: res.payerContact
      };
    }

    const updated = {
      botId,
      provider: providerName,
      transactionId,
      status: normalizeStatus(res.status),
      checkedAt: new Date().toISOString(),
      raw: res.raw || null,
      ...(metadata !== undefined ? { metadata } : {})
    };

    let previousStatus = null;
    if (this.store) {
      if (this.store.appendEvent) {
        const appended = await this.store.appendEvent({
          ...updated,
          eventType: 'payment_status_polled',
          source: 'poll'
        });
        previousStatus = appended ? appended.previousStatus : null;
      } else {
        const existing = await this.store.getPayment({ botId, transactionId });
        previousStatus = existing ? existing.status : null;
        await this.store.upsertPayment({ ...(existing || {}), ...updated });
      }
    }

    return { ...updated, previousStatus };
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
