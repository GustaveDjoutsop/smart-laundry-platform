/**
 * One-off tool to set a WhatsApp Business phone number's profile photo via
 * the Cloud API directly, bypassing Meta Business Suite's web uploader
 * (which has a reproducible client-side JS crash - "n.toError is not a
 * function" - on the profile-picture upload widget as of 2026-08).
 *
 * Usage:
 *   node scripts/setWhatsAppProfilePhoto.js <phone-number-id> <image-path>
 *
 * Requires WHATSAPP_ACCESS_TOKEN_AFROMARKET (env or .env) with
 * whatsapp_business_management scope for the target phone number's app.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

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

const MIME_TYPES_BY_EXTENSION = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

async function uploadImage(token, appId, filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const fileType = MIME_TYPES_BY_EXTENSION[ext];
  if (!fileType) {
    throw new Error(`unsupported image extension "${ext}" - use .png, .jpg, or .jpeg`);
  }

  const startRes = await fetch(
    `https://graph.facebook.com/v20.0/${appId}/uploads?file_length=${buf.length}&file_type=${fileType}&access_token=${encodeURIComponent(token)}`,
    { method: 'POST' }
  );
  const startBody = await startRes.json();
  if (!startBody.id) {
    throw new Error(`upload session start failed: ${JSON.stringify(startBody)}`);
  }

  const uploadRes = await fetch(`https://graph.facebook.com/v20.0/${startBody.id}`, {
    method: 'POST',
    headers: { Authorization: 'OAuth ' + token, file_offset: '0' },
    body: buf
  });
  const uploadBody = await uploadRes.json();
  if (!uploadBody.h) {
    throw new Error(`upload failed: ${JSON.stringify(uploadBody)}`);
  }
  return uploadBody.h;
}

async function main() {
  const [phoneNumberId, imagePath] = process.argv.slice(2);
  if (!phoneNumberId || !imagePath) {
    console.error('Usage: node scripts/setWhatsAppProfilePhoto.js <phone-number-id> <image-path>');
    process.exitCode = 1;
    return;
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN_AFROMARKET;
  if (!token) {
    throw new Error('WHATSAPP_ACCESS_TOKEN_AFROMARKET is not set');
  }

  const appId = await discoverAppId(token);
  console.log('using app_id:', appId);

  const handle = await uploadImage(token, appId, imagePath);
  console.log('uploaded, handle:', handle);

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/whatsapp_business_profile`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', profile_picture_handle: handle })
  });
  const body = await res.json();
  console.log('status:', res.status);
  console.log(JSON.stringify(body, null, 2));
  if (!res.ok) {
    throw new Error(`whatsapp_business_profile update failed: ${JSON.stringify(body)}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
