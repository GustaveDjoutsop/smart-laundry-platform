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

module.exports = { computeHmacSha256Hex, verifyHmacSha256Hex, safeEqual };
