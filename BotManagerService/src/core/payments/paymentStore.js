const { redisManager } = require('../redisManager');
const { PaymentStatus, isTerminalStatus } = require('./paymentTypes');

const DEFAULT_TTL_SECONDS = 60 * 60 * 24; // 24h
// Long enough that a captured-after-terminal payment survives well past the
// payment record's own 24h TTL and the 30-day ledger window - this list is the
// thing that stops real money going quiet, so it outlives everything else.
const REVIEW_QUEUE_TTL_SECONDS = 60 * 60 * 24 * 180;
// Event-dedup markers and the idempotency-key ref only need to outlive the
// payment record itself long enough to catch delayed retries/redeliveries -
// 30 days comfortably covers that without being a permanent commitment.
const EVENT_SEEN_TTL_SECONDS = 60 * 60 * 24 * 30;

function paymentKey({ botId, transactionId }) {
  return `payment:${botId}:${transactionId}`;
}

function paymentRefKey({ botId, externalRef }) {
  return `paymentRef:${botId}:${externalRef}`;
}

function paymentEventsKey({ botId, transactionId }) {
  return `payment_events:${botId}:${transactionId}`;
}

function eventSeenKey({ botId, provider, eventId }) {
  return `payment_event_seen:${botId}:${provider}:${eventId}`;
}

function idempotencyKeyRefKey({ botId, idempotencyKey }) {
  return `idempotencyKey:${botId}:${idempotencyKey}`;
}

function capturedAfterTerminalKey({ botId }) {
  return `payments_captured_after_terminal:${botId}`;
}

// Written once, the first time a payment reaches a terminal status, and
// never demoted. The payment snapshot cannot carry this rule on its own:
// it expires after 24h while PayPal retries a failed delivery for days,
// and a REFUNDED/REVERSED capture maps to PENDING (see
// paypalProvider.mapCaptureStatus), which would demote a COMPLETED payment
// back out of terminal. Both were reproduced in review.
function terminalMarkerKey({ botId, transactionId }) {
  return `payment_terminal:${botId}:${transactionId}`;
}

// Money is compared in minor units, never as raw floats: an order total of
// 39.939999 and PayPal's capture of 39.94 are the same payment.
function toMinorUnits(value) {
  return Math.round(Number(value) * 100);
}

// Atomic, so a capture webhook and the status worker racing on the same
// transaction file exactly one manual-review entry between them.
function capturedAfterTerminalClaimKey({ botId, transactionId }) {
  return `payment_captured_after_terminal_claimed:${botId}:${transactionId}`;
}

class PaymentStore {
  constructor({ ttlSeconds } = {}) {
    this.ttlSeconds = typeof ttlSeconds === 'number' ? ttlSeconds : DEFAULT_TTL_SECONDS;
  }

  async upsertPayment(record) {
    const { botId, transactionId, externalRef } = record;
    if (!botId || !transactionId) throw new Error('PaymentStore requires botId and transactionId');

    const key = paymentKey({ botId, transactionId });
    await redisManager.setex(key, this.ttlSeconds, JSON.stringify(record));

    if (externalRef) {
      const refKey = paymentRefKey({ botId, externalRef });
      await redisManager.setex(refKey, this.ttlSeconds, String(transactionId));
    }
  }

  async getPayment({ botId, transactionId }) {
    const key = paymentKey({ botId, transactionId });
    const raw = await redisManager.get(key);
    return raw ? JSON.parse(raw) : null;
  }

  async getPaymentByExternalRef({ botId, externalRef }) {
    const refKey = paymentRefKey({ botId, externalRef });
    const transactionId = await redisManager.get(refKey);
    if (!transactionId) return null;
    return this.getPayment({ botId, transactionId });
  }

  // Append-only ledger: every state transition (initiated / status-polled /
  // completed / failed / refunded) is a new event, never an overwrite of a
  // single mutable row - "current status" stays cheap to read by also
  // maintaining the existing payment:{botId}:{transactionId} row as a
  // derived snapshot of the latest event, not the source of truth.
  async appendEvent({ botId, transactionId, eventId, eventType, provider, status, amount, currency, metadata, raw, source, ...rest }) {
    if (!botId || !transactionId) throw new Error('PaymentStore requires botId and transactionId');

    // Providers without a stable event id (CamPay) get a synthesized one -
    // coarser (dedupes an exact repeat of the same status, not a truly
    // unique delivery id) but still prevents a duplicate ledger entry
    // instead of silently relying on "the overwrite happens to be harmless."
    const dedupeId = eventId || `${provider || 'unknown'}:${transactionId}:${status || 'unknown'}`;
    const seenKey = eventSeenKey({ botId, provider: provider || 'unknown', eventId: dedupeId });
    const isNew = await redisManager.setnx(seenKey, '1', EVENT_SEEN_TTL_SECONDS);
    if (!isNew) {
      return { duplicate: true };
    }

    const occurredAt = new Date().toISOString();

    // Read the current snapshot BEFORE anything is written. This is the one
    // place in the system where a payment's "current status" can change -
    // every success path (all three provider webhook routes, PayPal's
    // capture-response recording, the status poll, the timeout) funnels
    // through appendEvent - so the terminal-state rule lives here rather
    // than being repeated per caller. A guard in a caller only covers that
    // caller, and the 2026-11-11 leak was precisely a path that had none:
    // see docs/bugfixes/afromarket-paypal-terminal-state-bugfix.md.
    const existing = await this.getPayment({ botId, transactionId });
    const previousStatus = existing ? existing.status : null;

    // The durable marker, not the snapshot, is what the rule is keyed on -
    // see terminalMarkerKey above for the two ways the snapshot lies.
    let terminalRecord = await this.getTerminalRecord({ botId, transactionId });

    // Backfill: a payment that was already terminal before this guard existed
    // has no marker, so a reversal demoting its snapshot would let a later
    // completion through during exactly the deploy window this fix ships in.
    // Observing a terminal snapshot is enough to write the marker.
    if (!terminalRecord && isTerminalStatus(previousStatus)) {
      await this.markTerminal({
        botId,
        transactionId,
        status: previousStatus,
        amount: existing.amount,
        currency: existing.currency
      });
      terminalRecord = await this.getTerminalRecord({ botId, transactionId });
    }

    // Once terminal, a payment can never become successful again, whatever
    // the source. Deliberately one-directional: COMPLETED -> FAILED is still
    // allowed through, because PAYMENT.CAPTURE.DENIED / reversals /
    // chargebacks legitimately travel that way and blocking them would hide
    // a real loss of funds.
    let blocked = status === PaymentStatus.COMPLETED && !!terminalRecord && isTerminalStatus(terminalRecord.status);

    // Claim the terminal state atomically. Reading the marker and then writing
    // the snapshot is check-then-act across processes: a completion can read
    // "not terminal", pause, and overwrite a timeout that wrote FAILED and
    // notified the customer in the gap. setnx has no such gap - whoever wins
    // it owns the payment's terminal status, and a COMPLETED that loses to a
    // terminal marker is refused here rather than silently winning the write.
    if (!blocked && isTerminalStatus(status)) {
      const wonTerminalClaim = await this.markTerminal({ botId, transactionId, status, amount, currency });
      if (!wonTerminalClaim) {
        const claimedBy = await this.getTerminalRecord({ botId, transactionId });
        if (status === PaymentStatus.COMPLETED && claimedBy && isTerminalStatus(claimedBy.status)) {
          blocked = true;
          terminalRecord = claimedBy;
        }
      }
    }

    const effectiveTerminalStatus = terminalRecord ? terminalRecord.status : null;

    // Two very different things land in `blocked`, and conflating them was
    // itself a bug (caught in review before this shipped):
    //   previousStatus === COMPLETED - the ordinary PayPal flow, which
    //     reports a completion more than once: the capture response, then the
    //     separate PAYMENT.CAPTURE.COMPLETED delivery, and the backstop poll
    //     as a third source. Nothing is wrong; the later signals are simply
    //     idempotent and must stay silent.
    //   previousStatus === FAILED - the customer was told the payment failed
    //     and money moved anyway. That is an incident, and the only case that
    //     belongs in the manual-review queue.
    // Treating the first as the second would have filed every successful
    // order as an incident and buried the real ones in noise.
    // An amount that does not match the order is an incident even against an
    // already-COMPLETED payment: an idempotent repeat of the same completion
    // carries the same amount, so a different one is a second capture, not a
    // second signal about the first.
    // Compared against the marker's amount as well as the snapshot's, since
    // the snapshot is gone after 24h while the marker lives 30 days - without
    // that, a second capture for a different amount arriving on day two would
    // be filed away as a harmless repeat. Rounded to minor units first: the
    // AfroMarket cart total can carry more decimals than PayPal's own
    // two-decimal capture amount, and a strict comparison would then report
    // every ordinary repeat as a second capture.
    const baselineAmount =
      existing && existing.amount != null ? existing.amount : terminalRecord ? terminalRecord.amount : null;
    const amountDiffers = amount != null && baselineAmount != null && toMinorUnits(amount) !== toMinorUnits(baselineAmount);
    const capturedAfterDeath = blocked && (effectiveTerminalStatus === PaymentStatus.FAILED || amountDiffers);

    const event = {
      eventId: eventId || null,
      eventType: capturedAfterDeath
        ? 'payment_completed_blocked_after_terminal'
        : blocked
          ? 'payment_completed_duplicate_signal'
          : eventType || 'payment_status_updated',
      occurredAt,
      provider: provider || null,
      status: status || null,
      amount: amount != null ? amount : null,
      currency: currency || null,
      source: source || null,
      metadata: metadata && typeof metadata === 'object' ? metadata : null,
      raw: raw || null
    };

    const eventsKey = paymentEventsKey({ botId, transactionId });
    await redisManager.rpush(eventsKey, JSON.stringify(event));
    // Refresh the ledger's own TTL on every append, same retention window as
    // the event-seen dedup markers - without this the list would grow
    // forever in Redis (every other key here is TTL-bounded via setex).
    await redisManager.expire(eventsKey, EVENT_SEEN_TTL_SECONDS);

    // A refused transition must not quietly rewrite the record it was refused
    // against. Only the capturedAfterTerminal* fields below are added; the
    // status, amount, currency, metadata and raw of the real payment all stay
    // exactly as they were, so a partial or differently-denominated late
    // capture cannot restate the order's own total.
    const snapshot = blocked
      ? {
          ...(existing || {}),
          botId,
          transactionId,
          // Existing values win: a refused write may still contribute payer
          // details the record did not have (what a refund needs), but must
          // never overwrite what the order already recorded.
          metadata: event.metadata
            ? { ...event.metadata, ...((existing && existing.metadata) || {}) }
            : (existing && existing.metadata) || null,
          updatedAt: occurredAt
        }
      : {
          ...(existing || {}),
          ...rest,
          botId,
          transactionId,
          provider: provider || (existing && existing.provider) || null,
          status: status || (existing && existing.status) || null,
          amount: amount != null ? amount : existing && existing.amount,
          currency: currency || (existing && existing.currency) || null,
          metadata: event.metadata || (existing && existing.metadata) || null,
          raw: event.raw || (existing && existing.raw) || null,
          updatedAt: occurredAt
        };

    if (capturedAfterDeath) {
      // Real money moved on the provider's side while this service refuses to
      // call the payment successful. Flag it on the record AND queue it for
      // review (below) - the whole point of blocking is that the money must
      // not disappear quietly along with the status change. The capture's own
      // amount/currency/payer details are kept under their own keys rather
      // than overwriting the order's, since a refund needs both.
      snapshot.capturedAfterTerminal = true;
      snapshot.capturedAfterTerminalAt = occurredAt;
      snapshot.capturedAfterTerminalAmount = amount != null ? amount : null;
      snapshot.capturedAfterTerminalCurrency = currency || null;
      snapshot.capturedAfterTerminalSource = source || null;
      snapshot.capturedAfterTerminalMetadata = event.metadata || null;
    }

    await this.upsertPayment(snapshot);

    if (capturedAfterDeath && (await this.claimCapturedAfterTerminal({ botId, transactionId }))) {
      await this.queueCapturedAfterTerminal({
        botId,
        transactionId,
        provider: snapshot.provider || provider || null,
        // Deliberately no customerPhone and no metadata. The route serving
        // this list is admin-authenticated, but the entries are a flat
        // operator worklist, not a place to copy payer details to - those
        // stay on the payment record itself.
        externalRef: snapshot.externalRef || null,
        amount: snapshot.capturedAfterTerminalAmount,
        currency: snapshot.capturedAfterTerminalCurrency,
        terminalStatus: previousStatus,
        failureReason: snapshot.failureReason || null,
        source: source || null,
        occurredAt
      });
    }

    // previousStatus is the status *before* this append - callers need it to
    // detect a real transition (e.g. PENDING -> COMPLETED). Re-reading
    // getPayment() after this point would return the status this call just
    // wrote, making every transition look like "no change".
    return {
      duplicate: false,
      blocked,
      // Callers log this one at error level and leave the payment for a human;
      // a plain `blocked` is just an idempotent repeat and stays quiet.
      capturedAfterDeath,
      event,
      previousStatus,
      terminalStatus: blocked ? previousStatus : null
    };
  }

  // Durable, operator-facing list of payments the provider captured after
  // this service had already declared them terminal. Outlives the payment
  // record's own TTL on purpose: this is the queue a human works through to
  // refund or honour each one.
  // Single place that records "money moved for a payment already declared
  // terminal", for the one case appendEvent cannot see: _handleTimeout's
  // read-then-write is not atomic, so a capture that legitimately wrote
  // COMPLETED can be overwritten by a timeout that read PENDING a moment
  // earlier, leaving PaymentStatusWorker to drop the COMPLETED with nothing
  // for appendEvent to have blocked. Claims first, so this and appendEvent
  // cannot both file the same incident, and re-reads the record immediately
  // before writing rather than trusting a snapshot taken several awaits ago.
  async flagCapturedAfterTerminal({ botId, transactionId, provider, terminalStatus, source, occurredAt }) {
    const claimed = await this.claimCapturedAfterTerminal({ botId, transactionId });
    if (!claimed) return false;

    const current = (await this.getPayment({ botId, transactionId })) || {};
    const flaggedAt = occurredAt || new Date().toISOString();

    await this.upsertPayment({
      ...current,
      botId,
      transactionId,
      capturedAfterTerminal: true,
      capturedAfterTerminalAt: flaggedAt,
      capturedAfterTerminalSource: source || null,
      updatedAt: flaggedAt
    });

    await this.queueCapturedAfterTerminal({
      botId,
      transactionId,
      provider: current.provider || provider || null,
      externalRef: current.externalRef || null,
      amount: current.amount != null ? current.amount : null,
      currency: current.currency || null,
      terminalStatus: terminalStatus || current.status || null,
      failureReason: current.failureReason || null,
      source: source || null,
      occurredAt: flaggedAt
    });

    return true;
  }

  async claimCapturedAfterTerminal({ botId, transactionId }) {
    return redisManager.setnx(capturedAfterTerminalClaimKey({ botId, transactionId }), '1', REVIEW_QUEUE_TTL_SECONDS);
  }

  // setnx, not setex: the FIRST terminal status a payment reaches is the one
  // that sticks, and winning this call is what claims the terminal state
  // against a concurrent writer. A later FAILED after a COMPLETED (a denial
  // or reversal) must not turn a paid payment back into one that can be
  // completed again. Carries the amount/currency too, so the "is this a
  // second capture or the same one reported twice" comparison still works
  // after the payment snapshot's own 24h TTL has expired.
  async markTerminal({ botId, transactionId, status, amount, currency }) {
    if (!isTerminalStatus(status)) return false;

    const marker = JSON.stringify({
      status,
      amount: amount != null ? amount : null,
      currency: currency || null,
      markedAt: new Date().toISOString()
    });

    return redisManager.setnx(terminalMarkerKey({ botId, transactionId }), marker, EVENT_SEEN_TTL_SECONDS);
  }

  async getTerminalRecord({ botId, transactionId }) {
    const marked = await redisManager.get(terminalMarkerKey({ botId, transactionId }));
    if (!marked) return null;

    try {
      const parsed = JSON.parse(marked);
      return parsed && parsed.status ? parsed : null;
    } catch (_err) {
      // Markers written before they carried amount/currency were a bare
      // status string - still authoritative for the terminal rule itself.
      return { status: marked, amount: null, currency: null };
    }
  }

  async getTerminalStatus({ botId, transactionId }) {
    const record = await this.getTerminalRecord({ botId, transactionId });
    return record ? record.status : null;
  }

  async queueCapturedAfterTerminal(entry) {
    const key = capturedAfterTerminalKey({ botId: entry.botId });
    await redisManager.rpush(key, JSON.stringify(entry));
    await redisManager.expire(key, REVIEW_QUEUE_TTL_SECONDS);
  }

  // Tolerates a malformed entry rather than 500ing the whole worklist - this
  // is the list an operator uses to find real money, so one bad row must not
  // hide the rest.
  async getCapturedAfterTerminal({ botId }) {
    const raw = await redisManager.lrange(capturedAfterTerminalKey({ botId }), 0, -1);
    return (raw || [])
      .map((entry) => {
        try {
          return JSON.parse(entry);
        } catch (_err) {
          return null;
        }
      })
      .filter(Boolean);
  }

  async getEvents({ botId, transactionId }) {
    const raw = await redisManager.lrange(paymentEventsKey({ botId, transactionId }), 0, -1);
    return (raw || []).map((entry) => JSON.parse(entry));
  }

  async setIdempotencyRef({ botId, idempotencyKey, transactionId }) {
    if (!botId || !idempotencyKey || !transactionId) return;
    const key = idempotencyKeyRefKey({ botId, idempotencyKey });
    await redisManager.setex(key, EVENT_SEEN_TTL_SECONDS, String(transactionId));
  }

  async getPaymentByIdempotencyKey({ botId, idempotencyKey }) {
    const key = idempotencyKeyRefKey({ botId, idempotencyKey });
    const transactionId = await redisManager.get(key);
    if (!transactionId) return null;
    return this.getPayment({ botId, transactionId });
  }
}

module.exports = { PaymentStore };
