const test = require('node:test');
const assert = require('node:assert/strict');

const { computeWhatsAppSignature, verifyWhatsAppSignature } = require('../src/handlers/whatsappSignature');

test('verifyWhatsAppSignature accepts correct signature', () => {
  const appSecret = 'secret';
  const rawBody = Buffer.from('{"hello":"world"}');
  const signatureHeader = computeWhatsAppSignature(appSecret, rawBody);

  assert.equal(
    verifyWhatsAppSignature({ appSecret, rawBody, signatureHeader }),
    true
  );
});

test('verifyWhatsAppSignature rejects incorrect signature', () => {
  const appSecret = 'secret';
  const rawBody = Buffer.from('{"hello":"world"}');

  assert.equal(
    verifyWhatsAppSignature({ appSecret, rawBody, signatureHeader: 'sha256=deadbeef' }),
    false
  );
});
