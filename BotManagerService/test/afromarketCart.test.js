const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatEuro,
  buildCartSummaryText,
  generateOrderNumber,
  findCurrentPromoProduct,
  computePercentOff,
  getPromoTemplateFooterDelayMs
} = require('../src/bots/afromarket/afromarketFlowPlugin');

function withPromoTemplateFooterDelayMsEnv(rawValue, fn) {
  const original = process.env.PROMO_TEMPLATE_FOOTER_DELAY_MS;
  if (rawValue === undefined) delete process.env.PROMO_TEMPLATE_FOOTER_DELAY_MS;
  else process.env.PROMO_TEMPLATE_FOOTER_DELAY_MS = rawValue;

  try {
    fn();
  } finally {
    // afromarketFlow.test.js relies on this staying '0' for speed (see its
    // file-level comment) - always restore it, success or not.
    if (original === undefined) delete process.env.PROMO_TEMPLATE_FOOTER_DELAY_MS;
    else process.env.PROMO_TEMPLATE_FOOTER_DELAY_MS = original;
  }
}

test('formatEuro formats amounts with two decimals and a euro sign', () => {
  assert.equal(formatEuro(3.5), '€3.50');
  assert.equal(formatEuro(0), '€0.00');
  assert.equal(formatEuro(12), '€12.00');
});

test('formatEuro treats non-numeric input as zero', () => {
  assert.equal(formatEuro(undefined), '€0.00');
  assert.equal(formatEuro(null), '€0.00');
  assert.equal(formatEuro('not a number'), '€0.00');
});

test('buildCartSummaryText reports an empty cart', () => {
  const text = buildCartSummaryText([]);
  assert.match(text, /cart is empty/);
});

test('buildCartSummaryText lists lines with per-line and grand totals', () => {
  const cart = [
    { productId: 'rice_1kg', name: 'Long-Grain Rice 1kg', unitPrice: 3.5, unit: '1 kg', qty: 2 },
    { productId: 'palm_oil_1l', name: 'Red Palm Oil 1L', unitPrice: 6.5, unit: '1 L', qty: 1 }
  ];
  const text = buildCartSummaryText(cart);

  assert.match(text, /2x Long-Grain Rice 1kg — €7\.00/);
  assert.match(text, /1x Red Palm Oil 1L — €6\.50/);
  assert.match(text, /Total: €13\.50/);
});

test('generateOrderNumber produces unique AM-prefixed codes', () => {
  const a = generateOrderNumber();
  const b = generateOrderNumber();
  assert.match(a, /^AM-[A-Z0-9]+$/);
  assert.match(b, /^AM-[A-Z0-9]+$/);
  assert.notEqual(a, b);
});

test('getPromoTemplateFooterDelayMs falls back to the 6000ms default when the env var is unset', () => {
  withPromoTemplateFooterDelayMsEnv(undefined, () => {
    assert.equal(getPromoTemplateFooterDelayMs(), 6000);
  });
});

test('getPromoTemplateFooterDelayMs reads a valid numeric env var, including 0', () => {
  withPromoTemplateFooterDelayMsEnv('1234', () => {
    assert.equal(getPromoTemplateFooterDelayMs(), 1234);
  });
  withPromoTemplateFooterDelayMsEnv('0', () => {
    assert.equal(getPromoTemplateFooterDelayMs(), 0);
  });
});

test('getPromoTemplateFooterDelayMs falls back to the default on a malformed value instead of NaN', () => {
  // Same guard as getCarouselFooterDelayMs, same reason: a malformed value
  // must never reach setTimeout as NaN - setTimeout(fn, NaN) behaves like
  // setTimeout(fn, 0), silently disabling the wait this function exists to
  // bound.
  withPromoTemplateFooterDelayMsEnv('6000ms', () => {
    assert.equal(getPromoTemplateFooterDelayMs(), 6000);
  });
});

test('getPromoTemplateFooterDelayMs falls back to the default on a negative value', () => {
  withPromoTemplateFooterDelayMsEnv('-100', () => {
    assert.equal(getPromoTemplateFooterDelayMs(), 6000);
  });
});

test('getPromoTemplateFooterDelayMs falls back to the default on a whitespace-only value', () => {
  // Number('   ') coerces to 0, not NaN - a JS quirk that would otherwise
  // silently disable the wait this function exists to bound (caught in
  // review, on this variable specifically - see the function's own comment
  // for why this diverges from getCarouselFooterDelayMs's accepted
  // behavior for that same coercion).
  withPromoTemplateFooterDelayMsEnv('   ', () => {
    assert.equal(getPromoTemplateFooterDelayMs(), 6000);
  });
});

test('findCurrentPromoProduct returns the product with a valid salePriceEur below priceEur', () => {
  const botConfig = {
    products: [
      { id: 'a', priceEur: 5 },
      { id: 'b', priceEur: 10, salePriceEur: 8 },
      { id: 'c', priceEur: 3, salePriceEur: 3 } // equal to priceEur - not a real discount
    ]
  };

  const product = findCurrentPromoProduct(botConfig);

  assert.equal(product.id, 'b');
});

test('findCurrentPromoProduct returns null when no product has an active sale price', () => {
  const botConfig = {
    products: [
      { id: 'a', priceEur: 5 },
      { id: 'b', priceEur: 3, salePriceEur: 3 },
      { id: 'c', priceEur: 4, salePriceEur: -1 }
    ]
  };

  assert.equal(findCurrentPromoProduct(botConfig), null);
});

test('computePercentOff derives the whole-number discount from priceEur/salePriceEur', () => {
  // Mirrors the real bouillie_jaune_500g config (4.99 -> 3.99) - must round
  // to a whole number since it's rendered as plain text in the template.
  assert.equal(computePercentOff({ priceEur: 4.99, salePriceEur: 3.99 }), 20);
  assert.equal(computePercentOff({ priceEur: 10, salePriceEur: 5 }), 50);
});
