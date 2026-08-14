/**
 * One-off tool to submit AfroMarket's promo/discount message template, in
 * either of its two variants (see afromarket-dynamic-templates-todo.md):
 *
 *   Variant A (no-code): image header + dynamic product name/discount
 *     percentage + a QUICK_REPLY "Shop Now" button that routes back into
 *     the bot (payload set at send time - see payloadTriggers/
 *     products.addDiscounted in flowEngine.js/afromarketFlowPlugin.js).
 *   Variant B (lto): Meta's Limited Time Offer template type - mandatory
 *     COPY_CODE + URL button pair (Meta does not allow a QUICK_REPLY here),
 *     confirmed via developers.facebook.com/documentation - so unlike
 *     Variant A, "Shop Now" cannot route back into the bot for this
 *     variant. Ships with a wa.me deep-link placeholder (same fallback
 *     scripts/submitCatalogBatch.js already uses for products with no
 *     dedicated webpage) since Variant B is prepared-but-not-activated -
 *     the real routing gets decided whenever it's actually turned on. Only
 *     renders its native countdown/copy-code UI on the WhatsApp mobile
 *     app, not Web/Desktop - confirmed via Meta's own LTO template docs.
 *
 * Both variants use the exact same {{1}}=percentOff / {{2}}=productName
 * body variable shape as the runtime send (see whatsappClient.js -
 * sendPromoTemplate reads these from the same product/discount data
 * products.addDiscounted already computes), so swapping which product or
 * percentage is featured in a given promo blast never needs a
 * resubmission - same "vary at send time, not at template-definition time"
 * discipline as submitCarouselTemplate.js, for the same reason (see that
 * file's header comment and afromarket-carousel-bugs-todo.md).
 *
 * Usage:
 *   node scripts/submitPromoTemplate.js no-code <name> <image-path>
 *   node scripts/submitPromoTemplate.js lto <name> <image-path>
 *
 * Requires WHATSAPP_ACCESS_TOKEN_AFROMARKET (env or .env) with
 * whatsapp_business_management scope on the target WABA.
 *
 * Two real WABAs exist - the default below is the Test/sandbox WABA; the
 * real production WABA is K-AfroMarket (878603275008509) - override
 * AFROMARKET_WABA_ID explicitly to target it. A template approved on one
 * WABA is invisible to the other; submit to both if the feature needs to
 * work in both environments. Same pattern as submitCarouselTemplate.js.
 */
require('dotenv').config();
const fs = require('fs');

const WABA_ID = process.env.AFROMARKET_WABA_ID || '4464369590494418';
const BODY_TEXT = '🎉 {{1}}% off {{2}}! Tap the button below to grab this deal before it\'s gone.';
const BODY_EXAMPLE = ['20', 'Bouillie Jaune – Sèche 500g'];

async function discoverAppId(token) {
  const res = await fetch(
    `https://graph.facebook.com/v20.0/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`
  );
  const body = await res.json();
  if (!body.data || !body.data.app_id) {
    throw new Error(`could not resolve app_id from token: ${JSON.stringify(body)}`);
  }
  return body.data.app_id;
}

async function uploadImage(token, appId, filePath) {
  const buf = fs.readFileSync(filePath);
  const startRes = await fetch(
    `https://graph.facebook.com/v20.0/${appId}/uploads?file_length=${buf.length}&file_type=image/jpeg&access_token=${encodeURIComponent(token)}`,
    { method: 'POST' }
  );
  const startBody = await startRes.json();
  if (!startBody.id) {
    throw new Error(`upload session start failed for ${filePath}: ${JSON.stringify(startBody)}`);
  }

  const uploadRes = await fetch(`https://graph.facebook.com/v20.0/${startBody.id}`, {
    method: 'POST',
    headers: { Authorization: 'OAuth ' + token, file_offset: '0' },
    body: buf
  });
  const uploadBody = await uploadRes.json();
  if (!uploadBody.h) {
    throw new Error(`upload failed for ${filePath}: ${JSON.stringify(uploadBody)}`);
  }
  return uploadBody.h;
}

function buildNoCodeTemplateBody(templateName, headerHandle) {
  return {
    name: templateName,
    language: 'en_US',
    category: 'MARKETING',
    components: [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: [headerHandle] } },
      { type: 'BODY', text: BODY_TEXT, example: { body_text: [BODY_EXAMPLE] } },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Shop Now' }] }
    ]
  };
}

function buildLtoTemplateBody(templateName, headerHandle) {
  // NOT a wa.me link - Meta rejects direct WhatsApp deep-links as a
  // template URL button target ("Direct links to WhatsApp aren't allowed
  // for buttons", confirmed live against the real API, contradicting the
  // wa.me fallback used elsewhere in this codebase for products with no
  // dedicated webpage - see submitCatalogBatch.js's buildProductLink).
  // Points at a real page on a domain this business controls as an honest
  // placeholder since Variant B isn't being activated yet - swap for the
  // real discounted-checkout destination whenever it is.
  const placeholderUrl = 'https://legal.botmanagementservice.eu/impressum.html';
  return {
    name: templateName,
    language: 'en_US',
    category: 'MARKETING',
    components: [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: [headerHandle] } },
      { type: 'BODY', text: BODY_TEXT, example: { body_text: [BODY_EXAMPLE] } },
      // limited_time_offer.text is capped at 16 characters - confirmed live
      // against the real API, not documented with an exact number anywhere
      // findable in advance.
      { type: 'LIMITED_TIME_OFFER', limited_time_offer: { text: 'Limited offer', has_expiration: true } },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'COPY_CODE', example: 'SAVE20' },
          { type: 'URL', text: 'Shop Now', url: placeholderUrl }
        ]
      }
    ]
  };
}

async function main() {
  const [variant, templateName, imagePath] = process.argv.slice(2);
  if (!['no-code', 'lto'].includes(variant) || !templateName || !imagePath) {
    console.error('Usage: node scripts/submitPromoTemplate.js <no-code|lto> <name> <image-path>');
    process.exitCode = 1;
    return;
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN_AFROMARKET;
  if (!token) {
    throw new Error('WHATSAPP_ACCESS_TOKEN_AFROMARKET is not set');
  }

  const appId = await discoverAppId(token);
  const headerHandle = await uploadImage(token, appId, imagePath);

  const templateBody = variant === 'lto' ? buildLtoTemplateBody(templateName, headerHandle) : buildNoCodeTemplateBody(templateName, headerHandle);

  const res = await fetch(`https://graph.facebook.com/v20.0/${WABA_ID}/message_templates`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(templateBody)
  });
  const body = await res.json();
  console.log('status:', res.status);
  console.log(JSON.stringify(body, null, 2));
  if (!res.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
