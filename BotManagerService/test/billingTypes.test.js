const test = require('node:test');
const assert = require('node:assert/strict');

const { BillingStatus, normalizeSubscriptionStatus } = require('../src/core/billing/billingTypes');

test('normalizeSubscriptionStatus maps Stripe subscription statuses to BillingStatus', () => {
  assert.equal(normalizeSubscriptionStatus('active'), BillingStatus.ACTIVE);
  assert.equal(normalizeSubscriptionStatus('trialing'), BillingStatus.TRIALING);
  assert.equal(normalizeSubscriptionStatus('past_due'), BillingStatus.PAST_DUE);
  assert.equal(normalizeSubscriptionStatus('unpaid'), BillingStatus.UNPAID);
  assert.equal(normalizeSubscriptionStatus('canceled'), BillingStatus.CANCELED);
  assert.equal(normalizeSubscriptionStatus('cancelled'), BillingStatus.CANCELED);
  assert.equal(normalizeSubscriptionStatus('paused'), BillingStatus.PAUSED);
  assert.equal(normalizeSubscriptionStatus('incomplete'), BillingStatus.INCOMPLETE);
  assert.equal(normalizeSubscriptionStatus('incomplete_expired'), BillingStatus.INCOMPLETE);
});

test('normalizeSubscriptionStatus defaults unknown/missing statuses to INCOMPLETE rather than throwing', () => {
  assert.equal(normalizeSubscriptionStatus('something_stripe_added_later'), BillingStatus.INCOMPLETE);
  assert.equal(normalizeSubscriptionStatus(undefined), BillingStatus.INCOMPLETE);
  assert.equal(normalizeSubscriptionStatus(null), BillingStatus.INCOMPLETE);
});
