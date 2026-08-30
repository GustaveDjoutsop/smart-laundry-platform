const { logger } = require('../../utils/logger');
const { PaymentGateway } = require('./paymentGateway');
const { PaymentStore } = require('./paymentStore');
const { paymentEvents } = require('./paymentEvents');
const { CamPayProvider } = require('./providers/campayProvider');
const { MtnMomoProvider } = require('./providers/mtnMomoProvider');
const { StripeProvider } = require('./providers/stripeProvider');
const { PayPalProvider } = require('./providers/paypalProvider');

let cached;

function getPaymentService() {
  if (cached) return cached;

  const providers = {};

  if (process.env.CAMPAY_TOKEN) {
    providers.campay = new CamPayProvider({
      token: process.env.CAMPAY_TOKEN,
      baseUrl: process.env.CAMPAY_BASE_URL || 'https://www.campay.net/api',
      authScheme: process.env.CAMPAY_AUTH_SCHEME || 'Token',
      collectPath: process.env.CAMPAY_COLLECT_PATH || '/collect/',
      statusPath: process.env.CAMPAY_STATUS_PATH || '/transaction/',
      logger
    });
  }

  // MTN is currently a stub (real integration comes later)
  providers.mtn = new MtnMomoProvider({ logger });

  if (process.env.STRIPE_SECRET_KEY) {
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      logger.warn(
        'STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is not - ' +
          'every Stripe webhook will be rejected (fail-closed) until it is configured'
      );
    }

    providers.stripe = new StripeProvider({
      secretKey: process.env.STRIPE_SECRET_KEY,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
      baseUrl: process.env.STRIPE_BASE_URL || 'https://api.stripe.com/v1',
      successUrl: process.env.STRIPE_SUCCESS_URL,
      cancelUrl: process.env.STRIPE_CANCEL_URL,
      logger
    });
  }

  // Naming note: SANDBOX_PAYPAL_CLIENT_ID/SECRET are unrelated to the
  // billing system's own SANDBOX_SECRET_KEY (Stripe) - see the todo doc's
  // scope-boundary section. Do not read SANDBOX_SECRET_KEY here.
  if (process.env.SANDBOX_PAYPAL_CLIENT_ID) {
    if (!process.env.SANDBOX_PAYPAL_WEBHOOK_ID) {
      logger.warn(
        'SANDBOX_PAYPAL_CLIENT_ID is set but SANDBOX_PAYPAL_WEBHOOK_ID is not - ' +
          'every PayPal webhook will be rejected (fail-closed) until it is configured'
      );
    }

    providers.paypal = new PayPalProvider({
      clientId: process.env.SANDBOX_PAYPAL_CLIENT_ID,
      clientSecret: process.env.SANDBOX_PAYPAL_CLIENT_SECRET,
      baseUrl: process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com',
      returnUrl: process.env.PAYPAL_RETURN_URL,
      cancelUrl: process.env.PAYPAL_CANCEL_URL,
      webhookId: process.env.SANDBOX_PAYPAL_WEBHOOK_ID,
      logger
    });
  }

  const store = new PaymentStore({
    ttlSeconds: Number(process.env.PAYMENT_TTL_SECONDS || 60 * 60 * 24)
  });

  const gateway = new PaymentGateway({ providers, logger, store, events: paymentEvents });

  cached = {
    gateway,
    store,
    events: paymentEvents
  };

  return cached;
}

module.exports = { getPaymentService };
