const test = require('node:test');
const assert = require('node:assert/strict');

const { WhatsAppCloudClient, buildMessagesUrl } = require('../src/core/whatsapp/whatsappClient');

test('buildMessagesUrl formats Graph API URL', () => {
  const url = buildMessagesUrl({
    apiBase: 'https://graph.facebook.com/',
    apiVersion: 'v20.0',
    phoneNumberId: '123'
  });
  assert.equal(url, 'https://graph.facebook.com/v20.0/123/messages');
});

test('WhatsAppCloudClient sendText calls fetch with correct payload', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.1' }] })
    };
  };

  const client = new WhatsAppCloudClient({
    accessToken: 'token',
    phoneNumberId: '123',
    apiVersion: 'v20.0',
    apiBase: 'https://graph.facebook.com',
    fetchImpl
  });

  const result = await client.sendText({ to: '237670000000', body: 'Hello' });

  assert.deepEqual(result, { messages: [{ id: 'wamid.1' }] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://graph.facebook.com/v20.0/123/messages');

  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.messaging_product, 'whatsapp');
  assert.equal(payload.to, '237670000000');
  assert.equal(payload.type, 'text');
  assert.equal(payload.text.body, 'Hello');
});

test('WhatsAppCloudClient sendButtons calls fetch with interactive button payload', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.2' }] })
    };
  };

  const client = new WhatsAppCloudClient({
    accessToken: 'token',
    phoneNumberId: '123',
    apiVersion: 'v20.0',
    apiBase: 'https://graph.facebook.com',
    fetchImpl
  });

  const result = await client.sendButtons({
    to: '237670000000',
    body: 'Choose one',
    buttons: [
      { id: '1', title: 'One' },
      { id: '2', title: 'Two' },
      { id: '3', title: 'Three' },
      { id: '4', title: 'Four' }
    ]
  });

  assert.deepEqual(result, { messages: [{ id: 'wamid.2' }] });
  assert.equal(calls.length, 1);

  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.messaging_product, 'whatsapp');
  assert.equal(payload.to, '237670000000');
  assert.equal(payload.type, 'interactive');
  assert.equal(payload.interactive.type, 'button');
  assert.equal(payload.interactive.body.text, 'Choose one');
  assert.equal(payload.interactive.action.buttons.length, 3);
  assert.equal(payload.interactive.action.buttons[0].reply.id, '1');
  assert.equal(payload.interactive.action.buttons[0].reply.title, 'One');
});
