// Regression coverage for ConfigBot._handleRequestWelcome - the
// `request_welcome` webhook event Meta fires the instant a customer opens
// the chat for the first time, once conversational_automation's
// enable_welcome_message is turned on (see
// scripts/setConversationalAutomation.js). This is not a real flow turn:
// it must not touch flow-engine state, and a bot with no catalogWelcome
// configured must no-op rather than error. See
// docs/requirements/afromarket.md v2.16.
process.env.STRIPE_SECRET_KEY = 'sk_test';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_SUCCESS_URL = 'https://afromarket.example.com/payment-return';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AfroMarketBot } = require('../src/bots/afromarket/AfroMarketBot');
const { ConfigBot } = require('../src/bots/base/ConfigBot');
const { paymentEvents } = require('../src/core/payments/paymentEvents');

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
    sendCatalogMessage: async (args) => sent.push({ type: 'catalog_message', ...args })
  };

  return { bot, sent };
}

test('request_welcome sends the configured catalogWelcome as a catalog_message, rendered from bot config', async (t) => {
  const { bot, sent } = createAfroMarketBot(t);
  const from = nextFrom();

  await bot.handleMessage({ from, message: { type: 'request_welcome' }, phone: from });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, from);
  assert.match(sent[0].body, /K-AfroMarket/);
  assert.equal(sent[0].thumbnailProductRetailerId, 'bouillie_jaune_500g');
});

test('request_welcome does not create or advance any conversation flow state', async (t) => {
  const { bot } = createAfroMarketBot(t);
  const from = nextFrom();

  await bot.handleMessage({ from, message: { type: 'request_welcome' }, phone: from });

  const { redisManager } = require('../src/core/redisManager');
  const stored = await redisManager.get(`conv:${afromarketBotConfig.botId}:${from}`);
  assert.equal(stored, undefined);
});

test('request_welcome no-ops without error when the bot has no catalogWelcome configured', async () => {
  const sent = [];
  const bot = new ConfigBot(
    { botId: 'no-welcome-test-bot', botName: 'NoWelcomeTestBot', flows: { main_menu: { states: [{ id: 'welcome', type: 'buttons', template: 'hi', buttons: [] }] } } },
    { plugin: null }
  );
  bot.whatsapp = { isConfigured: () => true, sendCatalogMessage: async (args) => sent.push(args) };

  await assert.doesNotReject(() => bot.handleMessage({ from: '+491234567', message: { type: 'request_welcome' }, phone: '+491234567' }));
  assert.equal(sent.length, 0);
});

test('a normal text message still routes through the flow engine as before (request_welcome handling does not intercept it)', async (t) => {
  const { bot, sent } = createAfroMarketBot(t);
  bot.whatsapp.sendList = async (args) => sent.push({ type: 'list', ...args });
  const from = nextFrom();

  await bot.handleMessage({ from, message: { type: 'text', text: { body: 'hi' } }, phone: from });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'list');
});
