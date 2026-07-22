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

    cardsWithHandles.push({
      components: [
        { type: 'HEADER', format: 'IMAGE', example: { header_handle: [handle] } },
        { type: 'BODY', text: card.body },
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
