const test = require('node:test');
const assert = require('node:assert/strict');

const { validateProduct, validateCatalog, SUPPORTED_CURRENCIES } = require('../services/catalogValidation');

// ── validateProduct ──────────────────────────────────────────────────────────

function validProduct(overrides = {}) {
  return {
    retailerId: 'laundry-wash-standard',
    name: 'Standard Wash',
    description: 'A full machine wash cycle.',
    categoryId: 'washing',
    price: 5.50,
    currency: 'EUR',
    imageUrl: 'https://example.com/wash.jpg',
    availability: 'in stock',
    ...overrides
  };
}

test('validateProduct returns no errors for a fully valid product', () => {
  assert.deepEqual(validateProduct(validProduct()), []);
});

test('validateProduct returns an error for a null product', () => {
  const errors = validateProduct(null);
  assert.ok(errors.length > 0);
  assert.ok(errors[0].includes('non-null object'));
});

test('validateProduct rejects missing retailerId', () => {
  const errors = validateProduct(validProduct({ retailerId: '' }));
  assert.ok(errors.some((e) => e.includes('retailerId')));
});

test('validateProduct rejects missing name', () => {
  const errors = validateProduct(validProduct({ name: undefined }));
  assert.ok(errors.some((e) => e.includes('name')));
});

test('validateProduct rejects missing description', () => {
  const errors = validateProduct(validProduct({ description: '   ' }));
  assert.ok(errors.some((e) => e.includes('description')));
});

test('validateProduct rejects missing categoryId', () => {
  const errors = validateProduct(validProduct({ categoryId: null }));
  assert.ok(errors.some((e) => e.includes('categoryId')));
});

test('validateProduct rejects non-finite price', () => {
  const errors = validateProduct(validProduct({ price: 'oops' }));
  assert.ok(errors.some((e) => e.includes('price')));
});

test('validateProduct rejects null price', () => {
  const errors = validateProduct(validProduct({ price: null }));
  assert.ok(errors.some((e) => e.includes('price')));
});

test('validateProduct rejects negative price', () => {
  const errors = validateProduct(validProduct({ price: -1 }));
  assert.ok(errors.some((e) => e.includes('price')));
});

test('validateProduct accepts price of zero', () => {
  const errors = validateProduct(validProduct({ price: 0 }));
  assert.ok(!errors.some((e) => e.includes('price')));
});

test('validateProduct rejects unsupported currency', () => {
  const errors = validateProduct(validProduct({ currency: 'BTC' }));
  assert.ok(errors.some((e) => e.includes('currency')));
});

test('validateProduct accepts all supported currencies', () => {
  for (const currency of SUPPORTED_CURRENCIES) {
    const errors = validateProduct(validProduct({ currency }));
    assert.ok(!errors.some((e) => e.includes('currency')), `expected no currency error for ${currency}`);
  }
});

test('validateProduct rejects missing imageUrl', () => {
  const errors = validateProduct(validProduct({ imageUrl: undefined }));
  assert.ok(errors.some((e) => e.includes('imageUrl')));
});

test('validateProduct rejects non-HTTP imageUrl', () => {
  const errors = validateProduct(validProduct({ imageUrl: 'ftp://example.com/img.jpg' }));
  assert.ok(errors.some((e) => e.includes('imageUrl')));
});

test('validateProduct rejects invalid availability value', () => {
  const errors = validateProduct(validProduct({ availability: 'maybe' }));
  assert.ok(errors.some((e) => e.includes('availability')));
});

test('validateProduct accepts all valid availability values', () => {
  for (const avail of ['in stock', 'out of stock', 'preorder']) {
    const errors = validateProduct(validProduct({ availability: avail }));
    assert.ok(!errors.some((e) => e.includes('availability')), `expected no availability error for "${avail}"`);
  }
});

// ── validateCatalog ──────────────────────────────────────────────────────────

test('validateCatalog returns an error for a null catalog', () => {
  const errors = validateCatalog(null);
  assert.ok(errors.length > 0);
  assert.ok(errors[0].includes('non-null object'));
});

test('validateCatalog returns an error for an empty products array', () => {
  const errors = validateCatalog({ products: [] });
  assert.ok(errors.some((e) => e.includes('non-empty array')));
});

test('validateCatalog returns no errors for a catalog with one valid product', () => {
  const catalog = { products: [validProduct()] };
  assert.deepEqual(validateCatalog(catalog), []);
});

test('validateCatalog aggregates errors from invalid products', () => {
  const catalog = {
    products: [
      validProduct({ name: '' }),
      validProduct({ retailerId: 'other', price: -5 })
    ]
  };
  const errors = validateCatalog(catalog);
  assert.ok(errors.some((e) => e.includes('products[0]') && e.includes('name')));
  assert.ok(errors.some((e) => e.includes('products[1]') && e.includes('price')));
});

test('validateCatalog detects duplicate retailerIds', () => {
  const catalog = {
    products: [
      validProduct({ retailerId: 'dup-id' }),
      validProduct({ retailerId: 'dup-id', name: 'Another' })
    ]
  };
  const errors = validateCatalog(catalog);
  assert.ok(errors.some((e) => e.includes('duplicate retailerId') && e.includes('dup-id')));
});

test('validateCatalog allows unique retailerIds across multiple products', () => {
  const catalog = {
    products: [
      validProduct({ retailerId: 'id-1' }),
      validProduct({ retailerId: 'id-2', name: 'Product 2' }),
      validProduct({ retailerId: 'id-3', name: 'Product 3' })
    ]
  };
  assert.deepEqual(validateCatalog(catalog), []);
});
