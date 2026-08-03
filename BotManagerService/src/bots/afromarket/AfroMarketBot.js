const { ConfigBot } = require('../base/ConfigBot');
const { AfroMarketFlowPlugin, buildOrderConfirmationText } = require('./afromarketFlowPlugin');
const { redisManager } = require('../../core/redisManager');
const { paymentEvents } = require('../../core/payments/paymentEvents');
const { CustomerProfileStore } = require('../../core/customers/customerProfileStore');
const { InvoiceRecordStore } = require('../../core/invoices/invoiceRecordStore');
const { DeletionRequestLogStore } = require('../../core/customers/deletionRequestLogStore');
const { DeletionRequestService } = require('../../core/customers/deletionRequestService');
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
    super(config, { plugin: new AfroMarketFlowPlugin({ botConfig: config }) });

    this.customerProfileStore = new CustomerProfileStore();
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

  // Global intercept ahead of normal flow dispatch: a customer mid-checkout
  // should still be able to trigger erasure, not just from the main menu.
  async handleMessage({ from, message }) {
    const handledByErasure = await this._handleErasureIntercept({ from, message });
    if (handledByErasure) return;

    return super.handleMessage({ from, message });
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
      await this.customerProfileStore.upsert({
        botId,
        whatsappId: customerPhone,
        name: metadata.name || null,
        deliveryAddress: metadata.address || null
      });
    } catch (err) {
      logger.error('Failed to upsert customer profile for AfroMarket order', err && err.message ? err.message : String(err));
    }
  }
}

module.exports = { AfroMarketBot };
