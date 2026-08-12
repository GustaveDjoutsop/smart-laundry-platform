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

test('WhatsAppCloudClient sendProductList builds a product_list interactive payload with sections', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.mpm' }] }) };
  };

  const client = new WhatsAppCloudClient({
    accessToken: 'token',
    phoneNumberId: '123',
    fetchImpl
  });

  await client.sendProductList({
    to: '237670000000',
    catalogId: '1678073176620294',
    header: 'Shop Online',
    body: 'Browse our groceries',
    footer: 'Tap the cart icon to check out',
    sections: [
      { title: 'Beans & Nuts', productRetailerIds: ['haricot_rouge_1kg', 'arachide_blanche_1kg'] },
      { title: 'Dried Leaves', productRetailerIds: ['ndole_250g'] }
    ]
  });

  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.messaging_product, 'whatsapp');
  assert.equal(payload.type, 'interactive');
  assert.equal(payload.interactive.type, 'product_list');
  assert.deepEqual(payload.interactive.header, { type: 'text', text: 'Shop Online' });
  assert.equal(payload.interactive.body.text, 'Browse our groceries');
  assert.equal(payload.interactive.footer.text, 'Tap the cart icon to check out');
  assert.deepEqual(payload.interactive.action, {
    catalog_id: '1678073176620294',
    sections: [
      { title: 'Beans & Nuts', product_items: [{ product_retailer_id: 'haricot_rouge_1kg' }, { product_retailer_id: 'arachide_blanche_1kg' }] },
      { title: 'Dried Leaves', product_items: [{ product_retailer_id: 'ndole_250g' }] }
    ]
  });
});

test('WhatsAppCloudClient sendProductList omits header/footer when not provided', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const client = new WhatsAppCloudClient({ accessToken: 'token', phoneNumberId: '123', fetchImpl });

  await client.sendProductList({
    to: '237670000000',
    catalogId: 'cat_1',
    body: 'Browse',
    sections: [{ title: 'Only Section', productRetailerIds: ['p1'] }]
  });

  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.interactive.header, undefined);
  assert.equal(payload.interactive.footer, undefined);
});

test('WhatsAppCloudClient sendProductList drops a section with no valid product items', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const client = new WhatsAppCloudClient({ accessToken: 'token', phoneNumberId: '123', fetchImpl });

  await client.sendProductList({
    to: '237670000000',
    catalogId: 'cat_1',
    body: 'Browse',
    sections: [
      { title: 'Empty Section', productRetailerIds: [] },
      { title: 'Real Section', productRetailerIds: ['p1'] }
    ]
  });

  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.interactive.action.sections.length, 1);
  assert.equal(payload.interactive.action.sections[0].title, 'Real Section');
});

test('WhatsAppCloudClient sendProductList rejects a missing catalogId', async () => {
  const client = new WhatsAppCloudClient({
    accessToken: 'token',
    phoneNumberId: '123',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) })
  });

  await assert.rejects(
    () => client.sendProductList({ to: '237670000000', body: 'x', sections: [{ title: 'A', productRetailerIds: ['p1'] }] }),
    /non-empty catalogId/
  );
});

test('WhatsAppCloudClient sendProductList rejects when no section has any valid items', async () => {
  const client = new WhatsAppCloudClient({
    accessToken: 'token',
    phoneNumberId: '123',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) })
  });

  await assert.rejects(
    () => client.sendProductList({ to: '237670000000', catalogId: 'cat_1', body: 'x', sections: [] }),
    /at least one non-empty section/
  );
});

test('WhatsAppCloudClient sendProductList rejects more than 30 total product items', async () => {
  const client = new WhatsAppCloudClient({
    accessToken: 'token',
    phoneNumberId: '123',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) })
  });

  const tooManyIds = Array.from({ length: 31 }, (_, i) => `p${i}`);

  await assert.rejects(
    () =>
      client.sendProductList({
        to: '237670000000',
        catalogId: 'cat_1',
        body: 'x',
        sections: [{ title: 'Huge Section', productRetailerIds: tooManyIds }]
      }),
    /at most 30 total product items/
  );
});

test('WhatsAppCloudClient uploadMedia downloads the image and uploads it to Meta, returning the media id', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url === 'https://example.com/dish.jpg') {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'image/jpeg' },
        arrayBuffer: async () => new ArrayBuffer(8)
      };
    }
    return { ok: true, status: 200, json: async () => ({ id: 'media_abc123' }) };
  };

  const client = new WhatsAppCloudClient({ accessToken: 'token', phoneNumberId: '123', fetchImpl });
  const mediaId = await client.uploadMedia({ link: 'https://example.com/dish.jpg' });

  assert.equal(mediaId, 'media_abc123');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://example.com/dish.jpg');
  assert.equal(calls[1].url, 'https://graph.facebook.com/v20.0/123/media');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer token');
});

test('WhatsAppCloudClient uploadMedia caches the media id and skips re-downloading/re-uploading on a repeat call', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url === 'https://example.com/cache-test-unique.jpg') {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'image/jpeg' },
        arrayBuffer: async () => new ArrayBuffer(8)
      };
    }
    return { ok: true, status: 200, json: async () => ({ id: 'media_cached_1' }) };
  };

  const client = new WhatsAppCloudClient({ accessToken: 'token', phoneNumberId: '123', fetchImpl });

  const first = await client.uploadMedia({ link: 'https://example.com/cache-test-unique.jpg' });
  assert.equal(first, 'media_cached_1');
  assert.equal(calls.length, 2);

  const second = await client.uploadMedia({ link: 'https://example.com/cache-test-unique.jpg' });
  assert.equal(second, 'media_cached_1');
  // No new fetch calls - served entirely from the cache.
  assert.equal(calls.length, 2);
});

test('WhatsAppCloudClient uploadMedia rejects when the image download fails', async () => {
  const client = new WhatsAppCloudClient({
    accessToken: 'token',
    phoneNumberId: '123',
    fetchImpl: async () => ({ ok: false, status: 404 })
  });

  await assert.rejects(() => client.uploadMedia({ link: 'https://example.com/missing.jpg' }), /failed to download/);
});

test('WhatsAppCloudClient uploadMedia retries a rate-limited (429) source image download and succeeds once it recovers', async () => {
  let downloadAttempts = 0;
  const fetchImpl = async (url) => {
    if (!url.includes('/media')) {
      downloadAttempts += 1;
      if (downloadAttempts < 3) return { ok: false, status: 429 };
      return { ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new ArrayBuffer(4) };
    }
    return { ok: true, status: 200, json: async () => ({ id: 'media_after_retry' }) };
  };

  const client = new WhatsAppCloudClient({ accessToken: 'token', phoneNumberId: '123', fetchImpl });
  const mediaId = await client.uploadMedia({ link: 'https://upload.wikimedia.org/retry-test.jpg' });

  assert.equal(mediaId, 'media_after_retry');
  assert.equal(downloadAttempts, 3);
});

test('WhatsAppCloudClient uploadMedia gives up after exhausting retries on a persistently rate-limited source image', async () => {
  let downloadAttempts = 0;
  const fetchImpl = async (url) => {
    if (!url.includes('/media')) {
      downloadAttempts += 1;
      return { ok: false, status: 429 };
    }
    return { ok: true, status: 200, json: async () => ({ id: 'unused' }) };
  };

  const client = new WhatsAppCloudClient({ accessToken: 'token', phoneNumberId: '123', fetchImpl });

  await assert.rejects(
    () => client.uploadMedia({ link: 'https://upload.wikimedia.org/persistent-429.jpg' }),
    /failed to download/
  );
  assert.equal(downloadAttempts, 3);
});

test('WhatsAppCloudClient uploadMedia rejects when Meta does not return a media id', async () => {
  const client = new WhatsAppCloudClient({
    accessToken: 'token',
    phoneNumberId: '123',
    fetchImpl: async (url) => {
      if (url.includes('/media')) return { ok: true, status: 200, json: async () => ({}) };
      return { ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new ArrayBuffer(4) };
    }
  });

  await assert.rejects(() => client.uploadMedia({ link: 'https://example.com/no-media-id.jpg' }), /uploadMedia failed/);
});

test('WhatsAppCloudClient sendCarouselTemplate uploads each card image and posts the correct carousel template payload', async () => {
  const calls = [];
  let mediaCounter = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url === 'https://graph.facebook.com/v20.0/123/messages') {
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.carousel' }] }) };
    }
    if (url.endsWith('/media')) {
      mediaCounter += 1;
      return { ok: true, status: 200, json: async () => ({ id: `media_${mediaCounter}` }) };
    }
    // image download
    return { ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new ArrayBuffer(4) };
  };

  const client = new WhatsAppCloudClient({ accessToken: 'token', phoneNumberId: '123', fetchImpl });

  const result = await client.sendCarouselTemplate({
    to: '237670000000',
    templateName: 'afromarket_west_african_recipes',
    languageCode: 'en_US',
    bodyParams: ['there'],
    cards: [
      { imageLink: 'https://example.com/jollof.jpg', quickReplyPayload: 'recipe_jollof_rice' },
      { imageLink: 'https://example.com/egusi.jpg', quickReplyPayload: 'recipe_egusi_soup' }
    ]
  });

  assert.deepEqual(result, { messages: [{ id: 'wamid.carousel' }] });

  const messagesCall = calls.find((c) => c.url === 'https://graph.facebook.com/v20.0/123/messages');
  const payload = JSON.parse(messagesCall.init.body);
  assert.equal(payload.messaging_product, 'whatsapp');
  assert.equal(payload.type, 'template');
  assert.equal(payload.template.name, 'afromarket_west_african_recipes');
  assert.deepEqual(payload.template.language, { code: 'en_US' });

  const [bodyComponent, carouselComponent] = payload.template.components;
  assert.equal(bodyComponent.type, 'body');
  assert.deepEqual(bodyComponent.parameters, [{ type: 'text', text: 'there' }]);

  assert.equal(carouselComponent.type, 'carousel');
  assert.equal(carouselComponent.cards.length, 2);
  assert.equal(carouselComponent.cards[0].card_index, 0);
  assert.deepEqual(carouselComponent.cards[0].components[0], {
    type: 'header',
    parameters: [{ type: 'image', image: { id: 'media_1' } }]
  });
  assert.deepEqual(carouselComponent.cards[0].components[1], {
    type: 'button',
    sub_type: 'quick_reply',
    index: '0',
    parameters: [{ type: 'payload', payload: 'recipe_jollof_rice' }]
  });
  assert.equal(carouselComponent.cards[1].card_index, 1);
  assert.equal(carouselComponent.cards[1].components[0].parameters[0].image.id, 'media_2');
  assert.equal(carouselComponent.cards[1].components[1].parameters[0].payload, 'recipe_egusi_soup');
});

test('WhatsAppCloudClient sendCarouselTemplate includes a per-card body parameter only when the card provides bodyText', async () => {
  let mediaCounter = 0;
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url === 'https://graph.facebook.com/v20.0/123/messages') {
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.restaurants-v2' }] }) };
    }
    if (url.endsWith('/media')) {
      mediaCounter += 1;
      return { ok: true, status: 200, json: async () => ({ id: `media_${mediaCounter}` }) };
    }
    return { ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new ArrayBuffer(4) };
  };

  const client = new WhatsAppCloudClient({ accessToken: 'token', phoneNumberId: '123', fetchImpl });

  await client.sendCarouselTemplate({
    to: '237670000000',
    templateName: 'afromarket_restaurants_v2',
    languageCode: 'en_US',
    cards: [
      { imageLink: 'https://example.com/a.jpg', quickReplyPayload: 'restaurant_a', bodyText: 'Restaurant A - blurb' },
      { imageLink: 'https://example.com/b.jpg', quickReplyPayload: 'restaurant_b' }
    ]
  });

  const messagesCall = calls.find((c) => c.url === 'https://graph.facebook.com/v20.0/123/messages');
  const payload = JSON.parse(messagesCall.init.body);
  const [carouselComponent] = payload.template.components;

  // Card with bodyText: header, body, buttons - in that order.
  assert.deepEqual(
    carouselComponent.cards[0].components.map((c) => c.type),
    ['header', 'body', 'button']
  );
  assert.deepEqual(carouselComponent.cards[0].components[1].parameters, [{ type: 'text', text: 'Restaurant A - blurb' }]);

  // Card without bodyText: header, buttons only - no empty/placeholder body component.
  assert.deepEqual(
    carouselComponent.cards[1].components.map((c) => c.type),
    ['header', 'button']
  );
});

test('WhatsAppCloudClient sendCarouselTemplate rejects an empty cards array', async () => {
  const client = new WhatsAppCloudClient({
    accessToken: 'token',
    phoneNumberId: '123',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) })
  });

  await assert.rejects(
    () => client.sendCarouselTemplate({ to: '237670000000', templateName: 'x', cards: [] }),
    /non-empty cards array/
  );
});

test('WhatsAppCloudClient sendCarouselTemplate rejects a card missing quickReplyPayload', async () => {
  const client = new WhatsAppCloudClient({
    accessToken: 'token',
    phoneNumberId: '123',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) })
  });

  await assert.rejects(
    () =>
      client.sendCarouselTemplate({
        to: '237670000000',
        templateName: 'x',
        cards: [{ imageLink: 'https://example.com/a.jpg' }]
      }),
    /missing quickReplyPayload/
  );
});

test('WhatsAppCloudClient sendCarouselTemplate builds a static URL-button carousel (no button parameters) for cards with buttonType "url"', async () => {
  const calls = [];
  let mediaCounter = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url === 'https://graph.facebook.com/v20.0/123/messages') {
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.restaurants' }] }) };
    }
    if (url.endsWith('/media')) {
      mediaCounter += 1;
      return { ok: true, status: 200, json: async () => ({ id: `media_${mediaCounter}` }) };
    }
    return { ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new ArrayBuffer(4) };
  };

  const client = new WhatsAppCloudClient({ accessToken: 'token', phoneNumberId: '123', fetchImpl });

  await client.sendCarouselTemplate({
    to: '237670000000',
    templateName: 'afromarket_restaurants_v1',
    languageCode: 'en_US',
    cards: [
      { imageLink: 'https://example.com/bantabaa.jpg', buttonType: 'url', url: 'https://bantabaafooddealer.eu/' },
      { imageLink: 'https://example.com/yajee.jpg', buttonType: 'url', url: 'https://www.yajee.de/' }
    ]
  });

  const messagesCall = calls.find((c) => c.url === 'https://graph.facebook.com/v20.0/123/messages');
  const payload = JSON.parse(messagesCall.init.body);
  const [carouselComponent] = payload.template.components;

  assert.equal(carouselComponent.type, 'carousel');
  assert.deepEqual(carouselComponent.cards[0].components[1], { type: 'button', sub_type: 'url', index: '0' });
  assert.deepEqual(carouselComponent.cards[1].components[1], { type: 'button', sub_type: 'url', index: '0' });
  // A static URL button has nothing to substitute, so no `parameters` key at all.
  assert.equal('parameters' in carouselComponent.cards[0].components[1], false);
});
