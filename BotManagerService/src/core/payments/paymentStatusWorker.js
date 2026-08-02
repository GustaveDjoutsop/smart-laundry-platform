const { PaymentStatus } = require('./paymentTypes');

function isTerminal(status) {
  return status === PaymentStatus.COMPLETED || status === PaymentStatus.FAILED;
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

class PaymentStatusWorker {
  constructor({ gateway, store, events, botRegistry, logger, pollIntervalMs, timeoutMs, nowFn, setTimeoutFn, clearTimeoutFn } = {}) {
    this.gateway = gateway;
    this.store = store;
    this.events = events;
    this.botRegistry = botRegistry;
    this.logger = logger;

    this.pollIntervalMs = typeof pollIntervalMs === 'number' ? pollIntervalMs : 10_000;
    this.timeoutMs = typeof timeoutMs === 'number' ? timeoutMs : 10 * 60 * 1000;

    this.nowFn = nowFn || (() => Date.now());
    this.setTimeoutFn = setTimeoutFn || setTimeout;
    this.clearTimeoutFn = clearTimeoutFn || clearTimeout;

    this.tracked = new Map(); // key -> { startedAt, pollTimer, timeoutTimer }

    this._onInitiated = this._onInitiated.bind(this);
    this._onStatus = this._onStatus.bind(this);
  }

  start() {
    if (!this.events || !this.events.on) return;
    this.events.on('payment.initiated', this._onInitiated);
    this.events.on('payment.status', this._onStatus);
  }

  stop() {
    if (this.events && this.events.off) {
      this.events.off('payment.initiated', this._onInitiated);
      this.events.off('payment.status', this._onStatus);
    }

    for (const key of this.tracked.keys()) {
      this._stopTrackingKey(key);
    }
  }

  _trackKey({ botId, provider, transactionId }) {
    return `${botId}:${provider}:${transactionId}`;
  }

  _stopTrackingKey(key) {
    const entry = this.tracked.get(key);
    if (!entry) return;

    if (entry.pollTimer) this.clearTimeoutFn(entry.pollTimer);
    if (entry.timeoutTimer) this.clearTimeoutFn(entry.timeoutTimer);

    this.tracked.delete(key);
  }

  async _onInitiated(evt) {
    if (!evt || !evt.botId || !evt.provider || !evt.transactionId) return;

    const key = this._trackKey(evt);
    if (this.tracked.has(key)) return;

    const startedAt = this.nowFn();

    const schedulePoll = () => {
      const entry = this.tracked.get(key);
      if (!entry) return;
      entry.pollTimer = this.setTimeoutFn(async () => {
        await this._pollOnce(evt).catch(() => undefined);
        schedulePoll();
      }, this.pollIntervalMs);
    };

    const timeoutTimer = this.setTimeoutFn(async () => {
      await this._handleTimeout(evt).catch(() => undefined);
    }, this.timeoutMs);

    this.tracked.set(key, { startedAt, pollTimer: null, timeoutTimer });
    schedulePoll();
  }

  async _pollOnce({ botId, provider, transactionId }) {
    if (!this.gateway || !this.gateway.checkStatus) return;

    const update = await this.gateway.checkStatus({ botId, provider, transactionId });

    // Emit a status event so the rest of the system has one canonical pathway
    if (this.events && this.events.emit) {
      this.events.emit('payment.status', {
        botId,
        provider,
        transactionId,
        status: update.status,
        previousStatus: update.previousStatus
      });
    }

    return update;
  }

  async _handleTimeout({ botId, provider, transactionId }) {
    const key = this._trackKey({ botId, provider, transactionId });
    this._stopTrackingKey(key);

    if (!this.store) return;

    const existing = await this.store.getPayment({ botId, transactionId });
    if (!existing) return;

    if (isTerminal(existing.status)) return;

    const previousStatus = existing.status;
    const updated = {
      ...existing,
      status: PaymentStatus.FAILED,
      failureReason: 'TIMEOUT',
      updatedAt: new Date().toISOString()
    };

    // A timeout-driven failure is a real state transition and must land in
    // the ledger like every other one (webhook, poll) - writing straight to
    // upsertPayment here would silently change "current status" with no
    // event explaining why, breaking the audit trail for exactly the
    // payments that failed silently (no webhook/poll ever resolved them).
    if (this.store.appendEvent) {
      await this.store.appendEvent({
        botId,
        transactionId,
        provider,
        eventType: 'payment_timed_out',
        status: updated.status,
        failureReason: updated.failureReason,
        source: 'timeout'
      });
    } else {
      await this.store.upsertPayment(updated);
    }

    if (this.events && this.events.emit) {
      this.events.emit('payment.status', {
        botId,
        provider,
        transactionId,
        status: updated.status,
        previousStatus,
        failureReason: updated.failureReason
      });
    }
  }

  async _onStatus(evt) {
    if (!evt || !evt.botId || !evt.provider || !evt.transactionId || !evt.status) return;

    const { botId, provider, transactionId } = evt;
    const status = evt.status;
    const failureReason = evt.failureReason;

    if (isTerminal(status)) {
      const key = this._trackKey({ botId, provider, transactionId });
      this._stopTrackingKey(key);
    }

    if (!this.store) return;

    const payment = await this.store.getPayment({ botId, transactionId });
    if (!payment) return;

    // The webhook route / poll path already wrote `status` into the store
    // (via appendEvent/upsertPayment) before emitting this event - reading
    // payment.status here would return the *new* status, not the previous
    // one, making every real transition look like "no change" and silently
    // suppressing payment.completed/payment.failed. The emitter is required
    // to carry the true pre-write status explicitly instead.
    const previousStatus = evt.previousStatus !== undefined ? evt.previousStatus : payment.status;
    const previousFailureReason = payment.failureReason;

    // Ignore repeated status events (prevents customer spam during polling)
    const isSameStatus = previousStatus === status;
    const isSameFailureReason = failureReason == null || previousFailureReason === failureReason;
    if (isSameStatus && isSameFailureReason) {
      return;
    }

    const updatedPayment = {
      ...payment,
      status,
      failureReason: failureReason != null ? failureReason : payment.failureReason,
      updatedAt: new Date().toISOString()
    };

    await this.store.upsertPayment(updatedPayment);

    const customerPhone = updatedPayment.customerPhone;
    const externalRef = updatedPayment.externalRef;

    // Notify customer only on failure (avoid PENDING/PROCESSING spam; bots may handle COMPLETED themselves)
    if (status === PaymentStatus.FAILED && customerPhone && this.botRegistry) {
      const bot = this.botRegistry.getBotByName ? this.botRegistry.getBotByName(botId) : null;
      const whatsapp = bot && bot.whatsapp;

      if (whatsapp && whatsapp.isConfigured && whatsapp.isConfigured()) {
        const reason = updatedPayment.failureReason ? ` (${updatedPayment.failureReason})` : '';
        const body = `❌ Paiement échoué${reason}.\n\nRéférence: ${externalRef || transactionId}\n\nTape *menu* pour recommencer.`;
        await whatsapp.sendText({ to: customerPhone, body });
      }
    }

    // Emit higher-level events only on transitions into terminal states
    if (this.events && this.events.emit) {
      if (status === PaymentStatus.COMPLETED && previousStatus !== PaymentStatus.COMPLETED) {
        this.events.emit('payment.completed', { botId, provider, transactionId, externalRef, payment: updatedPayment });
      }
      if (status === PaymentStatus.FAILED && previousStatus !== PaymentStatus.FAILED) {
        this.events.emit('payment.failed', { botId, provider, transactionId, externalRef, payment: updatedPayment });
      }
    }
  }
}

module.exports = { PaymentStatusWorker };
