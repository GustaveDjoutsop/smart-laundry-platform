const test = require('node:test');
const assert = require('node:assert/strict');

const { PaymentGateway } = require('../src/core/payments/paymentGateway');
const { PaymentStore } = require('../src/core/payments/paymentStore');

function fakeProvider(overrides = {}) {
  return {
    isConfigured: () => true,
    initiatePayment: async () => ({ transactionId: 'tx1', status: 'PENDING', checkoutUrl: 'https://pay.example.com/tx1', raw: {} }),
    checkStatus: async () => ({ status: 'COMPLETED', raw: {} }),
    ...overrides
  };
}

test('selectProvider throws when preferredProvider is omitted and 2+ providers are registered', () => {
  const gateway = new PaymentGateway({ providers: { campay: fakeProvider(), stripe: fakeProvider() } });
  assert.throws(() => gateway.selectProvider({}), /preferredProvider is required/);
});

test('selectProvider resolves the sole provider when only one is registered, even without preferredProvider', () => {
  const gateway = new PaymentGateway({ providers: { stripe: fakeProvider() } });
  assert.equal(gateway.selectProvider({}), 'stripe');
});

test('selectProvider throws when preferredProvider names a provider that is not registered', () => {
  const gateway = new PaymentGateway({ providers: { stripe: fakeProvider() } });
  assert.throws(() => gateway.selectProvider({ preferredProvider: 'campay' }), /not configured/);
});

test('selectProvider never silently falls back to campay when preferredProvider is omitted', () => {
  // Regression guard: the old default was "prefer campay if registered" -
  // this must now throw instead of silently routing a bot to the wrong,
  // Cameroon-flavored provider.
  const gateway = new PaymentGateway({ providers: { campay: fakeProvider(), stripe: fakeProvider() } });
  assert.throws(() => gateway.selectProvider({}));
});

test('initiatePayment throws when currency is omitted, for any provider', async () => {
  const gateway = new PaymentGateway({ providers: { stripe: fakeProvider() } });
  await assert.rejects(
    () => gateway.initiatePayment({ botId: 'afromarket', amount: 10, preferredProvider: 'stripe' }),
    /requires currency/
  );
});

test('initiatePayment with an idempotencyKey never calls the provider twice for the same key', async () => {
  let callCount = 0;
  const provider = fakeProvider({
    initiatePayment: async () => {
      callCount += 1;
      return { transactionId: `tx-${callCount}`, status: 'PENDING', checkoutUrl: `https://pay.example.com/tx-${callCount}`, raw: {} };
    }
  });

  const store = new PaymentStore({ ttlSeconds: 60 });
  const gateway = new PaymentGateway({ providers: { stripe: provider }, store });

  const first = await gateway.initiatePayment({
    botId: 'afromarket-idem-test',
    amount: 10,
    currency: 'EUR',
    preferredProvider: 'stripe',
    idempotencyKey: 'idem-key-1'
  });
  const second = await gateway.initiatePayment({
    botId: 'afromarket-idem-test',
    amount: 10,
    currency: 'EUR',
    preferredProvider: 'stripe',
    idempotencyKey: 'idem-key-1'
  });

  assert.equal(callCount, 1);
  assert.equal(second.transactionId, first.transactionId);
  assert.equal(second.checkoutUrl, first.checkoutUrl);
});

test('initiatePayment appends a payment_initiated event to the ledger instead of only writing a single row', async () => {
  const store = new PaymentStore({ ttlSeconds: 60 });
  const gateway = new PaymentGateway({ providers: { stripe: fakeProvider() }, store });

  await gateway.initiatePayment({ botId: 'afromarket-ledger-test', amount: 10, currency: 'EUR', preferredProvider: 'stripe' });

  const events = await store.getEvents({ botId: 'afromarket-ledger-test', transactionId: 'tx1' });
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'payment_initiated');
});

test('checkStatus returns previousStatus reflecting the store snapshot before this call writes the new status', async () => {
  const provider = fakeProvider({ checkStatus: async () => ({ status: 'COMPLETED', raw: {} }) });
  const store = new PaymentStore({ ttlSeconds: 60 });
  const gateway = new PaymentGateway({ providers: { stripe: provider }, store });

  await store.appendEvent({
    botId: 'afromarket-prevstatus-test',
    transactionId: 'tx-prev',
    provider: 'stripe',
    eventType: 'payment_initiated',
    status: 'PENDING',
    source: 'initiate'
  });

  const result = await gateway.checkStatus({ botId: 'afromarket-prevstatus-test', provider: 'stripe', transactionId: 'tx-prev' });

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.previousStatus, 'PENDING');
});

// PayPal's checkStatus self-heals a stuck APPROVED order by capturing it
// directly (see paypalProvider.test.js) - a genuine alternate route to the
// capture response the CHECKOUT.ORDER.APPROVED webhook's own capture
// normally feeds into routes/payments.js's recordPaypalCapture. When that
// webhook never arrives (e.g. a signature verification failure - a real
// production scenario this codebase has hit), this poll is what actually
// drives the capture, so the payer/shipping data it returns must still
// reach payment metadata - see afromarket-remove-prepayment-address-
// collection.md, which reads metadata.paypalPayerName/paypalShippingAddress.
test('checkStatus merges a self-heal capture\'s payer name, shipping address, and contact into payment metadata, preserving existing metadata', async () => {
  const provider = fakeProvider({
    checkStatus: async () => ({
      status: 'COMPLETED',
      raw: {},
      payerName: 'Jane Doe',
      shippingAddress: '12 Main St, 10115 Berlin, DE',
      payerContact: 'jane@example.com'
    })
  });
  const store = new PaymentStore({ ttlSeconds: 60 });
  const gateway = new PaymentGateway({ providers: { paypal: provider }, store });

  await store.appendEvent({
    botId: 'afromarket-selfheal-test',
    transactionId: 'tx-selfheal',
    provider: 'paypal',
    eventType: 'payment_initiated',
    status: 'PENDING',
    source: 'initiate',
    metadata: { service: 'afromarket_order', orderNumber: 'AM-1', cart: [{ productId: 'rice_1kg', qty: 1 }] }
  });

  const result = await gateway.checkStatus({ botId: 'afromarket-selfheal-test', provider: 'paypal', transactionId: 'tx-selfheal' });

  assert.deepEqual(result.metadata, {
    service: 'afromarket_order',
    orderNumber: 'AM-1',
    cart: [{ productId: 'rice_1kg', qty: 1 }],
    paypalPayerName: 'Jane Doe',
    paypalShippingAddress: '12 Main St, 10115 Berlin, DE',
    paypalPayerContact: 'jane@example.com'
  });

  const stored = await store.getPayment({ botId: 'afromarket-selfheal-test', transactionId: 'tx-selfheal' });
  assert.equal(stored.metadata.paypalPayerName, 'Jane Doe');
  assert.equal(stored.metadata.paypalPayerContact, 'jane@example.com');
  assert.equal(stored.metadata.orderNumber, 'AM-1', 'the cart/order data from initiatePayment must survive the merge');
});

test('checkStatus does not touch metadata at all when the provider returns no payerName/shippingAddress (e.g. Stripe, or an already-completed PayPal order)', async () => {
  const provider = fakeProvider({ checkStatus: async () => ({ status: 'COMPLETED', raw: {} }) });
  const store = new PaymentStore({ ttlSeconds: 60 });
  const gateway = new PaymentGateway({ providers: { stripe: provider }, store });

  await store.appendEvent({
    botId: 'afromarket-nometadata-test',
    transactionId: 'tx-nometadata',
    provider: 'stripe',
    eventType: 'payment_initiated',
    status: 'PENDING',
    source: 'initiate',
    metadata: { orderNumber: 'AM-2' }
  });

  await gateway.checkStatus({ botId: 'afromarket-nometadata-test', provider: 'stripe', transactionId: 'tx-nometadata' });

  const stored = await store.getPayment({ botId: 'afromarket-nometadata-test', transactionId: 'tx-nometadata' });
  assert.deepEqual(stored.metadata, { orderNumber: 'AM-2' }, 'pre-existing metadata must be untouched, not wiped to null');
});

test('handleWebhook propagates the provider-parsed eventId for downstream dedup', () => {
  const provider = fakeProvider({
    parseWebhook: () => ({ transactionId: 'tx1', status: 'COMPLETED', amount: 10, externalRef: 'AM-1', eventId: 'evt_123', raw: {} })
  });
  const gateway = new PaymentGateway({ providers: { stripe: provider } });

  const normalized = gateway.handleWebhook({ botId: 'afromarket', provider: 'stripe', payload: {} });
  assert.equal(normalized.eventId, 'evt_123');
});
