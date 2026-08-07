/**
 * One-off / re-runnable tool to sync AfroMarket's product catalog (defined in
 * configs/bots/afromarket.bot.json) to a Meta Commerce Catalog via the
 * Catalog Batch API. This is Phase 1 of the native product_list (MPM) /
 * cart migration - see afromarket-catalog-cart-migration-todo.md.
 *
 * Idempotent: every item is submitted with method "UPDATE" and
 * allow_upsert=true, so re-running is safe - it updates existing retailer
 * IDs (the bot.json product "id") rather than duplicating them.
 *
 * Usage:
 *   node scripts/submitCatalogBatch.js [path/to/bot.json]
 *
 * Defaults to configs/bots/afromarket.bot.json when no path is given.
 *
 * Requires:
 *   WHATSAPP_ACCESS_TOKEN_AFROMARKET - same token used by the other
 *     AfroMarket scripts, needs catalog_management permission on the WABA.
 *   AFROMARKET_CATALOG_ID - the Commerce Catalog ID created in Meta
 *     Commerce Manager (see afromarket-catalog-cart-migration-todo.md,
 *     "Prerequisite: catalog setup" - that step is manual, not scripted).
 *   AFROMARKET_PHONE_NUMBER - the bot's WhatsApp number in E.164 without
 *     the leading "+" (e.g. "4915123456789"), used to build each product's
 *     required "link" field as a wa.me deep link back into the bot, since
 *     AfroMarket has no per-product webpage.
 *
 * Note: this script only ever UPDATEs (upserts) the products currently in
 * bot.json - it never DELETEs. If a product is removed from bot.json or its
 * "id" changes, the old retailer ID is left behind as a stale, orphaned item
 * in the Meta catalog. Fine while this stays a manual, occasionally-run
 * script; worth revisiting (diff live catalog IDs vs. config IDs, issue
 * DELETEs for the difference) before this becomes the sole source of truth.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const API_VERSION = 'v20.0';
const BRAND = 'AfroMarket';

function assertValidPhoneNumber(phoneNumber) {
  // AFROMARKET_PHONE_NUMBER is operator-set, not user input, but a stray
  // "+"/space in it would silently break every product's wa.me link with no
  // error until someone taps one on WhatsApp - cheap to catch here instead.
  if (!/^\d+$/.test(phoneNumber)) {
    throw new Error(`AFROMARKET_PHONE_NUMBER must be digits only in E.164 form without "+" (got "${phoneNumber}")`);
  }
}

function buildProductLink(phoneNumber, product) {
  const prefilledText = `Hi! I'd like to order ${product.name}`;
  return `https://wa.me/${phoneNumber}?text=${encodeURIComponent(prefilledText)}`;
}

function toCatalogItem({ product, currency, phoneNumber }) {
  if (!product || !product.id || !product.name || !product.imageUrl) {
    throw new Error(`product missing required field(s) for catalog sync: ${JSON.stringify(product)}`);
  }

  // priceEur can legitimately be 0 (a free/promo item) - a plain truthiness
  // check on it would wrongly reject that as "missing", so priceEur is
  // validated separately by nullness/finiteness rather than folded into the
  // check above.
  const price = product.priceEur == null ? NaN : Number(product.priceEur);
  if (!Number.isFinite(price)) {
    throw new Error(`product missing required field(s) for catalog sync: ${JSON.stringify(product)}`);
  }

  return {
    method: 'UPDATE',
    data: {
      id: product.id,
      title: product.name,
      description: product.description || product.name,
      brand: BRAND,
      price: `${price.toFixed(2)} ${currency}`,
      availability: 'in stock',
      condition: 'new',
      link: buildProductLink(phoneNumber, product),
      image_link: product.imageUrl
    }
  };
}

function buildBatchRequestBody({ botConfig, phoneNumber }) {
  const products = Array.isArray(botConfig.products) ? botConfig.products : [];
  if (!products.length) {
    throw new Error('no products found in bot config');
  }
  const currency = botConfig.currency || 'EUR';

  return {
    item_type: 'PRODUCT_ITEM',
    allow_upsert: true,
    requests: products.map((product) => toCatalogItem({ product, currency, phoneNumber }))
  };
}

async function main() {
  const botConfigPath = process.argv[2] || path.join(__dirname, '..', 'configs', 'bots', 'afromarket.bot.json');

  const token = process.env.WHATSAPP_ACCESS_TOKEN_AFROMARKET;
  if (!token) {
    throw new Error('WHATSAPP_ACCESS_TOKEN_AFROMARKET is not set');
  }
  const catalogId = process.env.AFROMARKET_CATALOG_ID;
  if (!catalogId) {
    throw new Error('AFROMARKET_CATALOG_ID is not set');
  }
  const phoneNumber = process.env.AFROMARKET_PHONE_NUMBER;
  if (!phoneNumber) {
    throw new Error('AFROMARKET_PHONE_NUMBER is not set');
  }
  assertValidPhoneNumber(phoneNumber);

  const botConfig = JSON.parse(fs.readFileSync(botConfigPath, 'utf8'));
  const requestBody = buildBatchRequestBody({ botConfig, phoneNumber });

  const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${catalogId}/items_batch`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });
  const body = await res.json();
  console.log('status:', res.status);
  console.log(JSON.stringify(body, null, 2));

  // items_batch is processed asynchronously by Meta - a 200 here only means
  // the batch was accepted for processing, not that every item in it
  // succeeded. body.error covers request-level rejection; per-item results
  // only show up later in the catalog's own diagnostics, which this script
  // does not poll for.
  if (!res.ok || body.error) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { assertValidPhoneNumber, buildProductLink, toCatalogItem, buildBatchRequestBody };
