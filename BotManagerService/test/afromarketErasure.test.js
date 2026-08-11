process.env.STRIPE_SECRET_KEY = 'sk_test';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_SUCCESS_URL = 'https://afromarket.example.com/payment-return';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AfroMarketBot } = require('../src/bots/afromarket/AfroMarketBot');
const { paymentEvents } = require('../src/core/payments/paymentEvents');

// eslint-disable-next-line global-require
const botConfig = require('../configs/bots/afromarket.bot.json');

// redisManager is a module-level singleton, so the erasure "pending
// confirmation" flag would otherwise leak between tests that reuse the same
// phone number. Each test gets its own number instead of relying on cleanup.
let fromCounter = 0;
function nextFrom() {
  fromCounter += 1;
  return `+49170${String(fromCounter).padStart(7, '0')}`;
}

// paymentEvents is a shared singleton EventEmitter; the constructor
// subscribes to it, so every bot built for a test must be unsubscribed again
// or it keeps reacting (and pushing into its own now-abandoned `sent`
// array) for the rest of the test run.
function createBot(t) {
  const bot = new AfroMarketBot(botConfig);
  t.after(() => paymentEvents.off('payment.completed', bot._onPaymentCompleted));

  const sent = [];
  bot.whatsapp = {
    isConfigured: () => true,
    sendText: async (args) => sent.push({ type: 'text', ...args }),
    sendButtons: async (args) => sent.push({ type: 'buttons', ...args }),
    sendList: async (args) => sent.push({ type: 'list', ...args }),
    sendImage: async (args) => sent.push({ type: 'image', ...args }),
    sendCtaUrl: async (args) => sent.push({ type: 'cta_url', ...args }),
    sendCarouselTemplate: async (args) => sent.push({ type: 'template_carousel', ...args })
  };

  const deletionCalls = [];
  bot.deletionRequestService = {
    execute: async (args) => deletionCalls.push(args)
  };

  return { bot, sent, deletionCalls };
}

test('AfroMarket erasure: "LÖSCHEN" asks for confirmation and does not touch the deletion service yet', async (t) => {
  const { bot, sent, deletionCalls } = createBot(t);
  const from = nextFrom();

  await bot.handleMessage({ from, message: { text: { body: 'LÖSCHEN' } } });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'text');
  assert.match(sent[0].body, /wirklich alle Ihre persönlichen Daten löschen/);
  assert.equal(deletionCalls.length, 0);
});

test('AfroMarket erasure: confirming with "JA" executes the deletion and confirms it to the customer', async (t) => {
  const { bot, sent, deletionCalls } = createBot(t);
  const from = nextFrom();

  await bot.handleMessage({ from, message: { text: { body: 'delete' } } });
  await bot.handleMessage({ from, message: { text: { body: 'JA' } } });

  assert.equal(deletionCalls.length, 1);
  assert.deepEqual(deletionCalls[0], { botId: 'afromarket', whatsappId: from });

  assert.equal(sent.length, 2);
  assert.match(sent[1].body, /persönlichen Daten wurden gelöscht/);
  assert.match(sent[1].body, /§ 147 AO/);
});

test('AfroMarket erasure: any non-confirming reply cancels without calling the deletion service', async (t) => {
  const { bot, sent, deletionCalls } = createBot(t);
  const from = nextFrom();

  await bot.handleMessage({ from, message: { text: { body: 'supprimer' } } });
  await bot.handleMessage({ from, message: { text: { body: 'oops wrong button' } } });

  assert.equal(deletionCalls.length, 0);
  assert.match(sent[1].body, /abgebrochen/);
});

test('AfroMarket erasure: the confirmation prompt is single-use - a second unrelated message falls through to the normal flow', async (t) => {
  const { bot, sent } = createBot(t);
  const from = nextFrom();

  await bot.handleMessage({ from, message: { text: { body: 'delete' } } });
  await bot.handleMessage({ from, message: { text: { body: 'nein danke' } } }); // consumes the pending confirmation
  await bot.handleMessage({ from, message: { text: { body: 'hi' } } }); // normal flow dispatch, not another erasure prompt

  assert.match(sent[1].body, /abgebrochen/);
  // "hi" triggers the bot's normal main-menu flow (whatever shape that takes), not the erasure prompt again.
  assert.doesNotMatch(sent[2].body, /persönlichen Daten löschen/);
});

test('AfroMarket erasure: a message with no text body (e.g. a button reply) is ignored by the intercept and falls through', async (t) => {
  const { bot, deletionCalls } = createBot(t);
  const from = nextFrom();

  // Should not throw, and should not treat the interactive payload as a trigger word.
  await bot.handleMessage({ from, message: { interactive: { button_reply: { id: 'menu' } } } });

  assert.equal(deletionCalls.length, 0);
});

test('AfroMarket erasure: does not throw when WhatsApp is not configured - logs instead, same as every other outbound message', async (t) => {
  const { bot, deletionCalls } = createBot(t);
  const from = nextFrom();
  bot.whatsapp.isConfigured = () => false;

  // sendIntent's own isConfigured() guard must short-circuit before ever
  // reaching sendText, so it's fine that this mock's sendText would throw
  // if it were ever actually called.
  bot.whatsapp.sendText = async () => {
    throw new Error('sendText should not be called when WhatsApp is not configured');
  };

  await bot.handleMessage({ from, message: { text: { body: 'delete' } } });
  await bot.handleMessage({ from, message: { text: { body: 'JA' } } });

  assert.equal(deletionCalls.length, 1, 'the deletion itself still runs even though no confirmation could be sent');
});

test('AfroMarket identity linkage: handleMessage does not await it (fire-and-forget, per review)', async (t) => {
  // Regression test: awaiting a DB-backed resolve() in handleMessage's hot
  // path would add latency to every paired-identifier message and, since
  // QueueManager drains inbound messages serially, back up every other
  // customer's message behind it - flagged in review. Only fires when both
  // identifiers are present (contact-book pairing signal); see
  // afromarket-identity-linkage-design.md.
  const { bot } = createBot(t);
  const from = nextFrom();

  let resolveLinkage;
  const linkagePromise = new Promise((resolve) => {
    resolveLinkage = resolve;
  });
  let linkageSettled = false;
  bot.identityResolver = {
    resolve: async () => {
      await linkagePromise;
      linkageSettled = true;
      return 'canonical-x';
    }
  };

  const handled = bot.handleMessage({
    from,
    message: { text: { body: 'hi' } },
    phone: from,
    bsuid: 'user.paired-with-this-phone'
  });

  // If handleMessage awaited identity resolution, this would hang until the
  // 500ms timeout instead of resolving immediately - linkagePromise is
  // deliberately never resolved until after the race below.
  await Promise.race([
    handled,
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error('handleMessage did not resolve - identity linkage may be blocking it')), 500)
    )
  ]);

  assert.equal(linkageSettled, false, 'identity resolution should still be pending when handleMessage completes');
  resolveLinkage();
});
