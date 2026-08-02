const { logger } = require('../../utils/logger');
const { StripeBillingProvider } = require('./billingProvider');
const { BillingStore } = require('./billingStore');
const { BillingGateway } = require('./billingGateway');
const { billingEvents } = require('./billingEvents');

let cached;

function getBillingService() {
  if (cached) return cached;

  if (process.env.SANDBOX_SECRET_KEY && !process.env.SANDBOX_WEBHOOK_SECRET) {
    logger.warn(
      'SANDBOX_SECRET_KEY is set but SANDBOX_WEBHOOK_SECRET is not - ' +
        'every Stripe billing webhook will be rejected (fail-closed) until it is configured'
    );
  }

  const provider = new StripeBillingProvider({
    secretKey: process.env.SANDBOX_SECRET_KEY,
    webhookSecret: process.env.SANDBOX_WEBHOOK_SECRET,
    baseUrl: process.env.STRIPE_BILLING_BASE_URL || 'https://api.stripe.com/v1',
    successUrl: process.env.STRIPE_BILLING_SUCCESS_URL,
    cancelUrl: process.env.STRIPE_BILLING_CANCEL_URL,
    portalReturnUrl: process.env.STRIPE_BILLING_PORTAL_RETURN_URL,
    logger
  });

  const store = new BillingStore();
  const gateway = new BillingGateway({ provider, store, events: billingEvents, logger });

  cached = {
    gateway,
    store,
    events: billingEvents
  };

  return cached;
}

module.exports = { getBillingService };
