// Covers getActivePaymentProvider() in isolation: the single source of truth
// for which payment provider AfroMarket checkout uses. See
// afromarketPaymentCheckout.test.js (Stripe path) and
// afromarketPaypalCheckout.test.js (PayPal path) for the selector wired into
// an actual checkout flow.
const test = require('node:test');
const assert = require('node:assert/strict');

const { getActivePaymentProvider } = require('../src/bots/afromarket/afromarketFlowPlugin');

test('getActivePaymentProvider defaults to paypal when AFROMARKET_PAYMENT_PROVIDER is unset', () => {
  delete process.env.AFROMARKET_PAYMENT_PROVIDER;

  assert.equal(getActivePaymentProvider(), 'paypal');
});

test('getActivePaymentProvider returns stripe when explicitly set to "stripe"', () => {
  process.env.AFROMARKET_PAYMENT_PROVIDER = 'stripe';

  assert.equal(getActivePaymentProvider(), 'stripe');

  delete process.env.AFROMARKET_PAYMENT_PROVIDER;
});

test('getActivePaymentProvider is case/whitespace-insensitive', () => {
  process.env.AFROMARKET_PAYMENT_PROVIDER = '  Stripe  ';

  assert.equal(getActivePaymentProvider(), 'stripe');

  delete process.env.AFROMARKET_PAYMENT_PROVIDER;
});

test('getActivePaymentProvider falls back to paypal (with a warning, not a throw) on garbage input', () => {
  process.env.AFROMARKET_PAYMENT_PROVIDER = 'flutterwave';

  assert.equal(getActivePaymentProvider(), 'paypal');

  delete process.env.AFROMARKET_PAYMENT_PROVIDER;
});
