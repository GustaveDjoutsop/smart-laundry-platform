// Regression coverage for ConfigBot's catalog-welcome-on-first-message
// behavior. Replaces the old request_welcome-triggered mechanism, which
// depended on a Meta webhook event removed from the platform on
// 2026-03-27 ("this feature is no longer supported", per Meta's own
// changelog) - see docs/requirements/afromarket.md v2.23/v2.24 for the full
// root-cause writeup. The closest achievable substitute: send
// catalogWelcome once, on a customer's genuine first message, tracked via
// a dedicated `catalog_welcome_sent:{botId}:{from}` claim key (not the flow
// engine's own `conv:{botId}:{from}` state - see ConfigBot.handleMessage's
// comment for why). Per product decision (v2.24, after production showed
// both the catalog AND the normal flow welcome stacked on the same first
// message): the customer's genuine first contact gets ONLY the catalog -
// the flow engine doesn't run at all that turn. The normal flow/menu
// response only appears from the customer's next interaction onward.
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

test('a genuinely new customer\'s first message gets ONLY the catalog welcome, not the normal flow response', async (t) => {
  const { bot, sent } = createAfroMarketBot(t);
  const from = nextFrom();

  await bot.handleMessage({ from, message: { type: 'text', text: { body: 'hi' } }, phone: from });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'catalog_message');
  assert.equal(sent[0].to, from);
  assert.match(sent[0].body, /K-AfroMarket/);
  assert.equal(sent[0].thumbnailProductRetailerId, 'bouillie_jaune_500g');
});

test('a returning customer with existing conversation state does not get the catalog welcome again', async (t) => {
  const { bot, sent } = createAfroMarketBot(t);
  const from = nextFrom();

  await bot.handleMessage({ from, message: { type: 'text', text: { body: 'hi' } }, phone: from });
  sent.length = 0;

  await bot.handleMessage({ from, message: { type: 'text', text: { body: 'hi again' } }, phone: from });

  assert.equal(sent.filter((s) => s.type === 'catalog_message').length, 0);
});

test('the flow engine (and conversation-state persistence) only kicks in from the customer\'s second message onward', async (t) => {
  const { bot, sent } = createAfroMarketBot(t);
  const from = nextFrom();

  await bot.handleMessage({ from, message: { type: 'text', text: { body: 'hi' } }, phone: from });
  const stateAfterFirst = await redisManager.get(`conv:${afromarketBotConfig.botId}:${from}`);
  assert.equal(stateAfterFirst, undefined, 'the catalog-only first turn should not touch flow-engine state');

  sent.length = 0;
  await bot.handleMessage({ from, message: { type: 'text', text: { body: 'hi again' } }, phone: from });

  assert.equal(sent.filter((s) => s.type === 'catalog_message').length, 0);
  assert.equal(sent.filter((s) => s.type === 'list').length, 1);

  const stateAfterSecond = await redisManager.get(`conv:${afromarketBotConfig.botId}:${from}`);
  assert.ok(stateAfterSecond, 'conversation state should be persisted once the flow engine actually runs');
  assert.equal(JSON.parse(stateAfterSecond).currentFlowId, 'main_menu');
});

// Regression test for a Copilot review comment on the PR: if the WhatsApp
// client isn't configured, sendIntent() returns early without sending or
// throwing (see ConfigBot.sendIntent), so the old code would still claim
// the key and permanently suppress the welcome for that customer - even
// after the misconfiguration got fixed - for the full claim TTL. The claim
// must not be made at all when the client isn't configured, so the next
// message after it IS configured still gets the welcome.
test('when the WhatsApp client isn\'t configured, the catalog welcome claim is skipped so it can still be sent once configured', async (t) => {
  const { bot, sent } = createAfroMarketBot(t);
  const from = nextFrom();
  bot.whatsapp.isConfigured = () => false;

  await bot.handleMessage({ from, message: { type: 'text', text: { body: 'hi' } }, phone: from });
  assert.equal(sent.filter((s) => s.type === 'catalog_message').length, 0);

  bot.whatsapp.isConfigured = () => true;
  await bot.handleMessage({ from, message: { type: 'text', text: { body: 'hi again' } }, phone: from });
  assert.equal(sent.filter((s) => s.type === 'catalog_message').length, 1);
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

// Regression test for two real bugs caught in review, both around
// AfroMarketBot._handleNativeOrder persisting `conv:{botId}:{from}` state
// (a submitted cart, staged for checkout) *before* calling
// super.handleMessage():
// 1. The catalog-welcome claim must be independent of conversation state -
//    otherwise this customer would look like a "returning customer" and
//    never get welcomed at all.
// 2. Once the catalog-only-first-message short-circuit was added (v2.24),
//    a second bug appeared: skipping the flow engine on a successful
//    catalog send would silently strand this exact staged checkout -
//    the customer's real order would just vanish, no error, no trace.
// Simulates the precondition directly (state already exists for a `from`
// that has never received a catalog welcome) without needing the full
// native-order/Stripe code path, to isolate both invariants at once: the
// welcome still sends, AND the pre-staged checkout still gets processed.
test('a customer whose conversation state already exists from another code path gets the catalog welcome AND still has that pre-staged work processed', async (t) => {
  const { bot, sent } = createAfroMarketBot(t);
  const from = nextFrom();

  const appConfig = getAppConfig();
  await redisManager.setex(
    `conv:${afromarketBotConfig.botId}:${from}`,
    appConfig.redis.ttlSeconds,
    JSON.stringify({ currentFlowId: 'main_menu', currentStateId: 'checkout_start', context: { cart: [{ productId: 'ndole_250g', qty: 1 }] } })
  );

  await bot.handleMessage({ from, message: { type: 'text', text: { body: 'hi' } }, phone: from });

  assert.equal(sent.filter((s) => s.type === 'catalog_message').length, 1);
  // checkout_start (an action state, no saved profile in test) advances to
  // checkout_name, which - in the same turn - consumes this message's "hi"
  // as the name input and advances again to checkout_address, prompting
  // for the delivery address. Proof the flow engine actually ran this turn
  // (multiple states deep) instead of being skipped entirely.
  assert.ok(sent.some((s) => s.type === 'text' && /delivery address/.test(s.body)), 'the staged checkout should still advance through the flow, not get stranded');

  const stored = await redisManager.get(`conv:${afromarketBotConfig.botId}:${from}`);
  assert.equal(JSON.parse(stored).currentStateId, 'checkout_address', 'conversation state should have advanced past checkout_start, not stayed stranded');
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
