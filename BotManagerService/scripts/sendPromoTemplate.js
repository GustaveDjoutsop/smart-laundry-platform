/**
 * Manual trigger for AfroMarket's approved promo/discount template
 * (Variant A - "no-code", afromarket_promo_v1 - see
 * scripts/submitPromoTemplate.js and docs/requirements/afromarket.md
 * v2.17/v2.25). Sends the template to a single customer; run it once per
 * recipient for a manual promo blast until an automated trigger exists
 * (none does yet - see v2.25's own note on this).
 *
 * Deliberately NOT Variant B (afromarket_promo_code_v1) - that one ships
 * with a placeholder wa.me link instead of routing back into the bot
 * (Meta requires its second button to be URL, not QUICK_REPLY - see
 * submitPromoTemplate.js's header), so sending it for real would put a
 * dead-end link in a real customer's hands. Wire that up deliberately if
 * it's ever actually wanted live, not as a side effect of this script.
 *
 * Takes phone-number-id as an explicit argument rather than defaulting to
 * one, same safety discipline as scripts/setConversationalAutomation.js -
 * this is an outward-facing, real-customer-visible send, and getting the
 * wrong number (sandbox vs production) wrong here is not a "just retry"
 * mistake.
 *
 * Usage:
 *   node scripts/sendPromoTemplate.js <phone-number-id> <to-e164> <product-id> <percent-off>
 *
 * Example (production, K-AfroMarket, sends from 1214372845096561):
 *   node scripts/sendPromoTemplate.js 1214372845096561 +491701234567 bouillie_jaune_500g 20
 *
 * Requires WHATSAPP_ACCESS_TOKEN_AFROMARKET (env or .env).
 */
// Guarded like scripts/submitCatalogBatch.js's dotenv call - this file
// isn't currently require()'d elsewhere, but matching that pattern keeps
// requiring it as a module (e.g. from a future test) side-effect-free.
if (require.main === module) {
  require('dotenv').config();
}

const { WhatsAppCloudClient } = require('../src/core/whatsapp/whatsappClient');
const { findProduct } = require('../src/bots/afromarket/afromarketFlowPlugin');

// eslint-disable-next-line global-require
const afromarketBotConfig = require('../configs/bots/afromarket.bot.json');

async function main() {
  const [phoneNumberId, to, productId, percentOffRaw] = process.argv.slice(2);

  if (!phoneNumberId || !to || !productId || !percentOffRaw) {
    console.error('Usage: node scripts/sendPromoTemplate.js <phone-number-id> <to-e164> <product-id> <percent-off>');
    process.exitCode = 1;
    return;
  }

  // Rejects a decimal outright rather than silently truncating it
  // (Math.trunc(20.9) === 20 would have quietly changed what's actually
  // sent to a real customer for a fat-fingered argument, caught in review
  // before this shipped) - Number(...) itself already rejects non-numeric
  // garbage like "abc" by producing NaN, which Number.isFinite catches.
  const percentOff = Number(percentOffRaw);
  if (!Number.isFinite(percentOff) || !Number.isInteger(percentOff) || percentOff <= 0 || percentOff >= 100) {
    console.error(`percent-off must be a whole number between 1 and 99, got: ${percentOffRaw}`);
    process.exitCode = 1;
    return;
  }

  const product = findProduct(afromarketBotConfig, productId);
  if (!product) {
    console.error(`No product with id "${productId}" in configs/bots/afromarket.bot.json`);
    process.exitCode = 1;
    return;
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN_AFROMARKET;
  if (!token) {
    throw new Error('WHATSAPP_ACCESS_TOKEN_AFROMARKET is not set');
  }

  const client = new WhatsAppCloudClient({
    accessToken: token,
    phoneNumberId,
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v20.0',
    apiBase: process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com'
  });

  const result = await client.sendPromoTemplate({
    to,
    templateName: 'afromarket_promo_v1',
    languageCode: 'en_US',
    percentOff,
    productName: product.name,
    imageLink: product.imageUrl,
    quickReplyPayload: `promo_add:${productId}:${percentOff}`
  });

  console.log(`Sent ${percentOff}% off ${product.name} to ${to} via phone_number_id=${phoneNumberId}`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
