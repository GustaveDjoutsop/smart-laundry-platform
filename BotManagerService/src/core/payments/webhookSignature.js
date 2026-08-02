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
// During a webhook-secret rotation, Stripe sends multiple v1= signatures (one
// per active secret) - every v1 seen is collected so verifyStripeSignature
// can accept a match against any of them, not just the last one parsed.
function parseStripeSignatureHeader(header) {
  const parts = String(header || '').split(',');
  const parsed = { v1s: [] };
  for (const part of parts) {
    const [rawKey, rawValue] = part.split('=');
    const key = String(rawKey || '').trim();
    const value = String(rawValue || '').trim();
    if (key === 't') parsed.timestamp = value;
    if (key === 'v1') parsed.v1s.push(value);
  }
  return parsed;
}

function verifyStripeSignature({ secret, rawBody, header, toleranceSeconds = 300 }) {
  if (!secret || !rawBody || !header) return false;

  const { timestamp, v1s } = parseStripeSignatureHeader(header);
  if (!timestamp || !v1s.length) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > toleranceSeconds) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = computeHmacSha256Hex(secret, signedPayload);
  return v1s.some((v1) => safeEqual(expected, v1));
}

module.exports = {
  computeHmacSha256Hex,
  verifyHmacSha256Hex,
  safeEqual,
  parseStripeSignatureHeader,
  verifyStripeSignature
};
