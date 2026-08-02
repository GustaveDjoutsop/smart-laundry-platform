const { normalizeStatus } = require('../paymentTypes');
const { verifyStripeSignature } = require('../webhookSignature');

function buildUrl(baseUrl, path) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  const pathWithLeadingSlash = String(path || '').startsWith('/') ? String(path) : `/${path}`;
  return `${base}${pathWithLeadingSlash}`;
}

function mapStripeCheckoutStatus(session) {
  if (session && session.payment_status === 'paid') return normalizeStatus('COMPLETED');
  if (session && session.status === 'expired') return normalizeStatus('FAILED');
  return normalizeStatus('PENDING');
}

// Stripe's REST API takes a form-urlencoded body with bracket notation for
// nested objects/arrays (e.g. metadata[orderNumber]=AM-123), not JSON.
function toFormBody(params, prefix) {
  const pairs = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const formKey = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object' && !Array.isArray(value)) {
      pairs.push(...toFormBody(value, formKey));
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === 'object') {
          pairs.push(...toFormBody(item, `${formKey}[${index}]`));
        } else {
          pairs.push(`${encodeURIComponent(`${formKey}[${index}]`)}=${encodeURIComponent(item)}`);
        }
      });
    } else {
      pairs.push(`${encodeURIComponent(formKey)}=${encodeURIComponent(value)}`);
    }
  }
  return pairs;
}

class StripeProvider {
  constructor({ secretKey, webhookSecret, baseUrl, successUrl, cancelUrl, logger, fetchImpl } = {}) {
    this.secretKey = secretKey;
    this.webhookSecret = webhookSecret;
    this.logger = logger;
    this.baseUrl = baseUrl || 'https://api.stripe.com/v1';
    this.successUrl = successUrl;
    this.cancelUrl = cancelUrl;
    this.fetchImpl = fetchImpl || global.fetch;

    if (!this.fetchImpl) {
      throw new Error('fetch is not available (Node 18+ required)');
    }
  }

  isConfigured() {
    return Boolean(this.secretKey);
  }

  async initiatePayment(options) {
    if (!this.isConfigured()) {
      throw new Error('Stripe provider not configured (missing secretKey)');
    }

    const successUrl = options.redirectUrl || this.successUrl;
    const cancelUrl = this.cancelUrl || successUrl;
    if (!successUrl) {
      throw new Error('Stripe initiatePayment requires a success URL (set STRIPE_SUCCESS_URL or pass redirectUrl)');
    }
    if (!options.customerEmail) {
      throw new Error('Stripe initiatePayment requires a customerEmail');
    }
    if (!options.currency) {
      throw new Error('Stripe initiatePayment requires a currency');
    }

    const reference = options.reference || `stripe_${Date.now()}`;
    const url = buildUrl(this.baseUrl, '/checkout/sessions');

    // A single aggregate line item for the cart total - matches the level of
    // checkout-page detail Flutterwave's hosted page already gave customers,
    // rather than itemizing every product (see afromarket.md's Payment section).
    const params = {
      mode: 'payment',
      client_reference_id: reference,
      customer_email: options.customerEmail,
      success_url: successUrl,
      cancel_url: cancelUrl,
      // No payment_method_types/automatic_payment_methods here deliberately:
      // Checkout Sessions pick up enabled payment methods from the Stripe
      // Dashboard automatically. automatic_payment_methods is a PaymentIntent
      // param, not a Checkout Session one - passing it here is rejected by
      // Stripe with "Received unknown parameter: automatic_payment_methods"
      // (caught by driving this against the real sandbox API, not just the
      // mocked-fetch unit tests).
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: String(options.currency).toLowerCase(),
            unit_amount: Math.round(Number(options.amount) * 100),
            product_data: { name: options.description || 'Payment' }
          }
        }
      ],
      // Stripe's metadata is a flat string->string map (max 50 keys, 40-char
      // keys, 500-char values) - it does not accept nested objects/arrays.
      // The full order (including the cart) is already retained internally
      // by PaymentGateway/PaymentStore's own `metadata` field; only a plain
      // reference string is ever forwarded to Stripe itself.
      metadata: { reference }
    };

    const headers = {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    };
    // Stripe dedupes any POST carrying the same Idempotency-Key for ~24h -
    // defense-in-depth on top of PaymentGateway's own store-level dedup.
    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers,
      body: toFormBody(params).join('&')
    });

    const data = await res.json().catch(async () => ({ raw: await res.text().catch(() => '') }));

    if (!res.ok || !data.id) {
      this.logger && this.logger.warn && this.logger.warn('Stripe initiatePayment failed', data);
      throw new Error(`Stripe initiatePayment failed (status=${res.status})`);
    }

    return {
      transactionId: data.id,
      status: normalizeStatus('PENDING'),
      externalRef: reference,
      checkoutUrl: data.url,
      raw: data
    };
  }

  async checkStatus(transactionId) {
    if (!this.isConfigured()) {
      throw new Error('Stripe provider not configured (missing secretKey)');
    }

    const url = buildUrl(this.baseUrl, `/checkout/sessions/${encodeURIComponent(transactionId)}`);

    const res = await this.fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.secretKey}` }
    });

    const data = await res.json().catch(async () => ({ raw: await res.text().catch(() => '') }));

    if (!res.ok) {
      this.logger && this.logger.warn && this.logger.warn('Stripe checkStatus failed', data);
      throw new Error(`Stripe checkStatus failed (status=${res.status})`);
    }

    return {
      transactionId,
      status: mapStripeCheckoutStatus(data),
      raw: data
    };
  }

  // Stripe's `Stripe-Signature` header is `t=<timestamp>,v1=<hex hmac>` - an
  // HMAC-SHA256 over `${timestamp}.${rawBody}`, with a replay-tolerance window.
  // Unlike Flutterwave's plain string-compare secret, this is a real signature.
  verifyWebhook(rawBody, signatureHeader) {
    if (!this.webhookSecret || !signatureHeader) return false;
    return verifyStripeSignature({ secret: this.webhookSecret, rawBody, header: signatureHeader });
  }

  parseWebhook(payload) {
    const eventId = payload && payload.id;

    // Only checkout.session.* events carry a Checkout Session in data.object -
    // if the Stripe dashboard's endpoint is ever configured to send other
    // event types too, treating an unrelated object as a session would
    // produce a garbage ledger entry. No transactionId is returned instead,
    // which the webhook route already treats as "nothing to do" and skips.
    const eventType = payload && payload.type;
    if (typeof eventType === 'string' && !eventType.startsWith('checkout.session.')) {
      return { transactionId: null, status: normalizeStatus('PENDING'), eventId, raw: payload };
    }

    const session = payload && payload.data && payload.data.object;
    const transactionId = session && session.id;
    const status = mapStripeCheckoutStatus(session);
    const amount = session && typeof session.amount_total === 'number' ? session.amount_total / 100 : undefined;
    const externalRef = session && session.client_reference_id;

    return { transactionId, status, amount, externalRef, eventId, raw: payload };
  }
}

module.exports = { StripeProvider, buildUrl, mapStripeCheckoutStatus, toFormBody };
