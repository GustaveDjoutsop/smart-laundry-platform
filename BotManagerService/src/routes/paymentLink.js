const express = require('express');

const { getPaymentService } = require('../core/payments/paymentService');
const { isTerminalStatus, PaymentStatus } = require('../core/payments/paymentTypes');
const { logger } = require('../utils/logger');

// Why this exists: PayPal Orders v2 has no cancel or void endpoint
// (DELETE /v2/checkout/orders/{id} returns 404, and the CANCELED order status
// does not exist in v2), so once the buyer has the real checkout URL we cannot
// take it back - the order simply stays approvable until PayPal expires it,
// roughly three hours later. Everything else in this service can only refuse
// the result after the money has already moved.
//
// We do control the link we put in WhatsApp. Sending our own URL and checking
// the payment's state at click time is the only point where a dead payment can
// be stopped before the customer ever reaches PayPal.
//
// Known limit, worth being honest about: this is checked when the link is
// clicked. A customer who opens the PayPal page while the payment is still
// live and completes it twenty minutes later has already been redirected, and
// PayPal will capture. The terminal-state guard still refuses to confirm that
// order, and it lands in the manual-review queue.

// Everything that reaches the page is a hardcoded literal today, and the
// escaping below keeps it that way by construction: the next person to show
// an order number or a failureReason here gets it escaped rather than
// discovering stored XSS on the domain customers tap to pay. `messageHtml` is
// the one deliberately-raw slot, for the <strong> in the expired copy.
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Hosts a redirect is allowed to target, per provider. The stored URL comes
// from the provider's own API response over TLS and is not attacker-reachable
// today - every writer was traced - but this endpoint deliberately teaches
// customers that our /pay link is where they go to pay money, which makes an
// open redirect on that path a high-value phishing primitive. One
// `...rest` spread or webhook field added later is all it would take.
const PROVIDER_REDIRECT_HOSTS = {
  paypal: ['paypal.com'],
  stripe: ['stripe.com']
};

function isAllowedRedirectTarget(rawUrl, providerName) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch (_err) {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;

  const allowedHosts = PROVIDER_REDIRECT_HOSTS[providerName];
  if (!allowedHosts) return true;

  return allowedHosts.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
}

function renderPage({ icon, title, message }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f6f6f6; margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
      .card { background: #fff; padding: 2.5rem; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08); text-align: center; max-width: 360px; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #555; margin: 0; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1><span aria-hidden="true">${escapeHtml(icon)}</span> ${escapeHtml(title)}</h1>
      <p>${message}</p>
    </div>
  </body>
</html>`;
}

// No-store on every response, including the redirect: a cached 302 would send
// the customer straight to PayPal on a later click without this check running
// at all, which is the entire point of the endpoint.
function sendPage(res, status, page) {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex');

  return res.status(status).type('html').send(renderPage(page));
}

function paymentLinkRouter() {
  const router = express.Router();

  router.get('/:botId/:transactionId', async (req, res, next) => {
    try {
      const { botId, transactionId } = req.params;
      const { store } = getPaymentService();

      const payment = await store.getPayment({ botId, transactionId });
      const markedTerminal = store.getTerminalRecord
        ? await store.getTerminalRecord({ botId, transactionId })
        : null;

      // Same page for "never existed" and "we have no record any more": both
      // mean this link cannot be honoured. Note this does NOT make the
      // endpoint opaque to probing - a real-and-terminal id still answers 410
      // and a real-and-live one still redirects, so an id's existence is
      // observable. That is accepted: the ids are PayPal order ids, and the
      // UX of telling a customer their link expired is worth more than the
      // oracle is.
      if (!payment && !markedTerminal) {
        return sendPage(res, 404, {
          icon: '🔗',
          title: 'Link not valid',
          message: 'This payment link is no longer valid. Please start a new order in WhatsApp.'
        });
      }

      const terminalStatus =
        payment && isTerminalStatus(payment.status)
          ? payment.status
          : markedTerminal && isTerminalStatus(markedTerminal.status)
            ? markedTerminal.status
            : null;

      // Belt and braces: this flag means real money moved on an order we are
      // refusing to honour. It always co-occurs with a terminal status today,
      // but there is no state in which handing that customer a live pay link
      // is the right answer.
      if (!terminalStatus && payment && payment.capturedAfterTerminal) {
        logger.warn('Payment link opened for a payment flagged as captured after terminal; not redirecting', {
          botId,
          transactionId
        });

        return sendPage(res, 410, {
          icon: '⏰',
          title: 'Payment expired',
          message: 'This payment link has expired. Please start a new order in WhatsApp — type <strong>menu</strong> to begin.'
        });
      }

      if (terminalStatus === PaymentStatus.COMPLETED) {
        return sendPage(res, 410, {
          icon: '✅',
          title: 'Already paid',
          message: 'This order has already been paid. There is nothing more to do here — check WhatsApp for the confirmation.'
        });
      }

      if (terminalStatus) {
        logger.info('Payment link opened for an already-terminal payment; not redirecting to the provider', {
          botId,
          transactionId,
          status: terminalStatus,
          failureReason: (payment && payment.failureReason) || null
        });

        return sendPage(res, 410, {
          icon: '⏰',
          title: 'Payment expired',
          message: 'This payment link has expired. Please start a new order in WhatsApp — type <strong>menu</strong> to begin.'
        });
      }

      const providerCheckoutUrl = payment && payment.providerCheckoutUrl;
      if (!providerCheckoutUrl) {
        // A payment initiated before this endpoint existed has no stored
        // provider URL. Nothing to redirect to, and inventing one is not an
        // option - the customer is better served by starting over.
        logger.warn('Payment link opened for a payment with no stored provider checkout URL', { botId, transactionId });

        return sendPage(res, 404, {
          icon: '🔗',
          title: 'Link not valid',
          message: 'This payment link is no longer valid. Please start a new order in WhatsApp.'
        });
      }

      if (!isAllowedRedirectTarget(providerCheckoutUrl, payment.provider)) {
        logger.error('Refusing to redirect a payment link to an unexpected target', {
          botId,
          transactionId,
          provider: payment.provider || null
        });

        return sendPage(res, 404, {
          icon: '🔗',
          title: 'Link not valid',
          message: 'This payment link is no longer valid. Please start a new order in WhatsApp.'
        });
      }

      res.set('Cache-Control', 'no-store');
      res.set('X-Robots-Tag', 'noindex');

      return res.redirect(302, providerCheckoutUrl);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { paymentLinkRouter };
