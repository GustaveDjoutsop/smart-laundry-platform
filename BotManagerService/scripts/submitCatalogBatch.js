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
 * Per-product `salePriceEur` in bot.json (optional) maps to Meta's native
 * `sale_price` field - set it on a product actively running a promotion to
 * get strikethrough discount pricing wherever the catalog is browsed
 * natively (confirmed present as a real Commerce Manager field via direct
 * inspection, not assumed - see docs/requirements/afromarket.md v2.26).
 * Must be strictly less than priceEur or the sync throws before sending
 * anything. Leave it unset for products not currently on sale.
 *
 * Usage:
 *   node scripts/submitCatalogBatch.js [path/to/bot.json]
 *
 * Defaults to configs/bots/afromarket.bot.json when no path is given.
 *
 * Requires:
 *   WHATSAPP_ACCESS_TOKEN_AFROMARKET - same token used by the other
 *     AfroMarket scripts, needs catalog_management permission on the WABA.
 *   AFROMARKET_PHONE_NUMBER - the bot's WhatsApp number in E.164 without
 *     the leading "+" (e.g. "4915123456789"), used to build each product's
 *     required "link" field as a wa.me deep link back into the bot, since
 *     AfroMarket has no per-product webpage.
 *
 * Two real Commerce Catalogs exist - confirmed live (2026-08-14) via
 * GET /{WABA_ID}/product_catalogs on each WABA, exactly the same
 * sandbox/production split as the WABA_ID convention already used by
 * submitCarouselTemplate.js/submitPromoTemplate.js, but a DIFFERENT split:
 * a catalog is its own object, only ever connected to one WABA - there is
 * no single catalog shared across both like there was assumed through
 * v2.16-v2.19 (see docs/requirements/afromarket.md v2.20). The default
 * below is the dev/sandbox catalog; override AFROMARKET_CATALOG_ID
 * explicitly to target production. Syncing one does NOT sync the other -
 * run this once per catalog whenever product data changes and both
 * environments need to reflect it:
 *   node scripts/submitCatalogBatch.js                                  # dev (AfroMarket-Dev-Catalog, 1678073176620294)
 *   AFROMARKET_CATALOG_ID=1333066702319721 node scripts/submitCatalogBatch.js   # production (AfroMarket-Production-Catalog)
 *
 * Note: this script only ever UPDATEs (upserts) the products currently in
 * bot.json - it never DELETEs. If a product is removed from bot.json or its
 * "id" changes, the old retailer ID is left behind as a stale, orphaned item
 * in the Meta catalog. Fine while this stays a manual, occasionally-run
 * script; worth revisiting (diff live catalog IDs vs. config IDs, issue
 * DELETEs for the difference) before this becomes the sole source of truth.
 */
const fs = require('fs');
const path = require('path');

// dotenv is a side effect of loading a local .env file - this module is also
// require()'d by tests, so that side effect only fires when the script is
// actually run directly (see the require.main guard around main() below),
// not as an import-time surprise for test/environment behavior.
if (require.main === module) {
  require('dotenv').config();
}

const API_VERSION = 'v20.0';
const BRAND = 'AfroMarket';
// Dev/sandbox catalog default, matching the WABA_ID default/override
// convention elsewhere in scripts/ - see the file header for both real IDs.
const DEFAULT_CATALOG_ID = '1678073176620294';

function assertValidPhoneNumber(phoneNumber) {
  // AFROMARKET_PHONE_NUMBER is operator-set, not user input, but a stray
  // "+"/space in it - or a too-short/too-long typo - would silently break
  // every product's wa.me link with no error until someone taps one on
  // WhatsApp, so this checks digits-only and E.164's 8-15 digit length
  // (max length per the spec; 8 as a practical floor for a real number
  // that includes a country code) rather than just "some digits".
  if (!/^\d{8,15}$/.test(phoneNumber)) {
    throw new Error(
      `AFROMARKET_PHONE_NUMBER must be 8-15 digits in E.164 form without "+" (got "${phoneNumber}")`
    );
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

  const data = {
    id: product.id,
    title: product.name,
    description: product.description || product.name,
    brand: BRAND,
    price: `${price.toFixed(2)} ${currency}`,
    availability: 'in stock',
    condition: 'new',
    link: buildProductLink(phoneNumber, product),
    image_link: product.imageUrl
  };

  // salePriceEur is optional - only set on a product actively running a
  // promotion (see docs/requirements/afromarket.md v2.25/v2.26). Meta
  // requires sale_price to be strictly less than price for it to render as
  // a discount - validated here rather than letting a typo silently ship
  // a "sale" that isn't one, or a Graph API error surface later with no
  // indication of which product caused it.
  if (product.salePriceEur != null) {
    const salePrice = Number(product.salePriceEur);
    if (!Number.isFinite(salePrice)) {
      throw new Error(`product ${product.id}: salePriceEur is not a valid number (got "${product.salePriceEur}")`);
    }
    // salePrice < price alone lets a negative/zero typo (e.g. a stray "-"
    // or a decimal-point slip) through silently, since -1 < any positive
    // price - caught in review before this shipped. A sale price of zero
    // or less isn't a discount, it's a data error.
    if (salePrice <= 0) {
      throw new Error(`product ${product.id}: salePriceEur (${salePrice}) must be greater than zero`);
    }
    if (salePrice >= price) {
      throw new Error(`product ${product.id}: salePriceEur (${salePrice}) must be less than priceEur (${price})`);
    }
    data.sale_price = `${salePrice.toFixed(2)} ${currency}`;
  }

  return { method: 'UPDATE', data };
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
  const catalogId = process.env.AFROMARKET_CATALOG_ID || DEFAULT_CATALOG_ID;
  // Printed unconditionally, not just on error - a wrong-catalog sync
  // (dev vs. production) succeeds silently otherwise, exactly the mistake
  // this script's history already made once (see the file header).
  console.log('target catalog:', catalogId, catalogId === DEFAULT_CATALOG_ID ? '(dev/sandbox, default)' : '(override)');
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
