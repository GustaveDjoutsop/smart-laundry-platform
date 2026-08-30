const { logger } = require('../../utils/logger');
const { PaymentGateway } = require('./paymentGateway');
const { PaymentStore } = require('./paymentStore');
const { paymentEvents } = require('./paymentEvents');
const { CamPayProvider } = require('./providers/campayProvider');
const { MtnMomoProvider } = require('./providers/mtnMomoProvider');
const { StripeProvider } = require('./providers/stripeProvider');
const { PayPalProvider } = require('./providers/paypalProvider');

let cached;

// A leading/trailing space typed into a Railway env var field is a
// realistic operator mistake (see
// afromarket-payment-failure-handling-bugfix.md - a leading space in
// PAYPAL_CANCEL_URL passed the JS URL constructor's own leniency, which
// strips whitespace when parsing, but was then rejected by PayPal's own
// stricter server-side validation as INVALID_PARAMETER_SYNTAX, since the
// untrimmed raw string is what actually gets sent). Trimming first and
// validating the trimmed value is what catches this at startup instead of
// on the first real checkout attempt.
function parseTrimmedUrl(envVarName, rawValue) {
  const trimmed = String(rawValue || '').trim();
  if (!trimmed) return { value: '', valid: true };
  try {
    // eslint-disable-next-line no-new
    new URL(trimmed);
    return { value: trimmed, valid: true };
  } catch (_err) {
    logger.error(`${envVarName} is set but is not a valid URL after trimming (got "${trimmed}") - refusing to use it`);
    return { value: trimmed, valid: false };
  }
}

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

    // Same trim/validate/require-at-registration treatment as PayPal below -
    // added after a subagent review of the PayPal fix flagged that Stripe
    // reproduces the exact bug class this exists to close (a malformed/
    // missing STRIPE_SUCCESS_URL throws, uncaught by any classification,
    // deferred to the first live checkout) and is, in practice, the higher-
    // value gap: AFROMARKET_PAYMENT_PROVIDER currently defaults every
    // environment that hasn't finished PayPal setup to Stripe. Unlike
    // PayPal's cancelUrl, STRIPE_CANCEL_URL is genuinely optional -
    // stripeProvider.js falls back to successUrl when unset.
    const stripeSuccessUrl = parseTrimmedUrl('STRIPE_SUCCESS_URL', process.env.STRIPE_SUCCESS_URL);
    const stripeCancelUrl = parseTrimmedUrl('STRIPE_CANCEL_URL', process.env.STRIPE_CANCEL_URL);
    const stripeSuccessUrlMissing = stripeSuccessUrl.valid && !stripeSuccessUrl.value;
    if (stripeSuccessUrlMissing) {
      logger.error('STRIPE_SECRET_KEY is set but STRIPE_SUCCESS_URL is not - initiatePayment would throw on every checkout attempt otherwise');
    }

    if (!stripeSuccessUrl.valid || !stripeCancelUrl.valid || stripeSuccessUrlMissing) {
      logger.error('Stripe provider NOT registered due to the invalid/missing URL(s) above - checkout will be blocked/refused until this is fixed in Railway');
    } else {
      providers.stripe = new StripeProvider({
        secretKey: process.env.STRIPE_SECRET_KEY,
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
        baseUrl: process.env.STRIPE_BASE_URL || 'https://api.stripe.com/v1',
        successUrl: stripeSuccessUrl.value,
        cancelUrl: stripeCancelUrl.value,
        logger
      });
    }
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

    const returnUrl = parseTrimmedUrl('PAYPAL_RETURN_URL', process.env.PAYPAL_RETURN_URL);
    const cancelUrl = parseTrimmedUrl('PAYPAL_CANCEL_URL', process.env.PAYPAL_CANCEL_URL);
    // Unlike PAYPAL_CANCEL_URL (genuinely optional - PayPalProvider falls
    // back to returnUrl when unset), PAYPAL_RETURN_URL is not optional once
    // PayPal is being registered at all: initiatePayment throws
    // unconditionally without one. parseTrimmedUrl alone treats "unset" as
    // valid (it's a generic trim+validate helper, correctly reused as-is for
    // cancelUrl above) - this additional check is what actually catches "the
    // var is simply missing" at startup, not just "the var is malformed",
    // closing the same class of gap this fix exists for.
    const returnUrlMissing = returnUrl.valid && !returnUrl.value;
    if (returnUrlMissing) {
      logger.error('SANDBOX_PAYPAL_CLIENT_ID is set but PAYPAL_RETURN_URL is not - initiatePayment would throw on every checkout attempt otherwise');
    }

    // Refuse to register rather than defer this to the first real checkout
    // attempt - a malformed/missing URL here is a static config defect, not
    // something that needs a live customer request to discover. This
    // correctly propagates through: paymentsConfigured becomes false for
    // 'paypal', which afromarketFlowPlugin.js's own guard (added
    // alongside the provider selector) already treats as a hard block on
    // checkout when another provider IS configured, or the legacy dev
    // fallback when nothing is.
    if (!returnUrl.valid || !cancelUrl.valid || returnUrlMissing) {
      logger.error('PayPal provider NOT registered due to the invalid/missing URL(s) above - checkout will be blocked/refused until this is fixed in Railway');
    } else {
      providers.paypal = new PayPalProvider({
        clientId: String(process.env.SANDBOX_PAYPAL_CLIENT_ID || '').trim(),
        clientSecret: String(process.env.SANDBOX_PAYPAL_CLIENT_SECRET || '').trim(),
        baseUrl: String(process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com').trim(),
        returnUrl: returnUrl.value,
        cancelUrl: cancelUrl.value,
        webhookId: String(process.env.SANDBOX_PAYPAL_WEBHOOK_ID || '').trim(),
        logger
      });
    }
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

module.exports = { getPaymentService, parseTrimmedUrl };
