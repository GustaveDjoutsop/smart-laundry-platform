const crypto = require('crypto');

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function computeWhatsAppSignature(appSecret, rawBody) {
  return (
    'sha256=' +
    crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')
  );
}

function verifyWhatsAppSignature({ appSecret, rawBody, signatureHeader }) {
  if (!appSecret || !rawBody || !signatureHeader) return false;
  const expected = computeWhatsAppSignature(appSecret, rawBody);
  return safeEqual(expected, signatureHeader);
}

module.exports = { verifyWhatsAppSignature, computeWhatsAppSignature };
