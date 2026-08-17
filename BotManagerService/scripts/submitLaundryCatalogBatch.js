/**
 * Sync Smart Laundry's service catalog to a Meta Commerce Catalog via the
 * Catalog Batch API.
 *
 * Idempotent: every item is submitted with method "UPDATE" and
 * allow_upsert=true (the same approach as submitCatalogBatch.js for
 * AfroMarket), so re-running is safe - it updates existing retailer IDs
 * rather than duplicating them. The Meta Catalog Batch API does not expose
 * a "get by retailer_id" endpoint that would let this script distinguish
 * created vs. updated items at the individual level; the API processes
 * batches asynchronously and returns only a batch-level handle ID, not
 * per-item results. The sync summary therefore reports submitted/failed
 * counts (based on validation and the API response) rather than
 * created/updated/skipped, which are indeterminate at call time. This
 * limitation is documented here rather than papered over.
 *
 * Note: this script only ever UPDATEs (upserts) the products currently
 * defined in config/laundryCatalog.js - it never DELETEs. If a product is
 * removed or its retailerId changes, the old entry is left behind as a
 * stale item in the Meta catalog. Fine for occasional manual runs; worth
 * revisiting (diff live IDs vs. config IDs, issue DELETEs for the diff)
 * before this becomes automated.
 *
 * Usage:
 *   node scripts/submitLaundryCatalogBatch.js
 *
 * Required environment variables:
 *   WHATSAPP_ACCESS_TOKEN_LAUNDRY   - Graph API token with
 *                                     catalog_management permission on the
 *                                     laundry WABA.
 *   LAUNDRY_CATALOG_ID              - Meta Commerce Catalog ID (no default;
 *                                     must be set explicitly to avoid
 *                                     accidentally targeting the wrong
 *                                     catalog — see AfroMarket's history in
 *                                     the file header of submitCatalogBatch.js).
 *   LAUNDRY_PHONE_NUMBER            - WhatsApp number in E.164 without "+"
 *                                     (e.g. "4915123456789"), used as the
 *                                     product link target since Smart
 *                                     Laundry has no per-service webpage.
 *   LAUNDRY_IMG_WASH_STANDARD       - Public HTTPS URL for the standard wash image.
 *   LAUNDRY_IMG_WASH_EXPRESS        - Public HTTPS URL for the express wash image.
 *   LAUNDRY_IMG_WASH_LARGE          - Public HTTPS URL for the large load wash image.
 *   LAUNDRY_IMG_DRY_SUIT            - Public HTTPS URL for the dry clean suit image.
 *   LAUNDRY_IMG_DRY_DRESS           - Public HTTPS URL for the dry clean dress image.
 *   LAUNDRY_IMG_IRON_SHIRT          - Public HTTPS URL for the ironing shirt image.
 *   LAUNDRY_IMG_IRON_BUNDLE5        - Public HTTPS URL for the 5-item iron bundle image.
 *   LAUNDRY_IMG_HOUSEHOLD_DUVET     - Public HTTPS URL for the duvet wash image.
 *   LAUNDRY_IMG_HOUSEHOLD_CURTAINS  - Public HTTPS URL for the curtain wash image.
 *   LAUNDRY_IMG_PROMO_COMBO         - Public HTTPS URL for the combo deal image.
 *
 * See CATALOG_SETUP.md for full setup instructions.
 */

if (require.main === module) {
  require('dotenv').config();
}

const { getCatalog } = require('../config/laundryCatalog');
const { validateCatalog } = require('../services/catalogValidation');

const API_VERSION = 'v20.0';
const BRAND = 'Smart Laundry';

function assertValidPhoneNumber(phoneNumber) {
  if (!/^\d{8,15}$/.test(phoneNumber)) {
    throw new Error(
      'LAUNDRY_PHONE_NUMBER must be 8-15 digits in E.164 form without "+" — check the value in your .env'
    );
  }
}

function buildProductLink(phoneNumber, product) {
  const prefilledText = `Hi! I'd like to book ${product.name}`;
  return `https://wa.me/${phoneNumber}?text=${encodeURIComponent(prefilledText)}`;
}

function toCatalogItem({ product, phoneNumber }) {
  return {
    method: 'UPDATE',
    data: {
      id: product.retailerId,
      title: product.name,
      description: product.description,
      brand: BRAND,
      price: `${Number(product.price).toFixed(2)} ${product.currency}`,
      availability: product.availability,
      condition: 'new',
      link: buildProductLink(phoneNumber, product),
      image_link: product.imageUrl
    }
  };
}

function buildBatchRequestBody({ products, phoneNumber }) {
  return {
    item_type: 'PRODUCT_ITEM',
    allow_upsert: true,
    requests: products.map((product) => toCatalogItem({ product, phoneNumber }))
  };
}

async function main() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN_LAUNDRY;
  if (!token) {
    throw new Error('WHATSAPP_ACCESS_TOKEN_LAUNDRY is not set');
  }

  const catalogId = process.env.LAUNDRY_CATALOG_ID;
  if (!catalogId) {
    throw new Error(
      'LAUNDRY_CATALOG_ID is not set — set it explicitly to avoid targeting the wrong catalog'
    );
  }

  const phoneNumber = process.env.LAUNDRY_PHONE_NUMBER;
  if (!phoneNumber) {
    throw new Error('LAUNDRY_PHONE_NUMBER is not set');
  }
  assertValidPhoneNumber(phoneNumber);

  console.log('target catalog:', catalogId);

  const catalog = getCatalog();
  const validationErrors = validateCatalog(catalog);

  if (validationErrors.length > 0) {
    console.error(`catalog validation failed with ${validationErrors.length} error(s):`);
    for (const err of validationErrors) {
      console.error(' -', err);
    }
    process.exitCode = 1;
    return;
  }

  const { products } = catalog;
  console.log(`validated ${products.length} products, submitting batch…`);

  const requestBody = buildBatchRequestBody({ products, phoneNumber });

  const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${catalogId}/items_batch`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });
  const body = await res.json();

  console.log('API status:', res.status);
  console.log(JSON.stringify(body, null, 2));

  // items_batch is processed asynchronously by Meta — a 200 here means the
  // batch was accepted, not that every item succeeded. Per-item results are
  // only visible later in Commerce Manager's catalog diagnostics.
  // submitted = products sent in this batch (validation passed)
  // failed    = request-level rejection (non-2xx or body.error present)
  if (!res.ok || body.error) {
    console.error(`\nsync summary: submitted=${products.length}, failed=all (API error — see above)`);
    process.exitCode = 1;
  } else {
    console.log(`\nsync summary: submitted=${products.length}, accepted_by_meta=yes`);
    console.log('Note: per-item create/update/skip counts are not available synchronously — check Commerce Manager for per-item results.');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { assertValidPhoneNumber, buildProductLink, toCatalogItem, buildBatchRequestBody };
