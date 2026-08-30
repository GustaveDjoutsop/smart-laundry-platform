const { normalizeStatus } = require('../paymentTypes');

function buildUrl(baseUrl, path) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  const pathWithLeadingSlash = String(path || '').startsWith('/') ? String(path) : `/${path}`;
  return `${base}${pathWithLeadingSlash}`;
}

function mapOrderStatus(status) {
  if (status === 'COMPLETED') return normalizeStatus('COMPLETED');
  if (status === 'VOIDED') return normalizeStatus('FAILED');
  return normalizeStatus('PENDING');
}

// A capture's own status is distinct from the order's - PayPal can return
// HTTP 200/201 from /capture with the individual capture still PENDING (e.g.
// eCheck clearing, a risk review), not COMPLETED. Callers must check this,
// not assume a successful HTTP response means the money has actually moved.
// Also used to interpret a PAYMENT.CAPTURE.* webhook's resource.status (the
// Capture object) - PENDING/REFUNDED/PARTIALLY_REFUNDED all fall through to
// PENDING here rather than FAILED, matching the rest of this codebase's
// PaymentStatus enum (PENDING/PROCESSING/COMPLETED/FAILED - no refund
// concept exists anywhere else in the payment system either).
function mapCaptureStatus(status) {
  if (status === 'COMPLETED') return normalizeStatus('COMPLETED');
  if (status === 'DECLINED' || status === 'DENIED') return normalizeStatus('FAILED');
  return normalizeStatus('PENDING');
}

// PayPal's shipping.address has no single "one-line" field - flattened here
// to match the plain-string shape metadata.address/delivery_address already
// use everywhere else in this codebase (chat-entered addresses are also just
// free text). Best-effort only: a partial/malformed address still produces
// something readable rather than throwing.
function formatShippingAddress(address) {
  if (!address) return null;
  const parts = [
    address.address_line_1,
    address.address_line_2,
    [address.postal_code, address.admin_area_2].filter(Boolean).join(' '),
    address.admin_area_1,
    address.country_code
  ].filter((part) => part && String(part).trim());
  return parts.length ? parts.join(', ') : null;
}

function formatPayerName(payer) {
  const name = payer && payer.name;
  if (!name) return null;
  const full = [name.given_name, name.surname].filter(Boolean).join(' ').trim();
  return full || null;
}

class PayPalProvider {
  constructor({ clientId, clientSecret, baseUrl, returnUrl, cancelUrl, webhookId, logger, fetchImpl } = {}) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.logger = logger;
    // Sandbox by default - no production PayPal credentials exist yet (see
    // afromarket-paypal-migration-and-shipping-todo.md). Override with
    // PAYPAL_BASE_URL=https://api-m.paypal.com once they do.
    this.baseUrl = baseUrl || 'https://api-m.sandbox.paypal.com';
    this.returnUrl = returnUrl;
    this.cancelUrl = cancelUrl;
    this.webhookId = webhookId;
    this.fetchImpl = fetchImpl || global.fetch;

    if (!this.fetchImpl) {
      throw new Error('fetch is not available (Node 18+ required)');
    }

    this._token = null;
    this._tokenExpiresAt = 0;
  }

  isConfigured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  // OAuth2 client-credentials token, cached until shortly before it expires -
  // every initiatePayment/captureOrder/checkStatus call would otherwise mint
  // a fresh token, doubling PayPal API calls for no reason. 60s safety margin
  // against a request that starts just before expiry.
  async _getAccessToken() {
    if (this._token && Date.now() < this._tokenExpiresAt - 60_000) {
      return this._token;
    }

    const url = buildUrl(this.baseUrl, '/v1/oauth2/token');
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    const data = await res.json().catch(async () => ({ raw: await res.text().catch(() => '') }));
    if (!res.ok || !data.access_token) {
      this.logger && this.logger.warn && this.logger.warn('PayPal OAuth token request failed', data);
      throw new Error(`PayPal OAuth token request failed (status=${res.status})`);
    }

    this._token = data.access_token;
    this._tokenExpiresAt = Date.now() + Number(data.expires_in || 0) * 1000;
    return this._token;
  }

  async _authorizedFetch(path, { method = 'GET', body, idempotencyKey } = {}) {
    const token = await this._getAccessToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
    if (idempotencyKey) {
      headers['PayPal-Request-Id'] = idempotencyKey;
    }

    const res = await this.fetchImpl(buildUrl(this.baseUrl, path), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    const data = await res.json().catch(async () => ({ raw: await res.text().catch(() => '') }));
    return { ok: res.ok, status: res.status, data };
  }

  async initiatePayment(options) {
    if (!this.isConfigured()) {
      throw new Error('PayPal provider not configured (missing clientId/clientSecret)');
    }
    if (!options.currency) {
      throw new Error('PayPal initiatePayment requires a currency');
    }

    const returnUrl = options.redirectUrl || this.returnUrl;
    const cancelUrl = this.cancelUrl || returnUrl;
    if (!returnUrl) {
      throw new Error('PayPal initiatePayment requires a return URL (set PAYPAL_RETURN_URL or pass redirectUrl)');
    }

    const reference = options.reference || `paypal_${Date.now()}`;

    const { ok, status, data } = await this._authorizedFetch('/v2/checkout/orders', {
      method: 'POST',
      idempotencyKey: options.idempotencyKey,
      body: {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: reference,
            // Round-trips back on the capture response/webhook - the only
            // reliable way to recover our own order reference from a PayPal
            // capture event (see parseWebhook below).
            custom_id: reference,
            description: options.description || 'Payment',
            amount: {
              currency_code: String(options.currency).toUpperCase(),
              value: Number(options.amount).toFixed(2)
            }
          }
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: returnUrl,
              cancel_url: cancelUrl,
              user_action: 'PAY_NOW',
              // PayPal collects/returns the buyer's shipping address itself -
              // no address is provided upfront (see the todo doc's "Address
              // capture happens AFTER payment" section for why).
              shipping_preference: 'GET_FROM_FILE'
            }
          }
        }
      }
    });

    if (!ok || !data.id) {
      this.logger && this.logger.warn && this.logger.warn('PayPal initiatePayment failed', data);
      throw new Error(`PayPal initiatePayment failed (status=${status})`);
    }

    const links = Array.isArray(data.links) ? data.links : [];
    // 'payer-action' is the current (experience_context-based) redirect link;
    // 'approve' is the older application_context-era name. Checking both
    // guards against either shape without needing to know which one this
    // PayPal API version actually returns until it's been driven against the
    // real sandbox.
    const checkoutLink = links.find((l) => l.rel === 'payer-action') || links.find((l) => l.rel === 'approve');

    return {
      transactionId: data.id,
      status: normalizeStatus('PENDING'),
      externalRef: reference,
      checkoutUrl: checkoutLink && checkoutLink.href,
      raw: data
    };
  }

  async checkStatus(transactionId) {
    if (!this.isConfigured()) {
      throw new Error('PayPal provider not configured (missing clientId/clientSecret)');
    }

    const { ok, status, data } = await this._authorizedFetch(`/v2/checkout/orders/${encodeURIComponent(transactionId)}`);
    if (!ok) {
      this.logger && this.logger.warn && this.logger.warn('PayPal checkStatus failed', data);
      throw new Error(`PayPal checkStatus failed (status=${status})`);
    }

    // Self-heal: an order stuck at APPROVED means the buyer approved it but
    // the CHECKOUT.ORDER.APPROVED webhook's capture attempt either never
    // arrived or failed - this poll (PaymentStatusWorker already runs one)
    // is the backstop that finishes the job instead of leaving the customer
    // charged-nothing/order-stuck forever.
    if (data.status === 'APPROVED') {
      const captured = await this.captureOrder(transactionId);
      if (captured.ok) {
        return { transactionId, status: mapOrderStatus(captured.data.status), raw: captured.data };
      }
    }

    return { transactionId, status: mapOrderStatus(data.status), raw: data };
  }

  // Not part of the interface PaymentGateway calls generically (Stripe/CamPay
  // have no equivalent step) - PayPal never auto-captures a CAPTURE-intent
  // order on buyer approval, so the webhook route calls this explicitly on
  // CHECKOUT.ORDER.APPROVED, and checkStatus's self-heal path above calls it
  // as a backstop. Both triggers can legitimately fire close together (a
  // webhook delivery racing the poller that drives checkStatus) - a
  // deterministic PayPal-Request-Id, not a caller-supplied one, is what
  // makes a near-simultaneous double call to this method resolve to a single
  // capture instead of a real double-charge. Returns {ok, data} rather than
  // throwing so callers can log and continue (PayPal 422s this when the
  // order isn't actually approved yet, e.g. a race with the webhook) without
  // an unhandled rejection.
  async captureOrder(orderId) {
    const { ok, status, data } = await this._authorizedFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      idempotencyKey: `capture:${orderId}`
    });

    if (!ok) {
      this.logger && this.logger.warn && this.logger.warn('PayPal captureOrder failed', { orderId, status, data });
      return { ok: false, status, error: data, data: null };
    }

    return { ok: true, status, data };
  }

  // PayPal's verification is a postback to PayPal's own API (transmission
  // ID/signature/cert URL), not a local HMAC like Stripe's/CamPay's -
  // deliberately does not reuse webhookSignature.js's verifyHmacSha256Hex.
  // Async (unlike Stripe's/CamPay's sync verifyWebhook) - the /webhooks/paypal
  // route awaits this explicitly rather than going through the generic
  // synchronous provider.verifyWebhook(...) call sites the other routes use.
  async verifyWebhook(rawBody, headers) {
    if (!this.webhookId) return false;
    const { transmissionId, transmissionTime, certUrl, authAlgo, transmissionSig } = headers || {};
    if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig || !rawBody) {
      return false;
    }

    let webhookEvent;
    try {
      webhookEvent = JSON.parse(rawBody);
    } catch (_err) {
      return false;
    }

    try {
      const { ok, data } = await this._authorizedFetch('/v1/notifications/verify-webhook-signature', {
        method: 'POST',
        body: {
          transmission_id: transmissionId,
          transmission_time: transmissionTime,
          cert_url: certUrl,
          auth_algo: authAlgo,
          transmission_sig: transmissionSig,
          webhook_id: this.webhookId,
          // Must be posted back exactly as received per PayPal's docs -
          // re-serializing the already-parsed req.body (rather than
          // forwarding rawBody's raw bytes) is the one deviation from that,
          // accepted here since express.json() round-trips it losslessly for
          // any well-formed PayPal payload.
          webhook_event: webhookEvent
        }
      });
      return ok && data.verification_status === 'SUCCESS';
    } catch (err) {
      this.logger && this.logger.warn && this.logger.warn('PayPal webhook verification request failed', err && err.message ? err.message : String(err));
      return false;
    }
  }

  parseWebhook(payload) {
    const eventId = payload && payload.id;
    const eventType = payload && payload.event_type;

    // Only PAYMENT.CAPTURE.* events carry a Capture in resource - anything
    // else (including CHECKOUT.ORDER.APPROVED, handled separately by the
    // route before it ever reaches here) has no transactionId, which the
    // webhook route already treats as "nothing to do" and skips.
    if (typeof eventType !== 'string' || !eventType.startsWith('PAYMENT.CAPTURE.')) {
      return { transactionId: null, status: normalizeStatus('PENDING'), eventId, raw: payload };
    }

    const resource = payload && payload.resource;
    // The Capture resource's own `id` is NOT the order id PaymentGateway
    // stores everything under - `supplementary_data.related_ids.order_id` is
    // the correlation field back to the order initiatePayment returned.
    const transactionId = resource && resource.supplementary_data && resource.supplementary_data.related_ids
      ? resource.supplementary_data.related_ids.order_id
      : null;
    // Derived from the Capture resource's own status field, not guessed from
    // the event_type string - PAYMENT.CAPTURE.PENDING (eCheck clearing, a
    // risk review) is a real, distinct event that must not be treated as a
    // failure just because it isn't literally ".COMPLETED".
    const status = mapCaptureStatus(resource && resource.status);
    const amount = resource && resource.amount && resource.amount.value != null ? Number(resource.amount.value) : undefined;
    const externalRef = (resource && resource.custom_id) || null;

    return { transactionId, status, amount, externalRef, eventId, raw: payload };
  }
}

module.exports = { PayPalProvider, buildUrl, mapOrderStatus, mapCaptureStatus, formatShippingAddress, formatPayerName };
