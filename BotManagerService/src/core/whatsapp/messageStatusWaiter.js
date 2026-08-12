const { logger } = require('../../utils/logger');

// Lets a flow step block on WhatsApp's own delivery-status webhook for a
// message it just sent, instead of guessing how long Meta's async template
// assembly/delivery will take - see flowEngine.js's getCarouselFooterDelayMs
// comment for why the fixed-delay heuristic this replaces (2500ms, then
// 6000ms) kept losing the race between a carousel/card message and the
// "More options" footer sent right after it.
//
// Deliberately in-process, not Redis-backed: QueueManager processes one
// inbound job at a time on a single drain loop (see queueManager.js), and
// this service runs as one instance, so the webhook request that resolves a
// waiter always lands in the same process that's awaiting it. If this ever
// runs multi-instance, this needs to move to a shared store (Redis pub/sub)
// instead.
class MessageStatusWaiter {
  constructor() {
    this.waiters = new Map(); // messageId -> { resolve, timer }
  }

  // Resolves once WhatsApp reports any status ("sent"/"delivered"/"read"/
  // "failed") for messageId, or after timeoutMs, whichever comes first.
  // Never rejects - a timeout is an expected outcome (the status webhook
  // didn't arrive in time, e.g. it was lost or arrives after we've already
  // moved on), not a bug the caller needs to handle specially. Callers
  // should always proceed after this resolves either way; { timedOut }
  // is only there for logging.
  waitFor(messageId, timeoutMs) {
    if (!messageId) return Promise.resolve({ status: null, timedOut: true });

    return new Promise((resolve) => {
      // A message id already has a waiter registered - shouldn't happen
      // (WhatsApp message ids are unique per send), but defensively resolve
      // the earlier caller (with a null status, same as a timeout) instead
      // of just clearing its timer - clearing alone would leave that first
      // promise permanently pending with nothing left to ever settle it,
      // which breaks this class's own "never rejects, always eventually
      // resolves" contract.
      const existing = this.waiters.get(messageId);
      if (existing) existing.resolve(null);

      const timer = setTimeout(() => {
        this.waiters.delete(messageId);
        resolve({ status: null, timedOut: true });
      }, timeoutMs);
      // Deliberately NOT unref()'d: this promise is always awaited by an
      // active caller (waitForCarouselDelivery, mid-flow-step), so this
      // timer firing is required for correctness, not just cleanup -
      // unref()'ing it lets the event loop/process consider itself "done"
      // and exit before the timer ever runs when nothing else is keeping it
      // alive (bare tests, short-lived scripts; a live server always has
      // other refs so this wouldn't surface there, but it's still the wrong
      // contract for a timer an active await depends on).

      this.waiters.set(messageId, {
        resolve: (status) => {
          clearTimeout(timer);
          resolve({ status, timedOut: false });
        },
        timer
      });
    });
  }

  // Called from the webhook handler when a status event arrives for
  // messageId. A no-op when nothing is waiting on it - true for almost
  // every status event (read receipts, statuses for messages nobody's
  // blocking on), which is the normal case, not an error.
  notify(messageId, status) {
    const waiter = this.waiters.get(messageId);
    if (!waiter) return;

    this.waiters.delete(messageId);
    waiter.resolve(status);
  }

  // Test helper - clears any waiters left registered (e.g. a test that sent
  // a message and never got/simulated its status webhook) so timers don't
  // leak across test files. Not a shutdown hook: this abandons any in-flight
  // waitFor() callers without resolving them, leaving both their timer
  // cleared (no process-exit impact) and the caller's promise permanently
  // pending - if a graceful-shutdown path ever needs to drain these,
  // resolve each waiter with { timedOut: true } instead of calling this.
  reset() {
    for (const { timer } of this.waiters.values()) {
      clearTimeout(timer);
    }
    this.waiters.clear();
  }
}

const messageStatusWaiter = new MessageStatusWaiter();

// waitForCarouselDelivery encapsulates the fallback-when-no-messageId case
// that flowEngine.js's two footer-send sites (carouselTemplate path and
// vertical items[] fallback) both need: when the send didn't yield a
// message id at all (client not configured, a test's stub send(), or a
// send() that genuinely failed to return one), there's nothing to
// correlate a status webhook to, so fall back to the old fixed-delay
// heuristic rather than firing the footer immediately.
async function waitForCarouselDelivery(messageId, timeoutMs) {
  if (!messageId) {
    await new Promise((resolve) => {
      setTimeout(resolve, timeoutMs);
    });
    return;
  }

  const { timedOut } = await messageStatusWaiter.waitFor(messageId, timeoutMs);
  if (timedOut) {
    logger.warn('cards state: no delivery status for carousel/card message before footer send, proceeding after timeout', {
      messageId,
      timeoutMs
    });
  }
}

module.exports = { MessageStatusWaiter, messageStatusWaiter, waitForCarouselDelivery };
