const crypto = require('crypto');

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function computeHmacSha256Hex(secret, rawBody) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function verifyHmacSha256Hex({ secret, rawBody, signatureHex }) {
  if (!secret || !rawBody || !signatureHex) return false;
  const expected = computeHmacSha256Hex(secret, rawBody);
  return safeEqual(expected, signatureHex);
}

// Stripe's `Stripe-Signature` header looks like `t=1614556800,v1=<hex hmac>`
// (a v0 scheme may also be present alongside v1 - only v1 is checked here).
// The signed payload is `${timestamp}.${rawBody}`, not rawBody alone.
// During a webhook-secret rotation, Stripe can send multiple v1= signatures
// (one per active secret) - this keeps only the last one seen rather than
// checking all of them against `secret`, which is fine for a single active
// secret but could reject a valid delivery mid-rotation.
function parseStripeSignatureHeader(header) {
  const parts = String(header || '').split(',');
  const parsed = {};
  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key === 't') parsed.timestamp = value;
    if (key === 'v1') parsed.v1 = value;
  }
  return parsed;
}

function verifyStripeSignature({ secret, rawBody, header, toleranceSeconds = 300 }) {
  if (!secret || !rawBody || !header) return false;

  const { timestamp, v1 } = parseStripeSignatureHeader(header);
  if (!timestamp || !v1) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > toleranceSeconds) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = computeHmacSha256Hex(secret, signedPayload);
  return safeEqual(expected, v1);
}

module.exports = {
  computeHmacSha256Hex,
  verifyHmacSha256Hex,
  safeEqual,
  parseStripeSignatureHeader,
  verifyStripeSignature
};
