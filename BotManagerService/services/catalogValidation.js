/**
 * Validation helpers for Meta Commerce Catalog product and category data.
 *
 * All functions are pure (no side effects, no network calls) so they are
 * straightforward to unit-test without any mocking. See
 * test/laundryCatalogValidation.test.js for the test suite.
 */

const SUPPORTED_CURRENCIES = new Set(['EUR', 'USD', 'GBP', 'XAF', 'XOF']);
const VALID_AVAILABILITY = new Set(['in stock', 'out of stock', 'preorder']);

/**
 * Validates a single product object.
 *
 * @param {object} product
 * @returns {string[]} array of error messages (empty means valid)
 */
function validateProduct(product) {
  const errors = [];

  if (!product || typeof product !== 'object') {
    return ['product must be a non-null object'];
  }

  if (!product.retailerId || typeof product.retailerId !== 'string' || !product.retailerId.trim()) {
    errors.push('product.retailerId is required and must be a non-empty string');
  }

  if (!product.name || typeof product.name !== 'string' || !product.name.trim()) {
    errors.push('product.name is required and must be a non-empty string');
  }

  if (!product.description || typeof product.description !== 'string' || !product.description.trim()) {
    errors.push('product.description is required and must be a non-empty string');
  }

  if (!product.categoryId || typeof product.categoryId !== 'string' || !product.categoryId.trim()) {
    errors.push('product.categoryId is required and must be a non-empty string');
  }

  const price = Number(product.price);
  if (product.price == null || !Number.isFinite(price)) {
    errors.push('product.price must be a finite number');
  } else if (price < 0) {
    errors.push('product.price must be >= 0');
  }

  const currency = product.currency;
  if (!currency || typeof currency !== 'string') {
    errors.push('product.currency is required');
  } else if (!SUPPORTED_CURRENCIES.has(currency.toUpperCase())) {
    errors.push(`product.currency "${currency}" is not supported (supported: ${[...SUPPORTED_CURRENCIES].join(', ')})`);
  }

  if (!product.imageUrl || typeof product.imageUrl !== 'string' || !product.imageUrl.trim()) {
    errors.push(`product.imageUrl is required — set the corresponding LAUNDRY_IMG_* environment variable`);
  } else if (!/^https?:\/\/.+/.test(product.imageUrl)) {
    errors.push(`product.imageUrl must be an absolute HTTP(S) URL (got "${product.imageUrl}")`);
  }

  if (!product.availability || !VALID_AVAILABILITY.has(product.availability)) {
    errors.push(`product.availability must be one of: ${[...VALID_AVAILABILITY].join(', ')}`);
  }

  return errors;
}

/**
 * Validates an entire catalog (categories + products), including uniqueness
 * checks across the full set. Returns an aggregated list of all errors.
 *
 * @param {{ categories?: object[], products?: object[], currency?: string }} catalog
 * @returns {string[]} all validation errors (empty means valid)
 */
function validateCatalog(catalog) {
  const errors = [];

  if (!catalog || typeof catalog !== 'object') {
    return ['catalog must be a non-null object'];
  }

  const products = Array.isArray(catalog.products) ? catalog.products : [];

  if (products.length === 0) {
    errors.push('catalog.products must be a non-empty array');
  }

  // Check for duplicate retailerIds
  const seenIds = new Map();
  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const id = product && product.retailerId;

    if (id) {
      if (seenIds.has(id)) {
        errors.push(`duplicate retailerId "${id}" at index ${i} (first seen at index ${seenIds.get(id)})`);
      } else {
        seenIds.set(id, i);
      }
    }

    const productErrors = validateProduct(product);
    for (const err of productErrors) {
      errors.push(`products[${i}]: ${err}`);
    }
  }

  return errors;
}

module.exports = { validateProduct, validateCatalog, SUPPORTED_CURRENCIES };
