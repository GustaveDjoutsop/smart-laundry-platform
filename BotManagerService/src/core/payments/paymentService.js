const { logger } = require('../../utils/logger');
const { PaymentGateway } = require('./paymentGateway');
const { PaymentStore } = require('./paymentStore');
const { paymentEvents } = require('./paymentEvents');
const { CamPayProvider } = require('./providers/campayProvider');
const { MtnMomoProvider } = require('./providers/mtnMomoProvider');

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
