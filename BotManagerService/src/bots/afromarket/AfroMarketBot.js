const { ConfigBot } = require('../base/ConfigBot');
const { AfroMarketFlowPlugin, buildOrderConfirmationText, findProduct } = require('./afromarketFlowPlugin');
const { redisManager } = require('../../core/redisManager');
const { paymentEvents } = require('../../core/payments/paymentEvents');
const { CustomerProfileStore } = require('../../core/customers/customerProfileStore');
const { InvoiceRecordStore } = require('../../core/invoices/invoiceRecordStore');
const { DeletionRequestLogStore } = require('../../core/customers/deletionRequestLogStore');
const { DeletionRequestService } = require('../../core/customers/deletionRequestService');
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
    this.deletionRequestService = new DeletionRequestService({
      customerProfileStore: this.customerProfileStore,
      deletionRequestLogStore: new DeletionRequestLogStore()
    });

    this._onPaymentCompleted = this._onPaymentCompleted.bind(this);
    if (paymentEvents && paymentEvents.on) {
      paymentEvents.on('payment.completed', this._onPaymentCompleted);
    }
  }

  // Global intercepts ahead of normal flow dispatch, checked in order:
  // 1. A native cart submission (WhatsApp's own inbound `type: "order"`
  //    message) - the one deterministic "customer wants to buy this" signal
  //    in the system (see afromarket-catalog-cart-migration-todo.md Phase 3).
  // 2. Erasure - a customer mid-checkout should still be able to trigger it,
  //    not just from the main menu.
  async handleMessage({ from, message }) {
    if (message && message.type === 'order') {
      const handledByOrder = await this._handleNativeOrder({ from, message });
      if (handledByOrder) return;
    }

    const handledByErasure = await this._handleErasureIntercept({ from, message });
    if (handledByErasure) return;

    return super.handleMessage({ from, message });
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
    if (!transactionId || !customerPhone) return;

    const lockKey = buildOrderConfirmLockKey({ botId, transactionId });
    const acquiredLock = await redisManager.setnx(lockKey, '1', 60 * 60 * 24);
    if (!acquiredLock) return;

    await this._recordOrder({ botId, transactionId, payment, metadata, customerPhone });

    const confirmationText = buildOrderConfirmationText({
      orderNumber: metadata.orderNumber,
      cart: metadata.cart || [],
      name: metadata.name,
      address: metadata.address,
      phone: metadata.phone
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

  // Snapshots the order into invoice_record (append-only, 10y retention) and
  // upserts customer_profile. Best-effort: a bookkeeping/profile write
  // failure must not block the customer's order confirmation from sending.
  async _recordOrder({ botId, transactionId, payment, metadata, customerPhone }) {
    try {
      await withRetries(() =>
        this.invoiceRecordStore.insert({
          botId,
          transactionId,
          provider: (payment && payment.provider) || 'unknown',
          buyerName: metadata.name || null,
          buyerAddress: metadata.address || null,
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

    try {
      // `email: metadata.email || null` means an explicit "skip" at
      // checkout_email (which sets checkoutEmail = '') upserts as null here,
      // and customerProfileStore's COALESCE(EXCLUDED.email,
      // customer_profile.email) then keeps whatever email is already on
      // file rather than clearing it - a "skip" only ever means "not
      // required for this specific order" here, never "forget the email I
      // gave you before" (there's no code path today for the latter).
      // Reviewed and confirmed unreachable on the actual paying-customer
      // path anyway: _handleCheckout forces checkout_email_required
      // whenever Stripe is configured and email is still empty, so a real
      // email always exists by the time this upsert runs for any order that
      // actually completes payment. This only matters at all in the
      // no-payment-provider-configured dev/test path, which doesn't call
      // _recordOrder in the first place (see _handleCheckout's early
      // `!paymentsConfigured` branch).
      await this.customerProfileStore.upsert({
        botId,
        whatsappId: customerPhone,
        name: metadata.name || null,
        deliveryAddress: metadata.address || null,
        email: metadata.email || null
      });
    } catch (err) {
      logger.error('Failed to upsert customer profile for AfroMarket order', err && err.message ? err.message : String(err));
    }
  }
}

module.exports = { AfroMarketBot };
