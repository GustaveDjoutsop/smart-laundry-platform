process.env.STRIPE_SECRET_KEY = 'sk_test';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_SUCCESS_URL = 'https://afromarket.example.com/payment-return';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AfroMarketBot } = require('../src/bots/afromarket/AfroMarketBot');
const { paymentEvents } = require('../src/core/payments/paymentEvents');

// eslint-disable-next-line global-require
const botConfig = require('../configs/bots/afromarket.bot.json');

function createBot(t) {
  const bot = new AfroMarketBot(botConfig);
  t.after(() => paymentEvents.off('payment.completed', bot._onPaymentCompleted));

  const sent = [];
  bot.whatsapp = {
    isConfigured: () => true,
    sendButtons: async (args) => sent.push({ type: 'buttons', ...args })
  };

  const invoiceCalls = [];
  bot.invoiceRecordStore = { insert: async (args) => invoiceCalls.push(args) };

  const profileCalls = [];
  bot.customerProfileStore = { upsert: async (args) => profileCalls.push(args) };

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
        phone: '+491701234567'
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
    deliveryAddress: '12 Main St, Berlin'
  });

  // The customer-facing order confirmation must still go out.
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'buttons');
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
