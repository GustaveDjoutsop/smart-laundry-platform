const test = require('node:test');
const assert = require('node:assert/strict');

const { assertValidPhoneNumber, buildProductLink, toCatalogItem, buildBatchRequestBody } = require('../scripts/submitCatalogBatch');

test('buildProductLink builds a wa.me deep link prefilled with the product name', () => {
  // when
  const link = buildProductLink('4915123456789', { name: "Ndolè Cameroun 250g" });

  // then
  assert.equal(link, `https://wa.me/4915123456789?text=${encodeURIComponent("Hi! I'd like to order Ndolè Cameroun 250g")}`);
});

test('toCatalogItem maps a bot.json product onto the Catalog Batch UPDATE shape', () => {
  // given
  const product = {
    id: 'ndole_250g',
    name: 'Ndolè Cameroun 250g',
    priceEur: 9.99,
    imageUrl: 'https://legal.botmanagementservice.eu/products/afromarket-ndole-250g.jpg',
    description: 'Washed and dried Cameroonian Ndolè leaves.'
  };

  // when
  const item = toCatalogItem({ product, currency: 'EUR', phoneNumber: '4915123456789' });

  // then
  assert.equal(item.method, 'UPDATE');
  assert.equal(item.data.id, 'ndole_250g');
  assert.equal(item.data.title, 'Ndolè Cameroun 250g');
  assert.equal(item.data.description, 'Washed and dried Cameroonian Ndolè leaves.');
  assert.equal(item.data.brand, 'AfroMarket');
  assert.equal(item.data.price, '9.99 EUR');
  assert.equal(item.data.availability, 'in stock');
  assert.equal(item.data.condition, 'new');
  assert.equal(item.data.image_link, product.imageUrl);
  assert.match(item.data.link, /^https:\/\/wa\.me\/4915123456789\?text=/);
});

test('toCatalogItem formats a whole-euro price with two decimal places', () => {
  // when
  const item = toCatalogItem({
    product: { id: 'p1', name: 'Item', priceEur: 8, imageUrl: 'https://example.com/p1.jpg' },
    currency: 'EUR',
    phoneNumber: '4915123456789'
  });

  // then
  assert.equal(item.data.price, '8.00 EUR');
});

test('toCatalogItem falls back to the product name when description is missing', () => {
  // when
  const item = toCatalogItem({
    product: { id: 'p1', name: 'Item', priceEur: 1.5, imageUrl: 'https://example.com/p1.jpg' },
    currency: 'EUR',
    phoneNumber: '4915123456789'
  });

  // then
  assert.equal(item.data.description, 'Item');
});

test('toCatalogItem accepts a free item priced at zero instead of treating it as a missing field', () => {
  // when
  const item = toCatalogItem({
    product: { id: 'p1', name: 'Item', priceEur: 0, imageUrl: 'https://example.com/p1.jpg' },
    currency: 'EUR',
    phoneNumber: '4915123456789'
  });

  // then
  assert.equal(item.data.price, '0.00 EUR');
});

test('toCatalogItem throws when priceEur is missing entirely', () => {
  // given
  const product = { id: 'p1', name: 'Item', imageUrl: 'https://example.com/p1.jpg' }; // no priceEur

  // when / then
  assert.throws(() => toCatalogItem({ product, currency: 'EUR', phoneNumber: '4915123456789' }), /missing required field/);
});

test('toCatalogItem throws when priceEur is not a valid number', () => {
  // given
  const product = { id: 'p1', name: 'Item', priceEur: 'free', imageUrl: 'https://example.com/p1.jpg' };

  // when / then
  assert.throws(() => toCatalogItem({ product, currency: 'EUR', phoneNumber: '4915123456789' }), /missing required field/);
});

test('toCatalogItem throws when id is missing', () => {
  // given
  const product = { name: 'Item', priceEur: 1.5, imageUrl: 'https://example.com/p1.jpg' };

  // when / then
  assert.throws(() => toCatalogItem({ product, currency: 'EUR', phoneNumber: '4915123456789' }), /missing required field/);
});

test('toCatalogItem throws when name is missing', () => {
  // given
  const product = { id: 'p1', priceEur: 1.5, imageUrl: 'https://example.com/p1.jpg' };

  // when / then
  assert.throws(() => toCatalogItem({ product, currency: 'EUR', phoneNumber: '4915123456789' }), /missing required field/);
});

test('toCatalogItem throws when imageUrl is missing', () => {
  // given
  const product = { id: 'p1', name: 'Item', priceEur: 1.5 };

  // when / then
  assert.throws(() => toCatalogItem({ product, currency: 'EUR', phoneNumber: '4915123456789' }), /missing required field/);
});

test('assertValidPhoneNumber accepts digits-only E.164 without a leading plus', () => {
  // when / then
  assert.doesNotThrow(() => assertValidPhoneNumber('4915123456789'));
});

test('assertValidPhoneNumber rejects a leading plus', () => {
  // when / then
  assert.throws(() => assertValidPhoneNumber('+4915123456789'), /must be digits only/);
});

test('assertValidPhoneNumber rejects non-digit characters', () => {
  // when / then
  assert.throws(() => assertValidPhoneNumber('4915 123 456789'), /must be digits only/);
});

test('buildBatchRequestBody maps every product in the bot config into one items_batch request', () => {
  // given
  const botConfig = {
    currency: 'EUR',
    products: [
      { id: 'p1', name: 'One', priceEur: 1, imageUrl: 'https://example.com/p1.jpg' },
      { id: 'p2', name: 'Two', priceEur: 2, imageUrl: 'https://example.com/p2.jpg' }
    ]
  };

  // when
  const body = buildBatchRequestBody({ botConfig, phoneNumber: '4915123456789' });

  // then
  assert.equal(body.item_type, 'PRODUCT_ITEM');
  assert.equal(body.allow_upsert, true);
  assert.equal(body.requests.length, 2);
  assert.deepEqual(
    body.requests.map((r) => r.data.id),
    ['p1', 'p2']
  );
});

test('buildBatchRequestBody throws when the bot config has no products', () => {
  // when / then
  assert.throws(() => buildBatchRequestBody({ botConfig: { products: [] }, phoneNumber: '4915123456789' }), /no products found/);
});

test('buildBatchRequestBody defaults to EUR when the bot config has no currency', () => {
  // given
  const botConfig = { products: [{ id: 'p1', name: 'One', priceEur: 1, imageUrl: 'https://example.com/p1.jpg' }] };

  // when
  const body = buildBatchRequestBody({ botConfig, phoneNumber: '4915123456789' });

  // then
  assert.equal(body.requests[0].data.price, '1.00 EUR');
});
