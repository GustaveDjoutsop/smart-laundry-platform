const test = require('node:test');
const assert = require('node:assert/strict');

const { redactString } = require('../src/utils/redact');

test('redactString redacts bearer tokens, env secrets, and phone numbers', () => {
  const input = [
    'Authorization: Bearer abc.def.ghi',
    'WHATSAPP_ACCESS_TOKEN_THOMAS_NETWORK=EAAMjQXl3HSIBQrpZAnQQIYthZC43op8HgzwpJRpf1vq8ham1v0KF3dDNzp9s6tcPZ',
    'Call me at +491739078561 or +237670000000',
    'CAMPAY_WEBHOOK_SECRET=supersecret'
  ].join(' | ');

  const out = redactString(input);
  assert.ok(!out.includes('abc.def.ghi'));
  assert.ok(!out.includes('EAAMjQXl3HSIBQrp'));
  assert.ok(!out.includes('+491739078561'));
  assert.ok(!out.includes('+237670000000'));
  assert.ok(out.includes('[REDACTED_PHONE]'));
  assert.ok(out.includes('[REDACTED]') || out.includes('[REDACTED_TOKEN]'));
});
