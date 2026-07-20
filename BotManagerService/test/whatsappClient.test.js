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

test('WhatsAppCloudClient sendButtons includes an image header when image is provided', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.4' }] }) };
  };

  const client = new WhatsAppCloudClient({
    accessToken: 'token',
    phoneNumberId: '123',
    apiVersion: 'v20.0',
    apiBase: 'https://graph.facebook.com',
    fetchImpl
  });

  await client.sendButtons({
    to: '237670000000',
    body: 'Dish A',
    buttons: [{ id: 'get_a', title: 'Get this recipe' }],
    image: 'https://example.com/dish.jpg'
  });

  const payload = JSON.parse(calls[0].init.body);
  assert.deepEqual(payload.interactive.header, { type: 'image', image: { link: 'https://example.com/dish.jpg' } });
});

test('WhatsAppCloudClient sendButtons omits the header entirely when no image is given', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.5' }] }) };
  };

  const client = new WhatsAppCloudClient({
    accessToken: 'token',
    phoneNumberId: '123',
    apiVersion: 'v20.0',
    apiBase: 'https://graph.facebook.com',
    fetchImpl
  });

  await client.sendButtons({ to: '237670000000', body: 'No image', buttons: [{ id: 'x', title: 'X' }] });

  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.interactive.header, undefined);
});

test('WhatsAppCloudClient sendImage calls fetch with image payload and truncates long captions', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.3' }] })
    };
  };

  const client = new WhatsAppCloudClient({
    accessToken: 'token',
    phoneNumberId: '123',
    apiVersion: 'v20.0',
    apiBase: 'https://graph.facebook.com',
    fetchImpl
  });

  const longCaption = 'x'.repeat(2000);
  const result = await client.sendImage({
    to: '237670000000',
    link: 'https://example.com/dish.jpg',
    caption: longCaption
  });

  assert.deepEqual(result, { messages: [{ id: 'wamid.3' }] });
  assert.equal(calls.length, 1);

  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.messaging_product, 'whatsapp');
  assert.equal(payload.type, 'image');
  assert.equal(payload.image.link, 'https://example.com/dish.jpg');
  assert.equal(payload.image.caption.length, 1024);
});

test('WhatsAppCloudClient sendImage rejects missing link', async () => {
  const client = new WhatsAppCloudClient({
    accessToken: 'token',
    phoneNumberId: '123',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) })
  });

  await assert.rejects(() => client.sendImage({ to: '237670000000', caption: 'no link' }), /non-empty link/);
});

test('WhatsAppCloudClient sendCtaUrl builds a freeform cta_url interactive payload with image header', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.6' }] }) };
  };

  const client = new WhatsAppCloudClient({
    accessToken: 'token',
    phoneNumberId: '123',
    apiVersion: 'v20.0',
    apiBase: 'https://graph.facebook.com',
    fetchImpl
  });

  await client.sendCtaUrl({
    to: '237670000000',
    body: 'Le Petit Dakar — Senegalese',
    image: 'https://example.com/dakar.jpg',
    buttonText: 'Visit Website',
    url: 'https://www.lepetitdakar.com/en',
    footer: 'Opens in your browser'
  });

  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.messaging_product, 'whatsapp');
  assert.equal(payload.type, 'interactive');
  assert.equal(payload.interactive.type, 'cta_url');
  assert.deepEqual(payload.interactive.header, { type: 'image', image: { link: 'https://example.com/dakar.jpg' } });
  assert.equal(payload.interactive.body.text, 'Le Petit Dakar — Senegalese');
  assert.deepEqual(payload.interactive.action, {
    name: 'cta_url',
    parameters: { display_text: 'Visit Website', url: 'https://www.lepetitdakar.com/en' }
  });
  assert.equal(payload.interactive.footer.text, 'Opens in your browser');
});

test('WhatsAppCloudClient sendCtaUrl omits header/footer when not provided and truncates a long button label', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const client = new WhatsAppCloudClient({
    accessToken: 'token',
    phoneNumberId: '123',
    fetchImpl
  });

  await client.sendCtaUrl({
    to: '237670000000',
    body: 'No image here',
    buttonText: 'This label is way too long for a button',
    url: 'https://example.com'
  });

  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.interactive.header, undefined);
  assert.equal(payload.interactive.footer, undefined);
  assert.equal(payload.interactive.action.parameters.display_text.length, 20);
});

test('WhatsAppCloudClient sendCtaUrl rejects a missing url', async () => {
  const client = new WhatsAppCloudClient({
    accessToken: 'token',
    phoneNumberId: '123',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) })
  });

  await assert.rejects(() => client.sendCtaUrl({ to: '237670000000', body: 'x' }), /non-empty url/);
});
