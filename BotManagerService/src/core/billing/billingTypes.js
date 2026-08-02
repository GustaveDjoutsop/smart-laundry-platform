const BillingStatus = {
  INCOMPLETE: 'INCOMPLETE',
  TRIALING: 'TRIALING',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  UNPAID: 'UNPAID',
  CANCELED: 'CANCELED',
  PAUSED: 'PAUSED'
};

// Stripe's own subscription.status values map almost 1:1 - normalized so
// callers (billingService, routes) never branch on Stripe's raw strings.
function normalizeSubscriptionStatus(status) {
  const normalizedStatusText = String(status || '').toUpperCase();

  if (['INCOMPLETE', 'INCOMPLETE_EXPIRED'].includes(normalizedStatusText)) return BillingStatus.INCOMPLETE;
  if (normalizedStatusText === 'TRIALING') return BillingStatus.TRIALING;
  if (normalizedStatusText === 'ACTIVE') return BillingStatus.ACTIVE;
  if (normalizedStatusText === 'PAST_DUE') return BillingStatus.PAST_DUE;
  if (normalizedStatusText === 'UNPAID') return BillingStatus.UNPAID;
  if (['CANCELED', 'CANCELLED'].includes(normalizedStatusText)) return BillingStatus.CANCELED;
  if (normalizedStatusText === 'PAUSED') return BillingStatus.PAUSED;

  return BillingStatus.INCOMPLETE;
}

module.exports = { BillingStatus, normalizeSubscriptionStatus };
