// Regression coverage for a Copilot review comment on PR #106: ConfigBot's
// sendIntent() gained a new 'promo_template' outbound intent type (routed to
// whatsapp.sendPromoTemplate for AfroMarket's "Current promo" menu option -
// see afromarketFlowPlugin.js's _handleSendCurrentPromo), but nothing
// directly asserted the field mapping between the two. Without this, the
// bot could emit a promo_template intent that ConfigBot silently treats as
// unsupported (just logs a warning, sends nothing) or mis-maps a field, and
// every flow-level test would still pass since those only assert on the
// intent object the flow engine builds, not what actually reaches the
// WhatsApp client.
process.env.STRIPE_SECRET_KEY = 'sk_test';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_SUCCESS_URL = 'https://afromarket.example.com/payment-return';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AfroMarketBot } = require('../src/bots/afromarket/AfroMarketBot');
const { paymentEvents } = require('../src/core/payments/paymentEvents');

// eslint-disable-next-line global-require
const afromarketBotConfig = require('../configs/bots/afromarket.bot.json');

function createAfroMarketBot(t) {
  const bot = new AfroMarketBot(afromarketBotConfig);
  t.after(() => paymentEvents.off('payment.completed', bot._onPaymentCompleted));

  const sent = [];
  bot.whatsapp = {
    isConfigured: () => true,
    sendPromoTemplate: async (args) => sent.push({ type: 'promo_template', ...args })
  };

  return { bot, sent };
}

test('ConfigBot.sendIntent maps a promo_template intent onto whatsapp.sendPromoTemplate with every field forwarded', async (t) => {
  const { bot, sent } = createAfroMarketBot(t);

  await bot.sendIntent({
    type: 'promo_template',
    to: '+491234567',
    templateName: 'afromarket_promo_v1',
    languageCode: 'en_US',
    percentOff: 20,
    productName: 'Bouillie Jaune – Sèche 500g',
    imageLink: 'https://legal.botmanagementservice.eu/products/afromarket-bouillie-jaune-500g.png',
    quickReplyPayload: 'promo_add:bouillie_jaune_500g:20'
  });

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    type: 'promo_template',
    to: '+491234567',
    templateName: 'afromarket_promo_v1',
    languageCode: 'en_US',
    percentOff: 20,
    productName: 'Bouillie Jaune – Sèche 500g',
    imageLink: 'https://legal.botmanagementservice.eu/products/afromarket-bouillie-jaune-500g.png',
    imageMediaId: undefined,
    quickReplyPayload: 'promo_add:bouillie_jaune_500g:20'
  });
});
