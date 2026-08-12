/**
 * One-off tool to submit a WhatsApp Carousel Template for AfroMarket recipe
 * or restaurant browsing. Real horizontal scrolling (matching Jasper's
 * Market) can only be achieved via a Meta-approved carousel template -
 * freeform interactive messages never scroll horizontally, regardless of how
 * they're built.
 *
 * Usage:
 *   node scripts/submitCarouselTemplate.js <name> <images-dir> <cards.json>
 *
 * <images-dir> must contain one .jpg per card, named to match the "image"
 * field in cards.json (e.g. "jollof.jpg").
 *
 * cards.json shape (introText/introExample optional - omit for a carousel
 * with no top-level body, e.g. a restaurant directory):
 * {
 *   "introText": "Our favorite {{region}} dishes, {{1}} - swipe through and tap Get this recipe on the one that looks good!",
 *   "introExample": "there",
 *   "cards": [
 *     { "image": "jollof.jpg", "body": "Jollof Rice - 45 min, 380 kcal, Easy", "buttonType": "QUICK_REPLY", "buttonText": "Get this recipe" },
 *     { "image": "bantabaa.jpg", "body": "Bantabaa - Gambian\n...", "buttonType": "URL", "buttonText": "Visit Website", "buttonUrl": "https://bantabaafooddealer.eu/" },
 *     ...
 *   ]
 * }
 *
 * Every card's `body` is ALWAYS submitted as a {{1}} variable (with `body`
 * itself as the example), never baked into the template as literal text -
 * see afromarket-carousel-bugs-todo.md's Correction (Aug 2026): a prior
 * restaurant carousel template had name/address/hours typed directly into
 * the approved template, which meant the whole template went silently stale
 * the moment the underlying restaurant list changed (it kept showing three
 * old restaurants next to buttons for their old sites, with no error - the
 * template was still "valid," just wrong). Making the body a variable means
 * swapping which entries appear later needs only a different send-time
 * value (see cards[].bodyText in the bot config), never a resubmission.
 * URL buttons remain static per card (WhatsApp only supports one dynamic
 * suffix appended to a single base domain per template, which can't
 * represent cards pointing at unrelated external domains) - prefer
 * QUICK_REPLY cards routed back through the bot when the destinations are
 * genuinely different domains that may change independently.
 *
 * Requires WHATSAPP_ACCESS_TOKEN_AFROMARKET (env or .env) with
 * whatsapp_business_management scope on the target WABA, and the WABA id
 * below (afromarket + laundry currently share one sandbox WABA).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const WABA_ID = process.env.AFROMARKET_WABA_ID || '4464369590494418';
const APP_ID = process.env.META_UPLOAD_APP_ID || '1568134674642836';

async function uploadImage(token, filePath) {
  const buf = fs.readFileSync(filePath);
  const startRes = await fetch(
    `https://graph.facebook.com/v20.0/${APP_ID}/uploads?file_length=${buf.length}&file_type=image/jpeg&access_token=${encodeURIComponent(token)}`,
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

async function main() {
  const [templateName, imagesDir, cardsJsonPath] = process.argv.slice(2);
  if (!templateName || !imagesDir || !cardsJsonPath) {
    console.error('Usage: node scripts/submitCarouselTemplate.js <name> <images-dir> <cards.json>');
    process.exitCode = 1;
    return;
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN_AFROMARKET;
  if (!token) {
    throw new Error('WHATSAPP_ACCESS_TOKEN_AFROMARKET is not set');
  }

  const spec = JSON.parse(fs.readFileSync(cardsJsonPath, 'utf8'));

  const cardsWithHandles = [];
  for (const card of spec.cards) {
    // eslint-disable-next-line no-await-in-loop
    const handle = await uploadImage(token, path.join(imagesDir, card.image));
    const buttonType = card.buttonType === 'URL' ? 'URL' : 'QUICK_REPLY';
    if (buttonType === 'URL' && !card.buttonUrl) {
      throw new Error(`card "${card.image}" has buttonType URL but no buttonUrl`);
    }
    const button =
      buttonType === 'URL'
        ? { type: 'URL', text: card.buttonText || 'Visit Website', url: card.buttonUrl }
        : { type: 'QUICK_REPLY', text: card.buttonText || 'Get this recipe' };

    if (!card.body || !String(card.body).trim()) {
      throw new Error(`card "${card.image}" is missing body`);
    }

    cardsWithHandles.push({
      components: [
        { type: 'HEADER', format: 'IMAGE', example: { header_handle: [handle] } },
        // Always a {{1}} variable, never card.body typed in literally - see
        // the file-level comment above.
        { type: 'BODY', text: '{{1}}', example: { body_text: [[card.body]] } },
        { type: 'BUTTONS', buttons: [button] }
      ]
    });
  }

  const templateBody = {
    name: templateName,
    language: 'en_US',
    // Meta rejects category UTILITY for carousel templates - MARKETING is
    // the only category that currently supports the CAROUSEL component.
    category: 'MARKETING',
    components: [
      ...(spec.introText
        ? [
            {
              type: 'BODY',
              text: spec.introText,
              // An `example` is only meaningful (and only accepted by Meta)
              // when the body actually has a {{1}} variable to demonstrate.
              ...(spec.introText.includes('{{') ? { example: { body_text: [[spec.introExample || 'there']] } } : {})
            }
          ]
        : []),
      { type: 'CAROUSEL', cards: cardsWithHandles }
    ]
  };

  const res = await fetch(`https://graph.facebook.com/v20.0/${WABA_ID}/message_templates`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(templateBody)
  });
  const body = await res.json();
  console.log('status:', res.status);
  console.log(JSON.stringify(body, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
