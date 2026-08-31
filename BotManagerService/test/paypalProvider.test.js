const test = require('node:test');
const assert = require('node:assert/strict');

const { PayPalProvider, mapOrderStatus, mapCaptureStatus, formatShippingAddress, formatPayerName, formatPayerContact } = require('../src/core/payments/providers/paypalProvider');

const TOKEN_RESPONSE = { status: 200, body: { access_token: 'access-token-abc', token_type: 'Bearer', expires_in: 32000 } };

// Every authorized call fetches an OAuth token first (see
// PayPalProvider._getAccessToken) - tests that only care about the
// subsequent API call queue TOKEN_RESPONSE first, matching call order.
function makeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const response = responses.shift();
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body
    };
  };
  return { fetchImpl, calls };
}

test('PayPalProvider isConfigured reflects clientId/clientSecret presence', () => {
  const configured = new PayPalProvider({ clientId: 'id', clientSecret: 'secret', fetchImpl: async () => ({}) });
  const unconfigured = new PayPalProvider({ fetchImpl: async () => ({}) });

  assert.equal(configured.isConfigured(), true);
  assert.equal(unconfigured.isConfigured(), false);
});

test('PayPalProvider initiatePayment creates a CAPTURE-intent order and returns the payer-action checkout URL', async () => {
  const { fetchImpl, calls } = makeFetch([
    TOKEN_RESPONSE,
    {
      status: 201,
      body: {
        id: 'ORDER-1',
        status: 'PAYER_ACTION_REQUIRED',
        links: [
          { rel: 'self', href: 'https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-1' },
          { rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1' }
        ]
      }
    }
  ]);

  const provider = new PayPalProvider({
    clientId: 'id',
    clientSecret: 'secret',
    returnUrl: 'https://afromarket.example.com/payment-return',
    fetchImpl
  });

  const result = await provider.initiatePayment({
    amount: 27.4,
    currency: 'EUR',
    reference: 'AM-ORDER1',
    description: 'AfroMarket order AM-ORDER1'
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api-m.sandbox.paypal.com/v1/oauth2/token');
  assert.equal(calls[1].url, 'https://api-m.sandbox.paypal.com/v2/checkout/orders');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer access-token-abc');

  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.intent, 'CAPTURE');
  assert.equal(body.purchase_units[0].amount.value, '27.40');
  assert.equal(body.purchase_units[0].amount.currency_code, 'EUR');
  assert.equal(body.purchase_units[0].custom_id, 'AM-ORDER1');
  assert.equal(body.payment_source.paypal.experience_context.shipping_preference, 'GET_FROM_FILE');
  assert.equal(body.payment_source.paypal.experience_context.return_url, 'https://afromarket.example.com/payment-return');

  assert.equal(result.transactionId, 'ORDER-1');
  assert.equal(result.status, 'PENDING');
  assert.equal(result.externalRef, 'AM-ORDER1');
  assert.equal(result.checkoutUrl, 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1');
});

test('PayPalProvider initiatePayment does not require a customerEmail (unlike Stripe)', async () => {
  const { fetchImpl } = makeFetch([
    TOKEN_RESPONSE,
    { status: 201, body: { id: 'ORDER-2', links: [{ rel: 'approve', href: 'https://paypal.example.com/approve' }] } }
  ]);

  const provider = new PayPalProvider({ clientId: 'id', clientSecret: 'secret', returnUrl: 'https://example.com/return', fetchImpl });

  const result = await provider.initiatePayment({ amount: 10, currency: 'EUR', reference: 'x' });
  assert.equal(result.transactionId, 'ORDER-2');
});

test('PayPalProvider initiatePayment forwards idempotencyKey as the PayPal-Request-Id header', async () => {
  const { fetchImpl, calls } = makeFetch([
    TOKEN_RESPONSE,
    { status: 201, body: { id: 'ORDER-3', links: [{ rel: 'approve', href: 'https://paypal.example.com/approve' }] } }
  ]);

  const provider = new PayPalProvider({ clientId: 'id', clientSecret: 'secret', returnUrl: 'https://example.com/return', fetchImpl });

  await provider.initiatePayment({ amount: 10, currency: 'EUR', reference: 'AM-3', idempotencyKey: 'idem-key-xyz' });

  assert.equal(calls[1].init.headers['PayPal-Request-Id'], 'idem-key-xyz');
});

test('PayPalProvider initiatePayment rejects when no return URL is configured', async () => {
  const provider = new PayPalProvider({ clientId: 'id', clientSecret: 'secret', fetchImpl: async () => ({}) });

  await assert.rejects(
    () => provider.initiatePayment({ amount: 10, currency: 'EUR', reference: 'x' }),
    /return URL/
  );
});

test('PayPalProvider initiatePayment rejects when currency is missing', async () => {
  const provider = new PayPalProvider({ clientId: 'id', clientSecret: 'secret', returnUrl: 'https://example.com/return', fetchImpl: async () => ({}) });

  await assert.rejects(() => provider.initiatePayment({ amount: 10, reference: 'x' }), /currency/);
});

test('PayPalProvider caches the OAuth token across calls instead of fetching one per request', async () => {
  const { fetchImpl, calls } = makeFetch([
    TOKEN_RESPONSE,
    { status: 201, body: { id: 'ORDER-A', links: [{ rel: 'approve', href: 'https://paypal.example.com/a' }] } },
    { status: 201, body: { id: 'ORDER-B', links: [{ rel: 'approve', href: 'https://paypal.example.com/b' }] } }
  ]);

  const provider = new PayPalProvider({ clientId: 'id', clientSecret: 'secret', returnUrl: 'https://example.com/return', fetchImpl });

  await provider.initiatePayment({ amount: 10, currency: 'EUR', reference: 'a' });
  await provider.initiatePayment({ amount: 10, currency: 'EUR', reference: 'b' });

  // 1 token call + 2 order-creation calls, not 2 token calls + 2 order calls.
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'https://api-m.sandbox.paypal.com/v1/oauth2/token');
});

test('PayPalProvider captureOrder posts to the capture endpoint and returns {ok:true, data} on success', async () => {
  const captureBody = {
    status: 'COMPLETED',
    payer: { name: { given_name: 'Jane', surname: 'Doe' }, email_address: 'jane@example.com' },
    purchase_units: [
      {
        reference_id: 'AM-ORDER1',
        shipping: { address: { address_line_1: '12 Main St', postal_code: '10115', admin_area_2: 'Berlin', country_code: 'DE' } },
        payments: { captures: [{ id: 'CAPTURE-1', status: 'COMPLETED', amount: { currency_code: 'EUR', value: '27.40' } }] }
      }
    ]
  };
  const { fetchImpl, calls } = makeFetch([TOKEN_RESPONSE, { status: 201, body: captureBody }]);

  const provider = new PayPalProvider({ clientId: 'id', clientSecret: 'secret', fetchImpl });
  const result = await provider.captureOrder('ORDER-1');

  assert.equal(calls[1].url, 'https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-1/capture');
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, captureBody);
});

test('PayPalProvider captureOrder sends a deterministic PayPal-Request-Id so a near-simultaneous double call (webhook racing checkStatus\'s self-heal poll) resolves to one capture, not a double charge', async () => {
  const { fetchImpl, calls } = makeFetch([TOKEN_RESPONSE, { status: 201, body: { status: 'COMPLETED', purchase_units: [{}] } }]);

  const provider = new PayPalProvider({ clientId: 'id', clientSecret: 'secret', fetchImpl });
  await provider.captureOrder('ORDER-RACE');

  assert.equal(calls[1].init.headers['PayPal-Request-Id'], 'capture:ORDER-RACE');
});

test('PayPalProvider captureOrder returns {ok:false} instead of throwing on a non-capturable order (422)', async () => {
  const { fetchImpl } = makeFetch([
    TOKEN_RESPONSE,
    { status: 422, body: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'PAYER_ACTION_REQUIRED' }] } }
  ]);

  const provider = new PayPalProvider({ clientId: 'id', clientSecret: 'secret', fetchImpl });
  const result = await provider.captureOrder('ORDER-NOT-APPROVED');

  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
});

test('PayPalProvider checkStatus maps a completed order to COMPLETED without attempting a capture', async () => {
  const { fetchImpl, calls } = makeFetch([TOKEN_RESPONSE, { status: 200, body: { status: 'COMPLETED' } }]);

  const provider = new PayPalProvider({ clientId: 'id', clientSecret: 'secret', fetchImpl });
  const result = await provider.checkStatus('ORDER-1');

  assert.equal(calls.length, 2, 'no extra capture call for an already-completed order');
  assert.equal(result.status, 'COMPLETED');
});

test('PayPalProvider checkStatus self-heals a stuck APPROVED order by capturing it', async () => {
  const { fetchImpl, calls } = makeFetch([
    TOKEN_RESPONSE,
    { status: 200, body: { status: 'APPROVED' } },
    { status: 201, body: { status: 'COMPLETED', purchase_units: [{}] } }
  ]);

  const provider = new PayPalProvider({ clientId: 'id', clientSecret: 'secret', fetchImpl });
  const result = await provider.checkStatus('ORDER-STUCK');

  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, 'https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-STUCK/capture');
  assert.equal(result.status, 'COMPLETED');
});

// This self-heal path is a genuine alternate route to the same capture
// response the CHECKOUT.ORDER.APPROVED webhook's own capture normally feeds
// into routes/payments.js's recordPaypalCapture - if this poll is what
// actually drives the capture (e.g. because that webhook's delivery failed
// signature verification, a real production scenario this codebase has hit),
// the payer/shipping data must not be silently dropped. See
// paymentGateway.test.js for the metadata-merge side of this.
test('PayPalProvider checkStatus self-heal capture also extracts payer name, shipping address, and contact', async () => {
  const { fetchImpl } = makeFetch([
    TOKEN_RESPONSE,
    { status: 200, body: { status: 'APPROVED' } },
    {
      status: 201,
      body: {
        status: 'COMPLETED',
        payer: { name: { given_name: 'Jane', surname: 'Doe' }, email_address: 'jane@example.com' },
        purchase_units: [
          {
            shipping: {
              address: {
                address_line_1: '12 Main St',
                postal_code: '10115',
                admin_area_2: 'Berlin',
                country_code: 'DE'
              }
            }
          }
        ]
      }
    }
  ]);

  const provider = new PayPalProvider({ clientId: 'id', clientSecret: 'secret', fetchImpl });
  const result = await provider.checkStatus('ORDER-STUCK-WITH-ADDRESS');

  assert.equal(result.payerName, 'Jane Doe');
  assert.equal(result.shippingAddress, '12 Main St, 10115 Berlin, DE');
  assert.equal(result.payerContact, 'jane@example.com');
});

test('PayPalProvider checkStatus does not return payerName/shippingAddress/payerContact when the order was already completed (no self-heal capture attempted)', async () => {
  const { fetchImpl } = makeFetch([TOKEN_RESPONSE, { status: 200, body: { status: 'COMPLETED' } }]);

  const provider = new PayPalProvider({ clientId: 'id', clientSecret: 'secret', fetchImpl });
  const result = await provider.checkStatus('ORDER-1');

  assert.equal(result.payerName, undefined);
  assert.equal(result.shippingAddress, undefined);
  assert.equal(result.payerContact, undefined);
});

test('PayPalProvider checkStatus maps a voided order to FAILED', async () => {
  const { fetchImpl } = makeFetch([TOKEN_RESPONSE, { status: 200, body: { status: 'VOIDED' } }]);

  const provider = new PayPalProvider({ clientId: 'id', clientSecret: 'secret', fetchImpl });
  const result = await provider.checkStatus('ORDER-VOIDED');

  assert.equal(result.status, 'FAILED');
});

test('PayPalProvider verifyWebhook rejects when webhookId is not configured (fail closed)', async () => {
  const provider = new PayPalProvider({ clientId: 'id', clientSecret: 'secret', fetchImpl: async () => ({}) });

  const ok = await provider.verifyWebhook('{}', {
    transmissionId: 't1',
    transmissionTime: '2026-01-01T00:00:00Z',
    certUrl: 'https://api.paypal.com/cert',
    authAlgo: 'SHA256withRSA',
    transmissionSig: 'sig'
  });

  assert.equal(ok, false);
});

test('PayPalProvider verifyWebhook rejects when a required header is missing', async () => {
  const provider = new PayPalProvider({ clientId: 'id', clientSecret: 'secret', webhookId: 'WH-1', fetchImpl: async () => ({}) });

  const ok = await provider.verifyWebhook('{}', { transmissionId: 't1' });

  assert.equal(ok, false);
});

test('PayPalProvider verifyWebhook posts a postback verification request and trusts verification_status', async () => {
  const { fetchImpl, calls } = makeFetch([TOKEN_RESPONSE, { status: 200, body: { verification_status: 'SUCCESS' } }]);

  const provider = new PayPalProvider({ clientId: 'id', clientSecret: 'secret', webhookId: 'WH-1', fetchImpl });

  const ok = await provider.verifyWebhook('{"id":"evt_1"}', {
    transmissionId: 't1',
    transmissionTime: '2026-01-01T00:00:00Z',
    certUrl: 'https://api.paypal.com/cert',
    authAlgo: 'SHA256withRSA',
    transmissionSig: 'sig'
  });

  assert.equal(calls[1].url, 'https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature');
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.webhook_id, 'WH-1');
  assert.equal(body.transmission_id, 't1');
  assert.deepEqual(body.webhook_event, { id: 'evt_1' });
  assert.equal(ok, true);
});

test('PayPalProvider verifyWebhook rejects when PayPal reports verification_status FAILURE', async () => {
  const { fetchImpl } = makeFetch([TOKEN_RESPONSE, { status: 200, body: { verification_status: 'FAILURE' } }]);

  const provider = new PayPalProvider({ clientId: 'id', clientSecret: 'secret', webhookId: 'WH-1', fetchImpl });

  const ok = await provider.verifyWebhook('{"id":"evt_1"}', {
    transmissionId: 't1',
    transmissionTime: '2026-01-01T00:00:00Z',
    certUrl: 'https://api.paypal.com/cert',
    authAlgo: 'SHA256withRSA',
    transmissionSig: 'sig'
  });

  assert.equal(ok, false);
});

test('PayPalProvider parseWebhook extracts order id (not capture id), amount, externalRef and eventId from PAYMENT.CAPTURE.COMPLETED', () => {
  const provider = new PayPalProvider({ clientId: 'id', clientSecret: 'secret', fetchImpl: async () => ({}) });

  const parsed = provider.parseWebhook({
    id: 'WH-EVENT-1',
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {
      id: 'CAPTURE-1',
      status: 'COMPLETED',
      custom_id: 'AM-ORDER1',
      amount: { currency_code: 'EUR', value: '27.40' },
      supplementary_data: { related_ids: { order_id: 'ORDER-1' } }
    }
  });

  assert.equal(parsed.transactionId, 'ORDER-1', 'must be the order id, not the capture id');
  assert.equal(parsed.externalRef, 'AM-ORDER1');
  assert.equal(parsed.status, 'COMPLETED');
  assert.equal(parsed.amount, 27.4);
  assert.equal(parsed.eventId, 'WH-EVENT-1');
});

test('PayPalProvider parseWebhook maps PAYMENT.CAPTURE.DECLINED to FAILED', () => {
  const provider = new PayPalProvider({ clientId: 'id', clientSecret: 'secret', fetchImpl: async () => ({}) });

  const parsed = provider.parseWebhook({
    id: 'WH-EVENT-2',
    event_type: 'PAYMENT.CAPTURE.DECLINED',
    resource: { id: 'CAPTURE-2', status: 'DECLINED', supplementary_data: { related_ids: { order_id: 'ORDER-2' } } }
  });

  assert.equal(parsed.status, 'FAILED');
});

test('PayPalProvider parseWebhook maps PAYMENT.CAPTURE.PENDING to PENDING, not FAILED - a real, distinct event, not a failure just because it is not literally .COMPLETED', () => {
  const provider = new PayPalProvider({ clientId: 'id', clientSecret: 'secret', fetchImpl: async () => ({}) });

  const parsed = provider.parseWebhook({
    id: 'WH-EVENT-4',
    event_type: 'PAYMENT.CAPTURE.PENDING',
    resource: { id: 'CAPTURE-4', status: 'PENDING', supplementary_data: { related_ids: { order_id: 'ORDER-4' } } }
  });

  assert.equal(parsed.status, 'PENDING');
});

test('PayPalProvider parseWebhook skips unrelated event types (e.g. CHECKOUT.ORDER.APPROVED, handled separately by the route)', () => {
  const provider = new PayPalProvider({ clientId: 'id', clientSecret: 'secret', fetchImpl: async () => ({}) });

  const parsed = provider.parseWebhook({ id: 'WH-EVENT-3', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'ORDER-3' } });

  assert.equal(parsed.transactionId, null);
});

test('mapOrderStatus maps COMPLETED/VOIDED/other order statuses', () => {
  assert.equal(mapOrderStatus('COMPLETED'), 'COMPLETED');
  assert.equal(mapOrderStatus('VOIDED'), 'FAILED');
  assert.equal(mapOrderStatus('CREATED'), 'PENDING');
  assert.equal(mapOrderStatus('APPROVED'), 'PENDING');
});

test('mapCaptureStatus maps COMPLETED/DECLINED/other capture statuses - a 2xx capture response is not automatically COMPLETED', () => {
  assert.equal(mapCaptureStatus('COMPLETED'), 'COMPLETED');
  assert.equal(mapCaptureStatus('DECLINED'), 'FAILED');
  assert.equal(mapCaptureStatus('DENIED'), 'FAILED');
  assert.equal(mapCaptureStatus('PENDING'), 'PENDING');
  assert.equal(mapCaptureStatus(undefined), 'PENDING');
});

test('formatShippingAddress flattens a PayPal address into a single readable string', () => {
  const formatted = formatShippingAddress({
    address_line_1: '12 Main St',
    address_line_2: 'Apt 4',
    postal_code: '10115',
    admin_area_2: 'Berlin',
    admin_area_1: 'BE',
    country_code: 'DE'
  });

  assert.equal(formatted, '12 Main St, Apt 4, 10115 Berlin, BE, DE');
});

test('formatShippingAddress returns null for a missing/empty address', () => {
  assert.equal(formatShippingAddress(null), null);
  assert.equal(formatShippingAddress({}), null);
});

test('formatPayerName joins given_name and surname', () => {
  assert.equal(formatPayerName({ name: { given_name: 'Jane', surname: 'Doe' } }), 'Jane Doe');
  assert.equal(formatPayerName(null), null);
  assert.equal(formatPayerName({ name: {} }), null);
});

// See afromarket-dual-completion-trigger-and-contact-field.md - the order
// confirmation's "Contact:" line was rendering empty because nothing
// extracted this from PayPal's capture response at all before.
test('formatPayerContact prefers email over phone when both are present', () => {
  assert.equal(
    formatPayerContact({ email_address: 'jane@example.com', phone: { phone_number: { national_number: '15551234567' } } }),
    'jane@example.com'
  );
});

test('formatPayerContact falls back to phone when email is absent', () => {
  assert.equal(formatPayerContact({ phone: { phone_number: { national_number: '15551234567' } } }), '15551234567');
});

test('formatPayerContact returns null when the payer has neither email nor phone', () => {
  assert.equal(formatPayerContact(null), null);
  assert.equal(formatPayerContact({}), null);
  assert.equal(formatPayerContact({ email_address: '' }), null);
});
