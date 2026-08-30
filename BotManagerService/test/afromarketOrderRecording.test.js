process.env.STRIPE_SECRET_KEY = 'sk_test';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_SUCCESS_URL = 'https://afromarket.example.com/payment-return';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AfroMarketBot } = require('../src/bots/afromarket/AfroMarketBot');
const { paymentEvents } = require('../src/core/payments/paymentEvents');
const { redisManager } = require('../src/core/redisManager');

// eslint-disable-next-line global-require
const botConfig = require('../configs/bots/afromarket.bot.json');

function createBot(t) {
  const bot = new AfroMarketBot(botConfig);
  t.after(() => {
    paymentEvents.off('payment.completed', bot._onPaymentCompleted);
    paymentEvents.off('afromarket.post_payment_address_captured', bot._onPostPaymentAddressCaptured);
  });

  const sent = [];
  bot.whatsapp = {
    isConfigured: () => true,
    sendButtons: async (args) => sent.push({ type: 'buttons', ...args }),
    sendText: async (args) => sent.push({ type: 'text', ...args })
  };

  const invoiceCalls = [];
  bot.invoiceRecordStore = { insert: async (args) => invoiceCalls.push(args) };

  const profileCalls = [];
  bot.customerProfileStore = { upsert: async (args) => profileCalls.push(args) };

  // Avoids a real DB round trip through CustomerIdentityLinkStore/getPool()
  // in these tests - see afromarket-identity-linkage-design.md.
  bot.identityResolver = { resolve: async () => 'canonical-test-customer-id' };

  return { bot, sent, invoiceCalls, profileCalls };
}

function completedPaymentEvent(overrides = {}) {
  return {
    botId: 'afromarket',
    transactionId: 'tx_1',
    provider: 'stripe',
    payment: {
      provider: 'stripe',
      amount: 12.5,
      currency: 'EUR',
      customerPhone: '+491701234567',
      externalRef: 'pi_123',
      metadata: {
        service: 'afromarket_order',
        orderNumber: 'A-1001',
        cart: [{ productId: 'rice_1kg', qty: 2 }],
        name: 'Jane Doe',
        address: '12 Main St, Berlin',
        phone: '+491701234567',
        email: 'jane@example.com'
      }
    },
    ...overrides
  };
}

test('AfroMarket order recording: a completed payment snapshots an invoice and upserts the customer profile', async (t) => {
  const { bot, sent, invoiceCalls, profileCalls } = createBot(t);

  await bot._onPaymentCompleted(completedPaymentEvent());

  assert.equal(invoiceCalls.length, 1);
  assert.equal(invoiceCalls[0].botId, 'afromarket');
  assert.equal(invoiceCalls[0].transactionId, 'tx_1');
  assert.equal(invoiceCalls[0].provider, 'stripe');
  assert.equal(invoiceCalls[0].buyerName, 'Jane Doe');
  assert.equal(invoiceCalls[0].buyerAddress, '12 Main St, Berlin');
  assert.equal(invoiceCalls[0].buyerPhone, '+491701234567');
  assert.deepEqual(invoiceCalls[0].lineItems, [{ productId: 'rice_1kg', qty: 2 }]);
  assert.equal(invoiceCalls[0].amount, 12.5);
  assert.equal(invoiceCalls[0].currency, 'EUR');
  assert.equal(invoiceCalls[0].paymentReference, 'pi_123');

  assert.equal(profileCalls.length, 1);
  assert.deepEqual(profileCalls[0], {
    botId: 'afromarket',
    whatsappId: '+491701234567',
    name: 'Jane Doe',
    deliveryAddress: '12 Main St, Berlin',
    email: 'jane@example.com',
    customerId: 'canonical-test-customer-id'
  });

  // The customer-facing order confirmation must still go out.
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'buttons');
});

test('AfroMarket order recording: an identity-resolution failure does not block the profile upsert or order confirmation', async (t) => {
  const { bot, sent, profileCalls } = createBot(t);
  bot.identityResolver = {
    resolve: async () => {
      throw new Error('db unreachable');
    }
  };

  await bot._onPaymentCompleted(completedPaymentEvent({ transactionId: 'tx_4' }));

  assert.equal(profileCalls.length, 1);
  assert.equal(profileCalls[0].customerId, null);
  assert.equal(sent.length, 1, 'the customer must still get their order confirmation');
});

test('AfroMarket order recording: an invoice write failure does not block the order confirmation from sending', async (t) => {
  const { bot, sent, profileCalls } = createBot(t);
  bot.invoiceRecordStore = {
    insert: async () => {
      throw new Error('db unreachable');
    }
  };

  await bot._onPaymentCompleted(completedPaymentEvent({ transactionId: 'tx_2' }));

  assert.equal(profileCalls.length, 1, 'the profile write is independent and should still happen');
  assert.equal(sent.length, 1, 'the customer must still get their order confirmation');
});

test('AfroMarket order recording: events for a different botId are ignored', async (t) => {
  const { bot, invoiceCalls, profileCalls, sent } = createBot(t);

  await bot._onPaymentCompleted(completedPaymentEvent({ botId: 'laundry', transactionId: 'tx_3' }));

  assert.equal(invoiceCalls.length, 0);
  assert.equal(profileCalls.length, 0);
  assert.equal(sent.length, 0);
});

// --- afromarket-remove-prepayment-address-collection.md ---------------------

test('AfroMarket order recording: PayPal-returned name and shipping address finalize the order immediately, same as chat-collected values', async (t) => {
  const { bot, invoiceCalls, profileCalls, sent } = createBot(t);

  await bot._onPaymentCompleted(
    completedPaymentEvent({
      transactionId: 'tx_paypal_full',
      provider: 'paypal',
      payment: {
        provider: 'paypal',
        amount: 27.4,
        currency: 'EUR',
        customerPhone: '+491701234567',
        externalRef: 'ORDER-1',
        metadata: {
          service: 'afromarket_order',
          orderNumber: 'AM-1',
          cart: [{ productId: 'rice_1kg', qty: 2 }],
          // No chat-collected name/address at all - the PayPal path skips
          // that collection entirely (see the todo doc).
          name: null,
          address: null,
          phone: '+491701234567',
          email: null,
          paypalPayerName: 'Jane Doe',
          paypalShippingAddress: '12 Main St, 10115 Berlin, DE'
        }
      }
    })
  );

  assert.equal(invoiceCalls.length, 1);
  assert.equal(invoiceCalls[0].buyerName, 'Jane Doe');
  assert.equal(invoiceCalls[0].buyerAddress, '12 Main St, 10115 Berlin, DE');
  assert.equal(profileCalls.length, 1);
  assert.equal(profileCalls[0].deliveryAddress, '12 Main St, 10115 Berlin, DE');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'buttons');
  assert.match(sent[0].body, /12 Main St, 10115 Berlin, DE/);
});

test('AfroMarket order recording: PayPal capture missing a shipping address defers the invoice/profile write and asks the customer for it instead', async (t) => {
  const { bot, invoiceCalls, profileCalls, sent } = createBot(t);
  const transactionId = 'tx_paypal_no_address';
  const customerPhone = '+491701234568';

  await bot._onPaymentCompleted(
    completedPaymentEvent({
      transactionId,
      provider: 'paypal',
      payment: {
        provider: 'paypal',
        amount: 27.4,
        currency: 'EUR',
        customerPhone,
        externalRef: 'ORDER-2',
        metadata: {
          service: 'afromarket_order',
          orderNumber: 'AM-2',
          cart: [{ productId: 'rice_1kg', qty: 2 }],
          name: null,
          address: null,
          phone: customerPhone,
          email: null,
          paypalPayerName: 'John Smith',
          paypalShippingAddress: null // a guest/card PayPal payment that returned no address
        }
      }
    })
  );

  // Money already moved (this is not the money-safety part - that already
  // succeeded) - but invoice_record is legally append-only (no update()),
  // so nothing is written yet rather than permanently recording an
  // incomplete invoice.
  assert.equal(invoiceCalls.length, 0);
  assert.equal(profileCalls.length, 0);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'text');
  assert.match(sent[0].body, /Payment received/);
  assert.match(sent[0].body, /delivery address/);

  const stored = await redisManager.get(`conv:afromarket:${customerPhone}`);
  const conversationState = JSON.parse(stored);
  assert.equal(conversationState.currentStateId, 'post_payment_address_needed');
  assert.equal(conversationState.context.pendingOrderTransactionId, transactionId);
  assert.equal(conversationState.context.pendingOrderPayment.externalRef, 'ORDER-2');
  assert.equal(conversationState.context.pendingOrderMetadata.orderNumber, 'AM-2');
  // The already-validated checkout phone, stashed so the later free-text
  // reply doesn't have to re-derive it from that turn's own from/phone
  // (which for a BSUID-only contact can be an unrelated routing identifier).
  assert.equal(conversationState.context.pendingOrderCustomerPhone, customerPhone);
});

test('AfroMarket order recording: a redelivered payment.completed webhook while an order is still pending an address does not re-send the prompt or double-write', async (t) => {
  const { bot, invoiceCalls, profileCalls, sent } = createBot(t);
  const transactionId = 'tx_paypal_no_address_redelivered';
  const customerPhone = '+491701234571';

  const event = completedPaymentEvent({
    transactionId,
    provider: 'paypal',
    payment: {
      provider: 'paypal',
      amount: 27.4,
      currency: 'EUR',
      customerPhone,
      externalRef: 'ORDER-redelivered',
      metadata: {
        service: 'afromarket_order',
        orderNumber: 'AM-redelivered',
        cart: [{ productId: 'rice_1kg', qty: 2 }],
        name: null,
        address: null,
        phone: customerPhone,
        email: null,
        paypalPayerName: 'Redelivered Customer',
        paypalShippingAddress: null
      }
    }
  });

  // buildOrderConfirmLockKey is acquired the moment payment.completed
  // fires, regardless of whether the order finalizes immediately or is
  // deferred - so a redelivered webhook for the same transaction must be a
  // no-op here too, not just once the order is fully finalized.
  await bot._onPaymentCompleted(event);
  await bot._onPaymentCompleted(event);

  assert.equal(invoiceCalls.length, 0, 'still deferred - no invoice written either way');
  assert.equal(profileCalls.length, 0);
  assert.equal(sent.length, 1, 'the address-request prompt must not be sent twice');
});

test('AfroMarket order recording: a captured post-payment address finalizes the deferred order', async (t) => {
  const { bot, invoiceCalls, profileCalls, sent } = createBot(t);

  await bot._onPostPaymentAddressCaptured({
    botId: 'afromarket',
    transactionId: 'tx_paypal_address_captured',
    customerPhone: '+491701234569',
    address: '99 Other St, Hamburg',
    payment: { provider: 'paypal', amount: 27.4, currency: 'EUR', externalRef: 'ORDER-3' },
    metadata: {
      service: 'afromarket_order',
      orderNumber: 'AM-3',
      cart: [{ productId: 'rice_1kg', qty: 2 }],
      name: null,
      address: null,
      phone: '+491701234569',
      email: null,
      paypalPayerName: 'Alex Doe',
      paypalShippingAddress: null
    }
  });

  assert.equal(invoiceCalls.length, 1);
  assert.equal(invoiceCalls[0].buyerName, 'Alex Doe');
  assert.equal(invoiceCalls[0].buyerAddress, '99 Other St, Hamburg');
  assert.equal(profileCalls.length, 1);
  assert.equal(profileCalls[0].deliveryAddress, '99 Other St, Hamburg');

  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'buttons');
  assert.match(sent[0].body, /Order confirmed/);
  assert.match(sent[0].body, /99 Other St, Hamburg/);
});

test('AfroMarket order recording: a redelivered post-payment-address-captured event does not finalize the order twice', async (t) => {
  const { bot, invoiceCalls, sent } = createBot(t);
  const event = {
    botId: 'afromarket',
    transactionId: 'tx_paypal_address_dedup',
    customerPhone: '+491701234570',
    address: 'Some Street 1, Munich',
    payment: { provider: 'paypal', amount: 10, currency: 'EUR', externalRef: 'ORDER-4' },
    metadata: { service: 'afromarket_order', orderNumber: 'AM-4', cart: [], phone: '+491701234570' }
  };

  await bot._onPostPaymentAddressCaptured(event);
  await bot._onPostPaymentAddressCaptured(event);

  assert.equal(invoiceCalls.length, 1, 'a redelivered/duplicate address-captured event must not write the invoice twice');
  assert.equal(sent.length, 1, 'and must not send the confirmation twice');
});
