const { buildUrl, toFormBody } = require('../payments/providers/stripeProvider');
const { verifyStripeSignature } = require('../payments/webhookSignature');
const { normalizeSubscriptionStatus } = require('./billingTypes');

// Event types this provider understands. Anything else is returned with
// subscriptionId: null so the webhook route treats it as "nothing to do" -
// same fail-safe shape as the consumer-payments StripeProvider.parseWebhook.
const SUBSCRIPTION_EVENT_TYPES = new Set(['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']);
const INVOICE_EVENT_TYPES = new Set(['invoice.paid', 'invoice.payment_failed']);

function invoiceSubscriptionId(invoice) {
  // Newer Stripe API versions moved subscription off Invoice.subscription
  // onto Invoice.parent.subscription_details.subscription - check both so
  // this doesn't silently stop working across an API version bump.
  return (invoice && invoice.subscription) || (invoice && invoice.parent && invoice.parent.subscription_details && invoice.parent.subscription_details.subscription) || null;
}

class StripeBillingProvider {
  constructor({ secretKey, webhookSecret, baseUrl, successUrl, cancelUrl, portalReturnUrl, logger, fetchImpl } = {}) {
    this.secretKey = secretKey;
    this.webhookSecret = webhookSecret;
    this.logger = logger;
    this.baseUrl = baseUrl || 'https://api.stripe.com/v1';
    this.successUrl = successUrl;
    this.cancelUrl = cancelUrl;
    this.portalReturnUrl = portalReturnUrl;
    this.fetchImpl = fetchImpl || global.fetch;

    if (!this.fetchImpl) {
      throw new Error('fetch is not available (Node 18+ required)');
    }
  }

  isConfigured() {
    return Boolean(this.secretKey);
  }

  async post(path, params, { idempotencyKey } = {}) {
    const url = buildUrl(this.baseUrl, path);
    const headers = {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    };
    // Lets two racing requests for the same logical operation (e.g. a
    // double-submitted "start subscription" click) collapse into a single
    // Stripe object instead of creating two real Customers - Stripe dedupes
    // any POST carrying the same Idempotency-Key for ~24h.
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers,
      body: toFormBody(params).join('&')
    });

    const data = await res.json().catch(async () => ({ raw: await res.text().catch(() => '') }));
    if (!res.ok) {
      this.logger && this.logger.warn && this.logger.warn(`Stripe billing request failed (${path})`, data);
      throw new Error(`Stripe billing request failed (path=${path}, status=${res.status})`);
    }
    return data;
  }

  async get(path) {
    const url = buildUrl(this.baseUrl, path);
    const res = await this.fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.secretKey}` }
    });

    const data = await res.json().catch(async () => ({ raw: await res.text().catch(() => '') }));
    if (!res.ok) {
      this.logger && this.logger.warn && this.logger.warn(`Stripe billing request failed (${path})`, data);
      throw new Error(`Stripe billing request failed (path=${path}, status=${res.status})`);
    }
    return data;
  }

  async createCustomer({ email, name, botId, idempotencyKey } = {}) {
    if (!this.isConfigured()) throw new Error('Stripe billing provider not configured (missing secretKey)');
    if (!email) throw new Error('createCustomer requires an email');

    return this.post(
      '/customers',
      {
        email,
        name: name || undefined,
        metadata: { botId: botId || '' }
      },
      { idempotencyKey }
    );
  }

  async createSubscriptionCheckoutSession({ customerId, priceId, botId, successUrl, cancelUrl } = {}) {
    if (!this.isConfigured()) throw new Error('Stripe billing provider not configured (missing secretKey)');
    if (!customerId) throw new Error('createSubscriptionCheckoutSession requires customerId');
    if (!priceId) throw new Error('createSubscriptionCheckoutSession requires priceId');

    const resolvedSuccessUrl = successUrl || this.successUrl;
    const resolvedCancelUrl = cancelUrl || this.cancelUrl || resolvedSuccessUrl;
    if (!resolvedSuccessUrl) {
      throw new Error('createSubscriptionCheckoutSession requires a success URL (set STRIPE_BILLING_SUCCESS_URL or pass successUrl)');
    }

    return this.post('/checkout/sessions', {
      mode: 'subscription',
      customer: customerId,
      client_reference_id: botId || undefined,
      success_url: resolvedSuccessUrl,
      cancel_url: resolvedCancelUrl,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { botId: botId || '' } }
    });
  }

  async createPortalSession({ customerId, returnUrl } = {}) {
    if (!this.isConfigured()) throw new Error('Stripe billing provider not configured (missing secretKey)');
    if (!customerId) throw new Error('createPortalSession requires customerId');

    const resolvedReturnUrl = returnUrl || this.portalReturnUrl;
    if (!resolvedReturnUrl) {
      throw new Error('createPortalSession requires a return URL (set STRIPE_BILLING_PORTAL_RETURN_URL or pass returnUrl)');
    }

    return this.post('/billing_portal/sessions', {
      customer: customerId,
      return_url: resolvedReturnUrl
    });
  }

  async retrieveSubscription(subscriptionId) {
    if (!this.isConfigured()) throw new Error('Stripe billing provider not configured (missing secretKey)');
    if (!subscriptionId) throw new Error('retrieveSubscription requires subscriptionId');

    return this.get(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
  }

  // Same HMAC scheme as consumer-payments Stripe webhooks, but this endpoint
  // is registered separately in the Stripe Dashboard and therefore signs
  // with its own webhook secret (SANDBOX_WEBHOOK_SECRET) - do not reuse the
  // consumer-payments STRIPE_WEBHOOK_SECRET here.
  verifyWebhook(rawBody, signatureHeader) {
    if (!this.webhookSecret || !signatureHeader) return false;
    return verifyStripeSignature({ secret: this.webhookSecret, rawBody, header: signatureHeader });
  }

  parseWebhook(payload) {
    const eventId = payload && payload.id;
    const eventType = payload && payload.type;
    const object = payload && payload.data && payload.data.object;

    if (eventType === 'checkout.session.completed' && object && object.mode === 'subscription') {
      return {
        eventId,
        eventType,
        customerId: object.customer || null,
        subscriptionId: object.subscription || null,
        status: null, // subscription status arrives via customer.subscription.* events, not this one
        raw: payload
      };
    }

    if (typeof eventType === 'string' && SUBSCRIPTION_EVENT_TYPES.has(eventType)) {
      return {
        eventId,
        eventType,
        customerId: object && object.customer,
        subscriptionId: object && object.id,
        status: normalizeSubscriptionStatus(object && object.status),
        raw: payload
      };
    }

    if (typeof eventType === 'string' && INVOICE_EVENT_TYPES.has(eventType)) {
      return {
        eventId,
        eventType,
        customerId: object && object.customer,
        subscriptionId: invoiceSubscriptionId(object),
        status: eventType === 'invoice.paid' ? normalizeSubscriptionStatus('active') : normalizeSubscriptionStatus('past_due'),
        raw: payload
      };
    }

    return { eventId, eventType, customerId: null, subscriptionId: null, status: null, raw: payload };
  }
}

module.exports = { StripeBillingProvider };
