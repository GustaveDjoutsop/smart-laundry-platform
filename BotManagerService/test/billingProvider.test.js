const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { StripeBillingProvider } = require('../src/core/billing/billingProvider');

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

function stripeSignatureHeader(secret, rawBody, timestamp = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${timestamp}.${rawBody}`;
  const v1 = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

test('StripeBillingProvider isConfigured reflects secretKey presence', () => {
  const configured = new StripeBillingProvider({ secretKey: 'sk_test', fetchImpl: async () => ({}) });
  const unconfigured = new StripeBillingProvider({ fetchImpl: async () => ({}) });

  assert.equal(configured.isConfigured(), true);
  assert.equal(unconfigured.isConfigured(), false);
});

test('createCustomer posts email/name/botId metadata to /v1/customers', async () => {
  const { fetchImpl, calls } = makeFetch([{ status: 200, body: { id: 'cus_123' } }]);
  const provider = new StripeBillingProvider({ secretKey: 'sk_test', fetchImpl });

  const customer = await provider.createCustomer({ email: 'owner@afromarket.example.com', name: 'AfroMarket', botId: 'afromarket' });

  assert.equal(calls[0].url, 'https://api.stripe.com/v1/customers');
  assert.match(calls[0].init.body, /email=owner%40afromarket\.example\.com/);
  assert.match(calls[0].init.body, /metadata%5BbotId%5D=afromarket/);
  assert.equal(customer.id, 'cus_123');
});

test('createCustomer rejects when email is missing', async () => {
  const provider = new StripeBillingProvider({ secretKey: 'sk_test', fetchImpl: async () => ({}) });
  await assert.rejects(() => provider.createCustomer({ botId: 'afromarket' }), /email/);
});

test('createCustomer forwards idempotencyKey as the Idempotency-Key header when provided', async () => {
  const { fetchImpl, calls } = makeFetch([{ status: 200, body: { id: 'cus_123' } }]);
  const provider = new StripeBillingProvider({ secretKey: 'sk_test', fetchImpl });

  await provider.createCustomer({ email: 'owner@example.com', botId: 'afromarket', idempotencyKey: 'billing-customer-afromarket' });

  assert.equal(calls[0].init.headers['Idempotency-Key'], 'billing-customer-afromarket');
});

test('createCustomer sends no Idempotency-Key header when none is provided', async () => {
  const { fetchImpl, calls } = makeFetch([{ status: 200, body: { id: 'cus_123' } }]);
  const provider = new StripeBillingProvider({ secretKey: 'sk_test', fetchImpl });

  await provider.createCustomer({ email: 'owner@example.com', botId: 'afromarket' });

  assert.equal(calls[0].init.headers['Idempotency-Key'], undefined);
});

test('createSubscriptionCheckoutSession posts subscription-mode Checkout Session with the price and botId metadata', async () => {
  const { fetchImpl, calls } = makeFetch([{ status: 200, body: { id: 'cs_sub_1', url: 'https://checkout.stripe.com/c/pay/cs_sub_1' } }]);
  const provider = new StripeBillingProvider({
    secretKey: 'sk_test',
    successUrl: 'https://botmanagerservice.example.com/billing/return',
    fetchImpl
  });

  const result = await provider.createSubscriptionCheckoutSession({ customerId: 'cus_123', priceId: 'price_pro', botId: 'afromarket' });

  assert.equal(calls[0].url, 'https://api.stripe.com/v1/checkout/sessions');
  const body = calls[0].init.body;
  assert.match(body, /mode=subscription/);
  assert.match(body, /customer=cus_123/);
  assert.match(body, /client_reference_id=afromarket/);
  assert.match(body, /line_items%5B0%5D%5Bprice%5D=price_pro/);
  assert.match(body, /subscription_data%5Bmetadata%5D%5BbotId%5D=afromarket/);
  assert.equal(result.url, 'https://checkout.stripe.com/c/pay/cs_sub_1');
});

test('createSubscriptionCheckoutSession rejects without a configured or passed success URL', async () => {
  const provider = new StripeBillingProvider({ secretKey: 'sk_test', fetchImpl: async () => ({}) });
  await assert.rejects(
    () => provider.createSubscriptionCheckoutSession({ customerId: 'cus_123', priceId: 'price_pro', botId: 'afromarket' }),
    /success URL/
  );
});

test('createPortalSession posts to /v1/billing_portal/sessions with the customer and return URL', async () => {
  const { fetchImpl, calls } = makeFetch([{ status: 200, body: { id: 'bps_1', url: 'https://billing.stripe.com/session/bps_1' } }]);
  const provider = new StripeBillingProvider({
    secretKey: 'sk_test',
    portalReturnUrl: 'https://botmanagerservice.example.com/billing/portal-return',
    fetchImpl
  });

  const result = await provider.createPortalSession({ customerId: 'cus_123' });

  assert.equal(calls[0].url, 'https://api.stripe.com/v1/billing_portal/sessions');
  assert.match(calls[0].init.body, /customer=cus_123/);
  assert.equal(result.url, 'https://billing.stripe.com/session/bps_1');
});

test('retrieveSubscription GETs /v1/subscriptions/:id and returns the live subscription', async () => {
  const { fetchImpl, calls } = makeFetch([{ status: 200, body: { id: 'sub_456', status: 'active' } }]);
  const provider = new StripeBillingProvider({ secretKey: 'sk_test', fetchImpl });

  const subscription = await provider.retrieveSubscription('sub_456');

  assert.equal(calls[0].url, 'https://api.stripe.com/v1/subscriptions/sub_456');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(subscription.status, 'active');
});

test('retrieveSubscription rejects without a subscriptionId', async () => {
  const provider = new StripeBillingProvider({ secretKey: 'sk_test', fetchImpl: async () => ({}) });
  await assert.rejects(() => provider.retrieveSubscription(), /subscriptionId/);
});

test('provider methods throw a clear error on a non-2xx Stripe response', async () => {
  const { fetchImpl } = makeFetch([{ status: 402, body: { error: { message: 'card declined' } } }]);
  const provider = new StripeBillingProvider({ secretKey: 'sk_test', fetchImpl });

  await assert.rejects(() => provider.createCustomer({ email: 'x@example.com' }), /Stripe billing request failed/);
});

test('verifyWebhook accepts a correctly-signed payload signed with the billing-specific webhook secret', () => {
  const secret = 'whsec_billing_test';
  const rawBody = '{"id":"evt_billing_1"}';
  const provider = new StripeBillingProvider({ secretKey: 'sk_test', webhookSecret: secret, fetchImpl: async () => ({}) });

  assert.equal(provider.verifyWebhook(rawBody, stripeSignatureHeader(secret, rawBody)), true);
  assert.equal(provider.verifyWebhook(rawBody, stripeSignatureHeader('wrong-secret', rawBody)), false);
  assert.equal(provider.verifyWebhook(rawBody, undefined), false);
});

test('parseWebhook extracts customer/subscription from checkout.session.completed (mode=subscription)', () => {
  const provider = new StripeBillingProvider({ secretKey: 'sk_test', fetchImpl: async () => ({}) });

  const parsed = provider.parseWebhook({
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: { object: { mode: 'subscription', customer: 'cus_123', subscription: 'sub_456' } }
  });

  assert.equal(parsed.customerId, 'cus_123');
  assert.equal(parsed.subscriptionId, 'sub_456');
  assert.equal(parsed.status, null);
});

test('parseWebhook ignores a checkout.session.completed for a one-time payment (mode=payment)', () => {
  const provider = new StripeBillingProvider({ secretKey: 'sk_test', fetchImpl: async () => ({}) });

  const parsed = provider.parseWebhook({
    id: 'evt_2',
    type: 'checkout.session.completed',
    data: { object: { mode: 'payment', customer: 'cus_123' } }
  });

  assert.equal(parsed.subscriptionId, null);
});

test('parseWebhook normalizes customer.subscription.created status - a trialing subscription\'s first event', () => {
  const provider = new StripeBillingProvider({ secretKey: 'sk_test', fetchImpl: async () => ({}) });

  const parsed = provider.parseWebhook({
    id: 'evt_created',
    type: 'customer.subscription.created',
    data: { object: { id: 'sub_456', customer: 'cus_123', status: 'trialing' } }
  });

  assert.equal(parsed.subscriptionId, 'sub_456');
  assert.equal(parsed.status, 'TRIALING');
});

test('parseWebhook normalizes customer.subscription.updated status', () => {
  const provider = new StripeBillingProvider({ secretKey: 'sk_test', fetchImpl: async () => ({}) });

  const parsed = provider.parseWebhook({
    id: 'evt_3',
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_456', customer: 'cus_123', status: 'past_due' } }
  });

  assert.equal(parsed.subscriptionId, 'sub_456');
  assert.equal(parsed.status, 'PAST_DUE');
});

test('parseWebhook treats invoice.paid as ACTIVE and invoice.payment_failed as PAST_DUE, reading subscription from either invoice shape', () => {
  const provider = new StripeBillingProvider({ secretKey: 'sk_test', fetchImpl: async () => ({}) });

  const paid = provider.parseWebhook({
    id: 'evt_4',
    type: 'invoice.paid',
    data: { object: { customer: 'cus_123', subscription: 'sub_456' } }
  });
  assert.equal(paid.status, 'ACTIVE');
  assert.equal(paid.subscriptionId, 'sub_456');

  // Newer API versions move subscription under parent.subscription_details.
  const failed = provider.parseWebhook({
    id: 'evt_5',
    type: 'invoice.payment_failed',
    data: { object: { customer: 'cus_123', parent: { subscription_details: { subscription: 'sub_789' } } } }
  });
  assert.equal(failed.status, 'PAST_DUE');
  assert.equal(failed.subscriptionId, 'sub_789');
});

test('parseWebhook returns a null subscriptionId for unrelated event types instead of guessing', () => {
  const provider = new StripeBillingProvider({ secretKey: 'sk_test', fetchImpl: async () => ({}) });

  const parsed = provider.parseWebhook({ id: 'evt_6', type: 'customer.updated', data: { object: { id: 'cus_123' } } });
  assert.equal(parsed.subscriptionId, null);
  assert.equal(parsed.status, null);
});
