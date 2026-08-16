// Regression coverage for ConfigBot's catalog-welcome-on-first-message
// behavior. Replaces the old request_welcome-triggered mechanism, which
// depended on a Meta webhook event removed from the platform on
// 2026-03-27 ("this feature is no longer supported", per Meta's own
// changelog) - see docs/requirements/afromarket.md v2.23 for the full
// root-cause writeup. The closest achievable substitute: send
// catalogWelcome once, on a customer's genuine first message, tracked via
// a dedicated `catalog_welcome_sent:{botId}:{from}` claim key (not the flow
// engine's own `conv:{botId}:{from}` state - see ConfigBot.handleMessage's
// comment for why), then continue routing that same message through the
// flow engine as normal.
process.env.STRIPE_SECRET_KEY = 'sk_test';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_SUCCESS_URL = 'https://afromarket.example.com/payment-return';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AfroMarketBot } = require('../src/bots/afromarket/AfroMarketBot');
const { ConfigBot } = require('../src/bots/base/ConfigBot');
const { paymentEvents } = require('../src/core/payments/paymentEvents');
const { redisManager } = require('../src/core/redisManager');
const { getAppConfig } = require('../src/core/appConfig');

// eslint-disable-next-line global-require
const afromarketBotConfig = require('../configs/bots/afromarket.bot.json');

let fromCounter = 0;
function nextFrom() {
  fromCounter += 1;
  return `+49172${String(fromCounter).padStart(7, '0')}`;
}

function createAfroMarketBot(t) {
  const bot = new AfroMarketBot(afromarketBotConfig);
  t.after(() => paymentEvents.off('payment.completed', bot._onPaymentCompleted));

  const sent = [];
  bot.whatsapp = {
    isConfigured: () => true,
    sendCatalogMessage: async (args) => sent.push({ type: 'catalog_message', ...args }),
    sendList: async (args) => sent.push({ type: 'list', ...args }),
    sendText: async (args) => sent.push({ type: 'text', ...args })
  };

  return { bot, sent };
}

test('a genuinely new customer\'s first message gets the catalog welcome before the normal flow response', async (t) => {
  const { bot, sent } = createAfroMarketBot(t);
  const from = nextFrom();

  await bot.handleMessage({ from, message: { type: 'text', text: { body: 'hi' } }, phone: from });

  assert.equal(sent.length, 2);
  assert.equal(sent[0].type, 'catalog_message');
  assert.equal(sent[0].to, from);
  assert.match(sent[0].body, /K-AfroMarket/);
  assert.equal(sent[0].thumbnailProductRetailerId, 'bouillie_jaune_500g');
  assert.equal(sent[1].type, 'list');
});

test('a returning customer with existing conversation state does not get the catalog welcome again', async (t) => {
  const { bot, sent } = createAfroMarketBot(t);
  const from = nextFrom();

  await bot.handleMessage({ from, message: { type: 'text', text: { body: 'hi' } }, phone: from });
  sent.length = 0;

  await bot.handleMessage({ from, message: { type: 'text', text: { body: 'hi again' } }, phone: from });

  assert.equal(sent.filter((s) => s.type === 'catalog_message').length, 0);
});

test('the customer\'s first message still routes through the flow engine and persists conversation state', async (t) => {
  const { bot } = createAfroMarketBot(t);
  const from = nextFrom();

  await bot.handleMessage({ from, message: { type: 'text', text: { body: 'hi' } }, phone: from });

  const stored = await redisManager.get(`conv:${afromarketBotConfig.botId}:${from}`);
  assert.ok(stored, 'conversation state should be persisted after the first message');
  const state = JSON.parse(stored);
  assert.equal(state.currentFlowId, 'main_menu');
});

test('a bot with no catalogWelcome configured sends no catalog message and processes the first message normally', async () => {
  const sent = [];
  const bot = new ConfigBot(
    { botId: 'no-welcome-test-bot', botName: 'NoWelcomeTestBot', flows: { main_menu: { states: [{ id: 'welcome', type: 'buttons', template: 'hi', buttons: [] }] } } },
    { plugin: null }
  );
  bot.whatsapp = {
    isConfigured: () => true,
    sendCatalogMessage: async (args) => sent.push({ type: 'catalog_message', ...args }),
    sendButtons: async (args) => sent.push({ type: 'buttons', ...args })
  };

  await assert.doesNotReject(() => bot.handleMessage({ from: '+491234567', message: { type: 'text', text: { body: 'hi' } }, phone: '+491234567' }));
  assert.equal(sent.filter((s) => s.type === 'catalog_message').length, 0);
  assert.equal(sent.filter((s) => s.type === 'buttons').length, 1);
});

test('a failed catalog welcome send does not block the customer\'s first message from being answered', async (t) => {
  const { bot, sent } = createAfroMarketBot(t);
  bot.whatsapp.sendCatalogMessage = async () => {
    throw new Error('simulated Graph API failure');
  };
  const from = nextFrom();

  await assert.doesNotReject(() => bot.handleMessage({ from, message: { type: 'text', text: { body: 'hi' } }, phone: from }));

  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'list');
});

// Regression test for a real bug caught in review: AfroMarketBot._handleNativeOrder
// persists `conv:{botId}:{from}` state *before* calling super.handleMessage() -
// so a customer whose first-ever contact is a native WhatsApp cart submission
// (not plain text) would look like a "returning customer" if the catalog-welcome
// check were keyed off that same conversation-state key, and would never get
// welcomed. Simulates the same precondition directly (state already exists for a
// `from` that has never received a catalog welcome) without needing the full
// native-order/Stripe code path, to isolate exactly the invariant that matters:
// the catalog-welcome claim must be independent of conversation state.
test('a customer whose conversation state already exists from another code path still gets the catalog welcome on their first ConfigBot.handleMessage call', async (t) => {
  const { bot, sent } = createAfroMarketBot(t);
  const from = nextFrom();

  const appConfig = getAppConfig();
  await redisManager.setex(
    `conv:${afromarketBotConfig.botId}:${from}`,
    appConfig.redis.ttlSeconds,
    JSON.stringify({ currentFlowId: 'main_menu', currentStateId: 'checkout_start', context: { cart: [] } })
  );

  await bot.handleMessage({ from, message: { type: 'text', text: { body: 'hi' } }, phone: from });

  assert.equal(sent.filter((s) => s.type === 'catalog_message').length, 1);
});

// Regression test for the duplicate-delivery race caught in review: Meta
// documents at-least-once webhook redelivery, so two inbound events for the
// same brand-new customer's first message could in principle be processed
// concurrently. The setnx-based claim must guarantee only one send wins.
test('two concurrent first messages from the same new customer only trigger one catalog welcome send', async (t) => {
  const { bot, sent } = createAfroMarketBot(t);
  const from = nextFrom();

  await Promise.all([
    bot.handleMessage({ from, message: { type: 'text', text: { body: 'hi' } }, phone: from }),
    bot.handleMessage({ from, message: { type: 'text', text: { body: 'hi' } }, phone: from })
  ]);

  assert.equal(sent.filter((s) => s.type === 'catalog_message').length, 1);
});
