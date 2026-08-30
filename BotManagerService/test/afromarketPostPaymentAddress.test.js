// Covers afromarket-remove-prepayment-address-collection.md point 3: the
// post_payment_address_needed flow state and _handleCapturePostPaymentAddress
// (afromarketFlowPlugin.js), which AfroMarketBot.js's _askForPostPaymentAddress
// puts the conversation into directly (see afromarketOrderRecording.test.js
// for that side, and for _onPostPaymentAddressCaptured which finalizes the
// order once this handler's emitted event reaches it).
const test = require('node:test');
const assert = require('node:assert/strict');

const { FlowEngine } = require('../src/core/flows/flowEngine');
const { AfroMarketFlowPlugin } = require('../src/bots/afromarket/afromarketFlowPlugin');
const { paymentEvents } = require('../src/core/payments/paymentEvents');

// eslint-disable-next-line global-require
const botConfig = require('../configs/bots/afromarket.bot.json');

function pendingOrderState(overrides = {}) {
  return {
    currentFlowId: 'main_menu',
    currentStateId: 'post_payment_address_needed',
    context: {
      pendingOrderTransactionId: 'ORDER-pending-1',
      pendingOrderPayment: { provider: 'paypal', amount: 27.4, currency: 'EUR', externalRef: 'ORDER-pending-1' },
      pendingOrderMetadata: { service: 'afromarket_order', orderNumber: 'AM-PENDING', cart: [{ productId: 'x', qty: 1 }] },
      // The phone the order actually paid under, stashed by
      // AfroMarketBot.js's _askForPostPaymentAddress - deliberately
      // different from the `from`/`phone` step() sends below in some
      // tests, to prove the emitted event uses this persisted value, not
      // whatever identifier this reply turn happens to arrive on.
      pendingOrderCustomerPhone: '+491701234567',
      ...overrides
    }
  };
}

async function step(state, text, { from = '+491701234567', phone = '+491701234567' } = {}) {
  const flowEngine = new FlowEngine({ botConfig, plugin: new AfroMarketFlowPlugin({ botConfig }) });
  const outboundIntents = [];
  const result = await flowEngine.step({
    from,
    phone,
    message: { text: { body: text } },
    state,
    send: async (intent) => outboundIntents.push(intent)
  });
  return { outboundIntents, conversationState: result.state };
}

test('AfroMarket post-payment address: a free-text reply is captured and emitted for AfroMarketBot to finalize the order', async (t) => {
  const events = [];
  const listener = (event) => events.push(event);
  paymentEvents.on('afromarket.post_payment_address_captured', listener);
  t.after(() => paymentEvents.off('afromarket.post_payment_address_captured', listener));

  const { outboundIntents, conversationState } = await step(pendingOrderState(), '12 Main St, Berlin');

  assert.equal(events.length, 1);
  assert.equal(events[0].botId, 'afromarket');
  assert.equal(events[0].transactionId, 'ORDER-pending-1');
  assert.equal(events[0].address, '12 Main St, Berlin');
  assert.equal(events[0].customerPhone, '+491701234567');
  assert.deepEqual(events[0].payment, { provider: 'paypal', amount: 27.4, currency: 'EUR', externalRef: 'ORDER-pending-1' });
  assert.equal(events[0].metadata.orderNumber, 'AM-PENDING');

  // The full "Order confirmed" message is sent later, asynchronously, by
  // AfroMarketBot's own event listener (see afromarketOrderRecording.test.js)
  // once the DB writes complete - this turn's own response is just the
  // immediate ack.
  assert.equal(outboundIntents.length, 1);
  assert.equal(outboundIntents[0].type, 'buttons');
  assert.match(outboundIntents[0].body, /Finalizing your order/);
  assert.equal(conversationState.currentStateId, 'order_confirmed');
});

test('AfroMarket post-payment address: uses the persisted checkout phone, not this reply turn\'s from/phone', async (t) => {
  const events = [];
  const listener = (event) => events.push(event);
  paymentEvents.on('afromarket.post_payment_address_captured', listener);
  t.after(() => paymentEvents.off('afromarket.post_payment_address_captured', listener));

  // Simulates a BSUID-only contact: this reply turn arrives on a different
  // from/phone than the phone the order actually paid under (persisted in
  // context by AfroMarketBot.js). The emitted event must use the latter.
  const { outboundIntents } = await step(pendingOrderState(), '12 Main St, Berlin', {
    from: 'bsuid:some-routing-id',
    phone: 'bsuid:some-routing-id'
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].customerPhone, '+491701234567');
  assert.equal(outboundIntents[0].type, 'buttons');
});

test('AfroMarket post-payment address: whitespace-only reply re-prompts instead of finalizing with a blank address', async (t) => {
  const events = [];
  const listener = (event) => events.push(event);
  paymentEvents.on('afromarket.post_payment_address_captured', listener);
  t.after(() => paymentEvents.off('afromarket.post_payment_address_captured', listener));

  const { outboundIntents, conversationState } = await step(pendingOrderState(), '   ');

  assert.equal(events.length, 0, 'a blank address must never be emitted as if it were real');
  assert.equal(conversationState.currentStateId, 'post_payment_address_needed');
  assert.equal(outboundIntents[0].type, 'text');
  assert.match(outboundIntents[0].body, /delivery address/i);
});

test('AfroMarket post-payment address: missing pending-order context does not crash - logs and still acknowledges the reply', async (t) => {
  const events = [];
  const listener = (event) => events.push(event);
  paymentEvents.on('afromarket.post_payment_address_captured', listener);
  t.after(() => paymentEvents.off('afromarket.post_payment_address_captured', listener));

  const state = {
    currentFlowId: 'main_menu',
    currentStateId: 'post_payment_address_needed',
    context: {} // no pendingOrderTransactionId/Payment/Metadata at all
  };

  const { outboundIntents, conversationState } = await step(state, '12 Main St, Berlin');

  assert.equal(events.length, 0, 'must not emit a finalize event with no order to attach it to');
  assert.equal(outboundIntents[0].type, 'buttons');
  assert.equal(conversationState.currentStateId, 'order_confirmed');
});
