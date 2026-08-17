/**
 * Submit Smart Laundry marketing templates (welcome_promo and/or
 * weekly_promo) to Meta Business Manager for review. Templates must be
 * approved before they can be used in outbound WhatsApp messages.
 *
 * This script uploads a header image and submits one or both templates
 * defined in config/laundryTemplates.js. It reuses the same
 * discoverAppId / uploadImage pattern as submitPromoTemplate.js.
 *
 * Usage:
 *   node scripts/submitLaundryTemplates.js <template-key> <image-path>
 *
 * <template-key> is one of: WELCOME_PROMO, WEEKLY_PROMO, or ALL
 *
 * Examples:
 *   node scripts/submitLaundryTemplates.js WELCOME_PROMO /tmp/laundry-welcome.jpg
 *   node scripts/submitLaundryTemplates.js WEEKLY_PROMO  /tmp/laundry-promo.jpg
 *   node scripts/submitLaundryTemplates.js ALL           /tmp/laundry-header.jpg
 *
 * Required environment variables:
 *   WHATSAPP_ACCESS_TOKEN_LAUNDRY - Graph API token with
 *                                   whatsapp_business_management scope.
 *   LAUNDRY_WABA_ID               - Laundry WABA ID. No default — must be
 *                                   set explicitly. Find it in Meta Business
 *                                   Manager > WhatsApp Accounts.
 *
 * After submission, check approval status with:
 *   node scripts/checkTemplateStatus.js laundry_welcome_promo
 *   node scripts/checkTemplateStatus.js laundry_weekly_promo
 *
 * See CATALOG_SETUP.md for the full workflow.
 */

require('dotenv').config();
const fs = require('fs');

const { TEMPLATES, buildTemplatePayload } = require('../config/laundryTemplates');

const API_VERSION = 'v20.0';

async function discoverAppId(token) {
  const res = await fetch(
    `https://graph.facebook.com/${API_VERSION}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`
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
    `https://graph.facebook.com/${API_VERSION}/${appId}/uploads?file_length=${buf.length}&file_type=image/jpeg&access_token=${encodeURIComponent(token)}`,
    { method: 'POST' }
  );
  const startBody = await startRes.json();
  if (!startBody.id) {
    throw new Error(`upload session start failed for ${filePath}: ${JSON.stringify(startBody)}`);
  }

  const uploadRes = await fetch(`https://graph.facebook.com/${API_VERSION}/${startBody.id}`, {
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

async function submitTemplate(token, wabaId, templateKey, headerHandle) {
  const payload = buildTemplatePayload(templateKey, headerHandle);
  console.log(`\nsubmitting template: ${payload.name}`);

  const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${wabaId}/message_templates`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await res.json();
  console.log('status:', res.status);
  console.log(JSON.stringify(body, null, 2));
  return res.ok && !body.error;
}

async function main() {
  const [templateKeyArg, imagePath] = process.argv.slice(2);
  const validKeys = [...Object.keys(TEMPLATES), 'ALL'];

  if (!templateKeyArg || !imagePath) {
    console.error(`Usage: node scripts/submitLaundryTemplates.js <${validKeys.join('|')}> <image-path>`);
    process.exitCode = 1;
    return;
  }

  const templateKeyUpper = templateKeyArg.toUpperCase();
  if (!validKeys.includes(templateKeyUpper)) {
    console.error(`Unknown template key "${templateKeyArg}". Valid keys: ${validKeys.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN_LAUNDRY;
  if (!token) {
    throw new Error('WHATSAPP_ACCESS_TOKEN_LAUNDRY is not set');
  }

  const wabaId = process.env.LAUNDRY_WABA_ID;
  if (!wabaId) {
    throw new Error('LAUNDRY_WABA_ID is not set — find it in Meta Business Manager > WhatsApp Accounts');
  }

  const appId = await discoverAppId(token);
  const headerHandle = await uploadImage(token, appId, imagePath);
  console.log('image uploaded, handle:', headerHandle);

  const keysToSubmit = templateKeyUpper === 'ALL' ? Object.keys(TEMPLATES) : [templateKeyUpper];

  let allOk = true;
  for (const key of keysToSubmit) {
    const ok = await submitTemplate(token, wabaId, key, headerHandle);
    if (!ok) allOk = false;
  }

  if (!allOk) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
