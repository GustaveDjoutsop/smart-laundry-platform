const { normalizeStatus } = require('../paymentTypes');

function buildUrl(baseUrl, path) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  const pathWithLeadingSlash = String(path || '').startsWith('/') ? String(path) : `/${path}`;
  return `${base}${pathWithLeadingSlash}`;
}

function normalizeMsisdn(phoneNumber) {
  const digits = String(phoneNumber || '').replace(/\D/g, '');
  return digits || null;
}

class CamPayProvider {
  constructor({ token, logger, baseUrl, authScheme, collectPath, statusPath, fetchImpl } = {}) {
    this.token = token;
    this.logger = logger;
    this.baseUrl = baseUrl || 'https://www.campay.net/api';
    this.authScheme = authScheme || 'Token';
    this.collectPath = collectPath || '/collect/';
    this.statusPath = statusPath || '/transaction/';
    this.fetchImpl = fetchImpl || global.fetch;

    if (!this.fetchImpl) {
      throw new Error('fetch is not available (Node 18+ required)');
    }
  }

  isConfigured() {
    return Boolean(this.token);
  }

  async initiatePayment(options) {
    if (!this.isConfigured()) {
      throw new Error('CamPay provider not configured (missing token)');
    }

    const url = buildUrl(this.baseUrl, this.collectPath);

    const payload = {
      amount: options.amount,
      currency: options.currency || 'XAF',
      from: normalizeMsisdn(options.phoneNumber),
      description: options.description || 'Payment',
      external_reference: options.reference || undefined
    };

    if (!payload.from) {
      throw new Error('CamPay initiatePayment failed (invalid phoneNumber)');
    }

    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `${this.authScheme} ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(async () => ({ raw: await res.text().catch(() => '') }));

    if (!res.ok) {
      this.logger && this.logger.warn && this.logger.warn('CamPay initiatePayment failed', data);
      throw new Error(`CamPay initiatePayment failed (status=${res.status})`);
    }

    const transactionId = data.reference || data.transaction_id || data.id || `campay_${Date.now()}`;
    const status = normalizeStatus(data.status || data.state || 'PENDING');

    return {
      transactionId,
      status,
      externalRef: options.reference || null,
      raw: data
    };
  }

  async checkStatus(transactionId) {
    if (!this.isConfigured()) {
      throw new Error('CamPay provider not configured (missing token)');
    }

    const url = buildUrl(this.baseUrl, `${this.statusPath}${encodeURIComponent(transactionId)}`);

    const res = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `${this.authScheme} ${this.token}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await res.json().catch(async () => ({ raw: await res.text().catch(() => '') }));

    if (!res.ok) {
      this.logger && this.logger.warn && this.logger.warn('CamPay checkStatus failed', data);
      throw new Error(`CamPay checkStatus failed (status=${res.status})`);
    }

    return {
      transactionId,
      status: normalizeStatus(data.status || data.state || 'PENDING'),
      raw: data
    };
  }

  // Signature verification is handled at the webhook route level (provider-specific headers differ).
  verifyWebhook(payload, signature) {
    return Boolean(payload) && Boolean(signature);
  }

  parseWebhook(payload) {
    const transactionId = payload && (payload.reference || payload.transaction_id || payload.id);
    const status = normalizeStatus(payload && (payload.status || payload.state));
    const amount = payload && payload.amount;
    const externalRef = payload && (payload.external_reference || payload.externalRef);

    return { transactionId, status, amount, externalRef, raw: payload };
  }
}

module.exports = { CamPayProvider, buildUrl };
