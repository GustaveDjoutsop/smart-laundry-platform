const { ConfigBot } = require('../base/ConfigBot');
const { AfroMarketFlowPlugin, buildOrderConfirmationText, findProduct } = require('./afromarketFlowPlugin');
const { redisManager } = require('../../core/redisManager');
const { paymentEvents } = require('../../core/payments/paymentEvents');
const { CustomerProfileStore } = require('../../core/customers/customerProfileStore');
const { InvoiceRecordStore } = require('../../core/invoices/invoiceRecordStore');
const { DeletionRequestLogStore } = require('../../core/customers/deletionRequestLogStore');
const { DeletionRequestService } = require('../../core/customers/deletionRequestService');
const { CustomerIdentityLinkStore } = require('../../core/customers/customerIdentityLinkStore');
const { IdentityResolver } = require('../../core/customers/identityResolver');
const { getAppConfig } = require('../../core/appConfig');
const { logger } = require('../../utils/logger');

// Matches datenloeschung.html's promised keywords, plus French since Cameroon
// is AfroMarket's core user base (other bots in this repo already localize
// for French). Case-insensitive, matched on the trimmed full message body.
const ERASURE_TRIGGER_WORDS = ['löschen', 'loeschen', 'delete', 'supprimer'];
const ERASURE_CONFIRM_WORDS = ['ja', 'yes', 'oui'];
const ERASURE_PENDING_TTL_SECONDS = 5 * 60;

function buildOrderConfirmLockKey({ botId, transactionId }) {
  return `orderConfirmSent:${botId}:${transactionId}`;
}

// Deliberately a separate key from buildOrderConfirmLockKey above, not a
// reuse of it - that lock is acquired the moment payment.completed fires
// (whether the order finalizes immediately or is deferred pending an
// address), so it's already held by the time _onPostPaymentAddressCaptured
// runs. Finalizing needs its own idempotency guard against a redelivered/
// duplicate address reply, at a genuinely later point in time.
function buildPostPaymentAddressCapturedLockKey({ botId, transactionId }) {
  return `orderAddressCaptured:${botId}:${transactionId}`;
}

function buildErasurePendingKey({ botId, from }) {
  return `deletePending:${botId}:${from}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A transient DB blip must not silently and permanently lose an invoice -
// there's no later retry path for it (payment.completed fires exactly once
// per transaction; the order-confirmation dedup lock means a redelivered
// event returns early before ever reaching this call again). Bounded and
// short so it can't meaningfully delay the customer's order confirmation.
async function withRetries(fn, { attempts = 3, delaysMs = [150, 400] } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < delaysMs.length) await sleep(delaysMs[attempt]);
    }
  }
  throw lastErr;
}

class AfroMarketBot extends ConfigBot {
  constructor(config) {
    const customerProfileStore = new CustomerProfileStore();
    super(config, { plugin: new AfroMarketFlowPlugin({ botConfig: config, customerProfileStore }) });

    this.customerProfileStore = customerProfileStore;
    this.invoiceRecordStore = new InvoiceRecordStore();
    this.customerIdentityLinkStore = new CustomerIdentityLinkStore();
    this.identityResolver = new IdentityResolver({ customerIdentityLinkStore: this.customerIdentityLinkStore });
    this.deletionRequestService = new DeletionRequestService({
      customerProfileStore: this.customerProfileStore,
      deletionRequestLogStore: new DeletionRequestLogStore(),
      customerIdentityLinkStore: this.customerIdentityLinkStore
    });

    this._onPaymentCompleted = this._onPaymentCompleted.bind(this);
    this._onPostPaymentAddressCaptured = this._onPostPaymentAddressCaptured.bind(this);
    if (paymentEvents && paymentEvents.on) {
      paymentEvents.on('payment.completed', this._onPaymentCompleted);
      // See afromarket-remove-prepayment-address-collection.md - fired by
      // afromarketFlowPlugin.js's _handleCapturePostPaymentAddress once the
      // customer replies to the post-payment address prompt
      // _askForPostPaymentAddress below sends them into.
      paymentEvents.on('afromarket.post_payment_address_captured', this._onPostPaymentAddressCaptured);
    }
  }

  // Global intercepts ahead of normal flow dispatch, checked in order:
  // 1. A native cart submission (WhatsApp's own inbound `type: "order"`
  //    message) - the one deterministic "customer wants to buy this" signal
  //    in the system (see afromarket-catalog-cart-migration-todo.md Phase 3).
  // 2. Erasure - a customer mid-checkout should still be able to trigger it,
  //    not just from the main menu.
  async handleMessage({ from, message, phone, bsuid }) {
    // Fire-and-forget, not awaited: QueueManager drains inbound messages
    // one at a time (see whatsappHandler.js), so awaiting a DB-backed
    // resolve() here - flagged in review - would add real latency to every
    // paired-identifier message and back up every other customer's message
    // behind it. Errors are still caught and logged inside the helper; they
    // just aren't allowed to block or be awaited by this turn's handling.
    this._maybeLinkIdentity({ phone, bsuid });

    if (message && message.type === 'order') {
      const handledByOrder = await this._handleNativeOrder({ from, message });
      if (handledByOrder) return;
    }

    const handledByErasure = await this._handleErasureIntercept({ from, message });
    if (handledByErasure) return;

    return super.handleMessage({ from, message, phone });
  }

  // Best-effort, genuinely non-blocking (see handleMessage's comment - not
  // awaited by its caller). Only fires when this specific webhook carried
  // both identifiers together (Meta's Portfolio Contact Book pairing) - see
  // afromarket-identity-linkage-design.md. Most messages carry only one
  // identifier and this is a no-op for them.
  async _maybeLinkIdentity({ phone, bsuid }) {
    if (!phone || !bsuid) return;

    try {
      await this.identityResolver.resolve({
        primary: { type: 'phone', value: phone },
        pairedWith: { type: 'bsuid', value: bsuid }
      });
    } catch (err) {
      logger.error('AfroMarket: identity linkage failed', err && err.message ? err.message : String(err));
    }
  }

  // Native WhatsApp cart submissions arrive as an inbound `type: "order"`
  // message carrying catalog_id + a list of product_retailer_id/quantity/
  // item_price lines - this replaces the old manual "Add to Cart" flow as
  // the way `context.cart` gets populated, but reuses everything downstream
  // of it (address collection, _handleCheckout, Stripe metadata.cart,
  // _recordOrder) unchanged.
  async _handleNativeOrder({ from, message }) {
    const order = message && message.order ? message.order : null;
    const items = Array.isArray(order?.product_items) ? order.product_items : [];
    if (!order || !items.length) return false;

    const botId = this.config && this.config.botId ? this.config.botId : 'afromarket';
    const cart = [];
    const unknownRetailerIds = [];

    for (const item of items) {
      const retailerId = String(item?.product_retailer_id || '').trim();
      if (!retailerId) continue;

      // Security requirement, not optional: never trust item.item_price/
      // item.currency from the webhook as authoritative - the customer's
      // WhatsApp app can be showing a stale cached catalog snapshot. Always
      // recompute from the current products config, the same source of
      // truth the (now-legacy) manual add-to-cart flow already used.
      const product = findProduct(this.config, retailerId);
      if (!product) {
        unknownRetailerIds.push(retailerId);
        continue;
      }

      const quantity = Math.max(1, Math.trunc(Number(item?.quantity)) || 1);
      const existingLine = cart.find((line) => line.productId === product.id);
      if (existingLine) {
        existingLine.qty += quantity;
      } else {
        cart.push({ productId: product.id, name: product.name, unitPrice: Number(product.priceEur) || 0, unit: product.unit, qty: quantity });
      }
    }

    if (unknownRetailerIds.length) {
      logger.warn('AfroMarket: order webhook referenced unknown product_retailer_id(s), skipping those lines', {
        botId,
        from,
        unknownRetailerIds
      });
      await this._notifyAdmin(
        `⚠️ AfroMarket order from ${from} referenced unknown product(s): ${unknownRetailerIds.join(', ')}. Those lines were skipped; the rest of the order (if any) was processed normally.`
      );
    }

    if (!cart.length) {
      await this.sendIntent({
        type: 'text',
        to: from,
        body:
          "⚠️ We couldn't recognise any of the items in your cart - the catalog may have changed since you added them. " +
          'Please browse again and add your items fresh.'
      });
      return true;
    }

    // Hand off at the exact point the old manual "View Cart" -> "Checkout"
    // button did: land on checkout_start with the cart already populated, so
    // _handleCheckoutStart's saved-address lookup and everything after it
    // runs completely unchanged.
    const appConfig = getAppConfig();
    const conversationKey = `conv:${botId}:${from}`;
    const existingSerializedState = await redisManager.get(conversationKey);
    const conversationState = existingSerializedState
      ? JSON.parse(existingSerializedState)
      : { currentFlowId: null, currentStateId: null, context: {} };

    // defaultFlowId over a hardcoded 'main_menu' literal, so this doesn't
    // silently break if afromarket.bot.json's flow id ever changes -
    // 'main_menu' only remains as the fallback flowEngine.js itself falls
    // back to when no defaultFlowId is configured.
    conversationState.currentFlowId = this.config.defaultFlowId || 'main_menu';
    conversationState.currentStateId = 'checkout_start';
    conversationState.context = conversationState.context || {};
    conversationState.context.cart = cart;

    await redisManager.setex(conversationKey, appConfig.redis.ttlSeconds, JSON.stringify(conversationState));

    await super.handleMessage({ from, message });
    return true;
  }

  // Best-effort only for now: AFROMARKET_ADMIN_PHONE is optional and unset
  // by default. Full admin notification (sender-restricted intercept,
  // configured admin number, etc.) is the separate feature specified in
  // afromarket-delivery-notifications-todo.md - this just reuses its number
  // once that lands, rather than building it here.
  async _notifyAdmin(text) {
    const adminPhone = String(process.env.AFROMARKET_ADMIN_PHONE || '').trim();
    if (!adminPhone) return;

    try {
      await this.whatsapp.sendText({ to: adminPhone, body: text });
    } catch (err) {
      logger.error('AfroMarket: failed to notify admin', err && err.message ? err.message : String(err));
    }
  }

  async _handleErasureIntercept({ from, message }) {
    const botId = this.config.botId;
    const text = String(message?.text?.body || '').trim().toLowerCase();
    if (!text) return false;

    const pendingKey = buildErasurePendingKey({ botId, from });
    const isPending = await redisManager.get(pendingKey);

    if (isPending) {
      await redisManager.del(pendingKey);

      if (ERASURE_CONFIRM_WORDS.includes(text)) {
        await this._executeErasure({ from });
      } else {
        await this.sendIntent({
          type: 'text',
          to: from,
          body: 'Löschung abgebrochen. Ihre Daten wurden nicht gelöscht.'
        });
      }
      return true;
    }

    if (ERASURE_TRIGGER_WORDS.includes(text)) {
      await redisManager.setex(pendingKey, ERASURE_PENDING_TTL_SECONDS, '1');
      await this.sendIntent({
        type: 'text',
        to: from,
        body:
          'Möchten Sie wirklich alle Ihre persönlichen Daten löschen? ' +
          'Antworten Sie mit JA zum Bestätigen oder mit einer beliebigen anderen Nachricht zum Abbrechen.'
      });
      return true;
    }

    return false;
  }

  async _executeErasure({ from }) {
    const botId = this.config.botId;

    try {
      await this.deletionRequestService.execute({ botId, whatsappId: from });
      await this.sendIntent({
        type: 'text',
        to: from,
        body:
          'Ihre persönlichen Daten wurden gelöscht. Rechnungsdaten bleiben aus gesetzlichen ' +
          'Gründen bis zu 10 Jahre gespeichert (§ 147 AO).'
      });
    } catch (err) {
      logger.error('AfroMarket erasure request failed', err && err.message ? err.message : String(err));
      await this.sendIntent({
        type: 'text',
        to: from,
        body: 'Bei der Löschung ist ein Fehler aufgetreten. Bitte kontaktieren Sie contact@botmanagementservice.eu.'
      });
    }
  }

  async _onPaymentCompleted(event) {
    const botId = this.config && this.config.botId ? this.config.botId : 'afromarket';
    if (!event || event.botId !== botId) return;

    const payment = event.payment || null;
    const metadata = payment && payment.metadata ? payment.metadata : null;
    if (!metadata || metadata.service !== 'afromarket_order') return;

    const transactionId = event.transactionId;
    const customerPhone = payment && payment.customerPhone ? payment.customerPhone : null;

    if (!transactionId) return;

    if (!customerPhone) {
      // Known gap, not yet fixed: a BSUID-only customer (no real phone
      // number captured at checkout - see afromarketFlowPlugin's
      // _handleCheckoutStart) can complete payment and land exactly here,
      // silently losing their order confirmation, invoice, and profile
      // write. The real fix is prompting for a phone via WhatsApp's
      // REQUEST_CONTACT_INFO button before checkout, deferred per
      // afromarket-identity-linkage-design.md - this WARN only makes the
      // loss observable instead of invisible until it's built.
      logger.warn('AfroMarket order paid but has no customerPhone - confirmation/invoice/profile write skipped', {
        botId,
        transactionId
      });
      return;
    }

    const lockKey = buildOrderConfirmLockKey({ botId, transactionId });
    const acquiredLock = await redisManager.setnx(lockKey, '1', 60 * 60 * 24);
    if (!acquiredLock) return;

    // Same PayPal-over-chat preference as _recordOrder - the customer should
    // see (or be asked for) the address their order is actually shipping
    // to, not a stale chat-entered one PayPal's own data has since
    // superseded. With pre-payment collection removed for the PayPal path
    // (see afromarket-remove-prepayment-address-collection.md),
    // metadata.name/address are now genuinely absent rather than merely
    // secondary for most PayPal orders - not every PayPal payment method
    // (a guest/card payment through the Payment Link) returns a shipping
    // address either.
    const buyerName = metadata.paypalPayerName || metadata.name || null;
    const buyerAddress = metadata.paypalShippingAddress || metadata.address || null;

    if (!buyerAddress) {
      // Money has already moved - this must never block or reverse that.
      // invoice_record is legally append-only (no update() - see
      // InvoiceRecordStore, § 147 AO / § 257 HGB), so _recordOrder's insert
      // is deliberately deferred rather than writing a permanently-
      // incomplete invoice now and having no way to fix it once the address
      // does arrive.
      await this._askForPostPaymentAddress({ botId, transactionId, payment, metadata, customerPhone });
      return;
    }

    await this._recordOrder({ botId, transactionId, payment, metadata, customerPhone, buyerName, buyerAddress });

    const confirmationText = buildOrderConfirmationText({
      orderNumber: metadata.orderNumber,
      cart: metadata.cart || [],
      name: buyerName,
      address: buyerAddress,
      phone: metadata.phone,
      shippingFeeEur: metadata.shippingFeeEur
    });

    if (!this.whatsapp.isConfigured()) {
      logger.info('AfroMarket order paid (WhatsApp not configured)', { botId, transactionId, customerPhone });
      return;
    }

    await this.whatsapp.sendButtons({
      to: customerPhone,
      body: confirmationText,
      buttons: [
        { id: 'shop_again', title: '🛍 Shop Again' },
        { id: 'menu', title: '🏠 Main Menu' }
      ]
    });
  }

  // Puts the conversation directly into post_payment_address_needed
  // (afromarket.bot.json) via a direct Redis write - same mechanism
  // _handleNativeOrder (afromarketFlowPlugin.js) already uses to hand off
  // into the flow engine from outside a normal flowEngine.step() call, since
  // this fires from an async payment-webhook event, not an inbound WhatsApp
  // message. The stashed context is everything the eventual
  // afromarket.post_payment_address_captured handler below needs to finish
  // the order - deliberately the same {payment, metadata} shape
  // _recordOrder already takes, so no separate reconstruction logic is
  // needed once the address arrives.
  async _askForPostPaymentAddress({ botId, transactionId, payment, metadata, customerPhone }) {
    // buildOrderConfirmLockKey is already held by the caller at this point
    // (_onPaymentCompleted acquires it before branching into this deferred
    // path), so if anything below throws, this order is stranded for 24h
    // with no address prompt sent and no invoice written - a redelivered
    // payment.completed webhook would just hit the held lock and return
    // early. The lock is released on failure so a redelivery can retry.
    try {
      const appConfig = getAppConfig();
      const conversationKey = `conv:${botId}:${customerPhone}`;
      const existingSerializedState = await redisManager.get(conversationKey);
      const conversationState = existingSerializedState
        ? JSON.parse(existingSerializedState)
        : { currentFlowId: null, currentStateId: null, context: {} };

      conversationState.currentFlowId = this.config.defaultFlowId || 'main_menu';
      conversationState.currentStateId = 'post_payment_address_needed';
      conversationState.context = conversationState.context || {};
      conversationState.context.pendingOrderTransactionId = transactionId;
      conversationState.context.pendingOrderPayment = {
        provider: payment && payment.provider,
        amount: payment && payment.amount,
        currency: payment && payment.currency,
        externalRef: payment && payment.externalRef
      };
      conversationState.context.pendingOrderMetadata = metadata;
      // The already-validated checkout phone, not re-derived from the reply
      // turn's ctx.phone/ctx.from - that fallback chain is BSUID-fragile
      // (see _handleCheckoutStart's own comment on the same issue) and has
      // no guaranteed relationship to the phone this order actually paid
      // under.
      conversationState.context.pendingOrderCustomerPhone = customerPhone;

      await redisManager.setex(conversationKey, appConfig.redis.ttlSeconds, JSON.stringify(conversationState));

      if (!this.whatsapp.isConfigured()) {
        logger.info('AfroMarket order paid but missing a delivery address (WhatsApp not configured)', { botId, transactionId, customerPhone });
        return;
      }

      // post_payment_address_needed's own `prompt` field carries this same
      // text for the (normally unreachable) case the flow engine re-prompts
      // on its own - sent here explicitly because entering that state via a
      // direct Redis write, not a ctx.goto() inside a flowEngine.step()
      // call, doesn't trigger the engine's own "just entered an input
      // state, send its prompt" behavior.
      await this.whatsapp.sendText({
        to: customerPhone,
        body: `✅ Payment received! We just need your delivery address to ship this — what's the full address?`
      });
    } catch (error) {
      logger.error('AfroMarket: failed to stash pending order and prompt for a post-payment address - releasing the confirm lock so a redelivered webhook can retry', {
        botId,
        transactionId,
        customerPhone,
        error: error.message
      });
      await redisManager.del(buildOrderConfirmLockKey({ botId, transactionId })).catch(() => {});
    }
  }

  // Fired by afromarketFlowPlugin.js's _handleCapturePostPaymentAddress once
  // the customer replies with their address. Finalizes exactly what
  // _onPaymentCompleted would have done immediately if PayPal had returned
  // the address in the first place.
  async _onPostPaymentAddressCaptured(event) {
    const botId = this.config && this.config.botId ? this.config.botId : 'afromarket';
    if (!event || event.botId !== botId) return;

    const { transactionId, customerPhone, address, payment, metadata } = event;
    if (!transactionId || !customerPhone || !address || !metadata) {
      // The emitter (_handleCapturePostPaymentAddress) already guarantees
      // transactionId/payment/metadata and checks address before emitting,
      // so a falsy value here in practice means a missing customerPhone -
      // logged rather than silently dropped so a stuck order is observable
      // instead of just never finalizing.
      logger.error('AfroMarket: post-payment-address-captured event is missing required fields, dropping it', {
        botId,
        transactionId,
        customerPhone,
        hasAddress: Boolean(address),
        hasMetadata: Boolean(metadata)
      });
      return;
    }

    const lockKey = buildPostPaymentAddressCapturedLockKey({ botId, transactionId });
    const acquiredLock = await redisManager.setnx(lockKey, '1', 60 * 60 * 24);
    if (!acquiredLock) return;

    const buyerName = metadata.paypalPayerName || metadata.name || null;

    await this._recordOrder({ botId, transactionId, payment, metadata, customerPhone, buyerName, buyerAddress: address });

    const confirmationText = buildOrderConfirmationText({
      orderNumber: metadata.orderNumber,
      cart: metadata.cart || [],
      name: buyerName,
      address,
      phone: metadata.phone,
      shippingFeeEur: metadata.shippingFeeEur
    });

    if (!this.whatsapp.isConfigured()) {
      logger.info('AfroMarket order finalized after post-payment address capture (WhatsApp not configured)', { botId, transactionId, customerPhone });
      return;
    }

    await this.whatsapp.sendButtons({
      to: customerPhone,
      body: confirmationText,
      buttons: [
        { id: 'shop_again', title: '🛍 Shop Again' },
        { id: 'menu', title: '🏠 Main Menu' }
      ]
    });
  }

  // Snapshots the order into invoice_record (append-only, 10y retention) and
  // upserts customer_profile. Best-effort: a bookkeeping/profile write
  // failure must not block the customer's order confirmation from sending.
  //
  // buyerName/buyerAddress are resolved by the caller (_onPaymentCompleted
  // or _onPostPaymentAddressCaptured), not recomputed here - the latter's
  // address came from the customer's own post-payment reply, not from
  // metadata.paypalShippingAddress/metadata.address at all, so a single
  // COALESCE here couldn't express both callers' logic correctly.
  async _recordOrder({ botId, transactionId, payment, metadata, customerPhone, buyerName, buyerAddress }) {
    try {
      await withRetries(() =>
        this.invoiceRecordStore.insert({
          botId,
          transactionId,
          provider: (payment && payment.provider) || 'unknown',
          buyerName,
          buyerAddress,
          buyerPhone: customerPhone,
          lineItems: metadata.cart || [],
          amount: payment && payment.amount,
          currency: payment && payment.currency,
          taxStatus: '§ 19 Abs. 1 UStG (Kleinunternehmerregelung) – keine Umsatzsteuer ausgewiesen',
          paymentReference: (payment && payment.externalRef) || null
        })
      );
    } catch (err) {
      // No later retry path exists for this transaction (see withRetries) -
      // this is the last line of defense before the invoice is permanently
      // lost. Logged loudly on purpose; there's no alerting pipeline yet.
      logger.error(
        `PERMANENT invoice-write failure for AfroMarket order (botId=${botId}, transactionId=${transactionId})`,
        err && err.message ? err.message : String(err)
      );
    }

    // Best-effort, and deliberately outside the upsert's try/catch below: a
    // failed identity resolution must still let the profile upsert proceed
    // (with customerId left null) rather than lose the whole write - see
    // customerProfileStore.upsert's COALESCE comment.
    let customerId = null;
    try {
      customerId = await this.identityResolver.resolve({ primary: { type: 'phone', value: customerPhone } });
    } catch (err) {
      logger.error(
        'AfroMarket: identity resolution failed while recording order',
        err && err.message ? err.message : String(err)
      );
    }

    try {
      // `email: metadata.email || null` means an explicit "skip" at
      // checkout_email (which sets checkoutEmail = '') upserts as null here,
      // and customerProfileStore's COALESCE(EXCLUDED.email,
      // customer_profile.email) then keeps whatever email is already on
      // file rather than clearing it - a "skip" only ever means "not
      // required for this specific order" here, never "forget the email I
      // gave you before" (there's no code path today for the latter).
      // Reviewed and confirmed unreachable on the Stripe-active path: when
      // Stripe is the active provider, _handleCheckout forces
      // checkout_email_required whenever email is still empty, so a real
      // email always exists there by the time this upsert runs. Not true on
      // the PayPal-active path (the default) - PayPal never requires an
      // email upfront, so metadata.email can genuinely be null/empty for a
      // completed PayPal order, and this upsert correctly leaves any
      // existing profile email untouched via COALESCE rather than clearing
      // it.
      await this.customerProfileStore.upsert({
        botId,
        whatsappId: customerPhone,
        name: buyerName,
        deliveryAddress: buyerAddress,
        email: metadata.email || null,
        customerId
      });
    } catch (err) {
      logger.error('Failed to upsert customer profile for AfroMarket order', err && err.message ? err.message : String(err));
    }
  }
}

module.exports = { AfroMarketBot };
