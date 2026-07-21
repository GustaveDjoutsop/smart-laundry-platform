const { normalizeStatus } = require('../paymentTypes');
const { safeEqual } = require('../webhookSignature');

function buildUrl(baseUrl, path) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  const pathWithLeadingSlash = String(path || '').startsWith('/') ? String(path) : `/${path}`;
  return `${base}${pathWithLeadingSlash}`;
}

function mapFlutterwaveStatus(status) {
  const normalizedStatusText = String(status || '').toUpperCase();
  if (['SUCCESSFUL', 'SUCCEEDED'].includes(normalizedStatusText)) return normalizeStatus('COMPLETED');
  return normalizeStatus(status);
}

class FlutterwaveProvider {
  constructor({ secretKey, webhookSecretHash, logger, baseUrl, redirectUrl, fetchImpl } = {}) {
    this.secretKey = secretKey;
    this.webhookSecretHash = webhookSecretHash;
    this.logger = logger;
    this.baseUrl = baseUrl || 'https://api.flutterwave.com/v3';
    this.redirectUrl = redirectUrl;
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
      throw new Error('Flutterwave provider not configured (missing secretKey)');
    }

    const redirectUrl = options.redirectUrl || this.redirectUrl;
    if (!redirectUrl) {
      throw new Error('Flutterwave initiatePayment requires a redirectUrl (set FLUTTERWAVE_REDIRECT_URL or pass redirectUrl)');
    }
    if (!options.customerEmail) {
      throw new Error('Flutterwave initiatePayment requires a customerEmail');
    }

    const txRef = options.reference || `flw_${Date.now()}`;
    const url = buildUrl(this.baseUrl, '/payments');

    const payload = {
      tx_ref: txRef,
      amount: options.amount,
      currency: options.currency || 'EUR',
      redirect_url: redirectUrl,
      customer: {
        email: options.customerEmail,
        phonenumber: options.phoneNumber || undefined,
        name: options.customerName || undefined
      },
      customizations: {
        title: options.description || 'Payment'
      }
    };

    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(async () => ({ raw: await res.text().catch(() => '') }));

    if (!res.ok || data.status !== 'success') {
      this.logger && this.logger.warn && this.logger.warn('Flutterwave initiatePayment failed', data);
      throw new Error(`Flutterwave initiatePayment failed (status=${res.status})`);
    }

    return {
      transactionId: txRef,
      status: normalizeStatus('PENDING'),
      externalRef: txRef,
      checkoutUrl: data.data && data.data.link,
      raw: data
    };
  }

  async checkStatus(transactionId) {
    if (!this.isConfigured()) {
      throw new Error('Flutterwave provider not configured (missing secretKey)');
    }

    const url = buildUrl(this.baseUrl, `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(transactionId)}`);

    const res = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await res.json().catch(async () => ({ raw: await res.text().catch(() => '') }));

    if (!res.ok) {
      this.logger && this.logger.warn && this.logger.warn('Flutterwave checkStatus failed', data);
      throw new Error(`Flutterwave checkStatus failed (status=${res.status})`);
    }

    return {
      transactionId,
      status: mapFlutterwaveStatus(data.data && data.data.status),
      raw: data
    };
  }

  // Flutterwave's Standard/Collections webhooks send the dashboard-configured
  // Secret Hash back verbatim in the `verif-hash` header (a shared-secret
  // string, not an HMAC) - so this is a timing-safe string comparison, unlike
  // CamPay's HMAC verification.
  verifyWebhook(_payload, signatureHeader) {
    if (!this.webhookSecretHash || !signatureHeader) return false;
    return safeEqual(this.webhookSecretHash, signatureHeader);
  }

  parseWebhook(payload) {
    const data = payload && payload.data ? payload.data : payload;
    const transactionId = data && (data.tx_ref || data.id);
    const status = mapFlutterwaveStatus(data && data.status);
    const amount = data && data.amount;
    const externalRef = data && data.tx_ref;

    return { transactionId, status, amount, externalRef, raw: payload };
  }
}

module.exports = { FlutterwaveProvider, buildUrl, mapFlutterwaveStatus };
