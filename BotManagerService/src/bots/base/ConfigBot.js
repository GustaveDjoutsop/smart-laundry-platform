const { BaseBot } = require('./BaseBot');
const { redisManager } = require('../../core/redisManager');
const { getAppConfig } = require('../../core/appConfig');
const { FlowEngine } = require('../../core/flows/flowEngine');
const { createWhatsAppClientForBot } = require('../../core/whatsapp/whatsappClientFactory');
const { renderTemplate } = require('../../core/flows/templateRenderer');
const { logger } = require('../../utils/logger');

// How long a customer's "already got the catalog welcome" claim is
// remembered - deliberately much longer than the conversation-state TTL
// (appConfig.redis.ttlSeconds, 30 min by default): this is a welcome, not a
// recurring nudge, so a customer going quiet for an afternoon shouldn't see
// it again. 90 days behaves as "effectively once" without unbounded storage.
const CATALOG_WELCOME_CLAIM_TTL_SECONDS = 60 * 60 * 24 * 90;

// How long an explicit-trigger send (e.g. "Show catalog") is deduplicated
// per WhatsApp message id - deliberately much shorter than the claim TTL
// above, since (unlike the first-contact claim) this trigger is meant to
// fire again on the customer's next distinct "Show catalog" message. This
// window only needs to outlast Meta's documented at-least-once webhook
// redelivery for the *same* event, not remember the customer long-term.
const CATALOG_TRIGGER_DEDUP_TTL_SECONDS = 60 * 60 * 24;

// Whether an incoming text message exactly matches one of catalogWelcome's
// configured trigger phrases (e.g. the "Show catalog" Ice Breaker label) -
// case/whitespace-insensitive, since a customer retyping it by hand won't
// match the Ice Breaker's exact casing. Unlike the first-contact claim
// below, this has no "once" semantics - it must fire the same way every
// single time, whether this is the customer's first message or their
// fiftieth (see afromarket.md v2.27 - a customer tapping "Show catalog"
// later in the conversation got the catalog stacked with the unrelated
// flow-engine welcome/menu response, since only the true first-contact
// case was covered before this).
function messageMatchesCatalogTrigger(catalogWelcome, message) {
  const triggers = catalogWelcome && Array.isArray(catalogWelcome.triggers) ? catalogWelcome.triggers : [];
  if (!triggers.length || message?.type !== 'text') return false;

  const incoming = String(message.text?.body || '').trim().toLowerCase();
  if (!incoming) return false;

  return triggers.some((trigger) => String(trigger).trim().toLowerCase() === incoming);
}

// Generic configuration-driven bot: runs entirely off a .bot.json flow config.
// Bots that need custom actions/integrations extend this class and pass a plugin.
class ConfigBot extends BaseBot {
  constructor(config, { plugin } = {}) {
    super(config);

    this.flowEngine = new FlowEngine({ botConfig: config, plugin: plugin || null });
    this.whatsapp = createWhatsAppClientForBot(config);
  }

  async handleMessage({ from, message, phone }) {
    const appConfig = getAppConfig();
    const conversationKey = `conv:${this.config.botId}:${from}`;

    const existingSerializedState = await redisManager.get(conversationKey);
    const conversationState = existingSerializedState
      ? JSON.parse(existingSerializedState)
      : { currentFlowId: null, currentStateId: null, context: {} };

    // Whether conversationState already has a flow in progress. Meaningful
    // in exactly one place below: gating the claim-based first-contact
    // catalog send (not the explicit-trigger one - see that comment for
    // why the distinction matters). True on a customer's literal first-ever
    // message only when another code path staged something THIS turn
    // before calling us - e.g. AfroMarketBot._handleNativeOrder writes a
    // `checkout_start` state (the customer's submitted cart) before calling
    // super.handleMessage() - since no earlier turn could have written
    // conv: state otherwise. On any later message it's true for practically
    // every returning customer (the flow engine sets currentFlowId on every
    // ordinary turn), which is exactly why it must NOT gate the explicit
    // trigger path - caught by a subagent review before this shipped; see
    // afromarket.md v2.24/v2.27.
    const hasPreStagedWork = Boolean(conversationState.currentFlowId);

    // Meta removed the `request_welcome` webhook event and
    // `enable_welcome_message` from the Conversational Automation API on
    // 2026-03-27 ("this feature is no longer supported", per Meta's own
    // changelog) - there is no way left to react to a customer opening the
    // chat before they've typed anything. The closest achievable
    // substitute: send catalogWelcome once, on the customer's genuine first
    // message - and, per product decision, ONLY the catalog on that turn.
    // The old request_welcome design never touched flow-engine state at all
    // (it wasn't a real conversation turn); this mirrors that intent as
    // closely as possible: first contact gets the catalog and nothing else,
    // the flow engine's own welcome/menu only appears from the customer's
    // next interaction onward (another message, an Ice Breaker tap, etc.),
    // not stacked on top of the catalog card. Config-driven per bot, so a
    // bot with no catalogWelcome configured is unaffected.
    //
    // Deliberately NOT keyed off `conversationKey` (unlike the flow-engine
    // state read below) - other code paths write to that exact key before
    // ever reaching here (e.g. AfroMarketBot._handleNativeOrder persists
    // checkout state for a native WhatsApp cart submission before calling
    // super.handleMessage()), which would make a customer whose first-ever
    // contact isn't plain text look like a returning customer and never get
    // welcomed. A dedicated key, claimed atomically via setnx, is immune to
    // that and to two concurrent deliveries of the same customer's first
    // message both trying to send it (Meta's documented at-least-once
    // webhook redelivery) - only one setnx call can win the claim.
    //
    // Residual, accepted risk: redisManager's setnx fails soft to a
    // per-process in-memory fallback on a genuine Redis outage (see
    // redisManager.js), so a customer could see the catalog welcome more
    // than once if they message again during/shortly after an outage that
    // also affects an already-claimed key. Judged acceptable - an extra
    // catalog card is a mild UX hiccup, not a functional break - rather
    // than gating the send on redisManager.connected, which would silently
    // disable it for any local/dev setup that doesn't configure real Redis.
    if (this.config.catalogWelcome) {
      if (!this.whatsapp.isConfigured()) {
        // Don't claim the key at all here - sendIntent() would return early
        // without sending or throwing (see below), so claiming now would
        // permanently suppress the welcome for this customer even after the
        // misconfiguration is fixed, for the full 90-day claim TTL.
        logger.warn(`${this.constructor.name}[${this.config.botId}] catalogWelcome configured but WhatsApp client isn't - skipping without claiming`);
      } else {
        const catalogWelcomeClaimKey = `catalog_welcome_sent:${this.config.botId}:${from}`;
        const matchesExplicitTrigger = messageMatchesCatalogTrigger(this.config.catalogWelcome, message);

        let shouldSend;
        if (matchesExplicitTrigger) {
          // An explicit trigger always sends, on every distinct message it
          // matches - not just the customer's first ever. But "always"
          // still needs its own atomicity: Meta's documented at-least-once
          // webhook redelivery means the SAME tap can arrive twice, and
          // without a per-event guard both deliveries would independently
          // decide to send - caught in review before this shipped (the
          // exact stacked-message bug this fix exists to prevent, just via
          // a different path). Deduped by message id, not customer, and on
          // a short TTL, not the 90-day claim - a genuinely new "Show
          // catalog" tap sent five minutes later must still go through.
          // message.id may legitimately be absent (e.g. some test/local
          // paths) - degrades to "treat as first delivery" rather than
          // blocking a real customer's request when it is.
          const messageId = message?.id ? String(message.id) : null;
          shouldSend = messageId
            ? await redisManager.setnx(`catalog_trigger_msg:${this.config.botId}:${messageId}`, '1', CATALOG_TRIGGER_DEDUP_TTL_SECONDS)
            : true;
          // Also mark the first-contact claim (best-effort, not gating
          // anything here) so a customer whose actual first message
          // happens to match the trigger doesn't leave the claim-based
          // path to redundantly fire again on their very next message.
          if (shouldSend) {
            await redisManager.setnx(catalogWelcomeClaimKey, '1', CATALOG_WELCOME_CLAIM_TTL_SECONDS);
          }
        } else {
          shouldSend = await redisManager.setnx(catalogWelcomeClaimKey, '1', CATALOG_WELCOME_CLAIM_TTL_SECONDS);
        }

        if (shouldSend) {
          const sentOk = await this._sendCatalogWelcome({ from, phone, reason: matchesExplicitTrigger ? 'explicit trigger' : 'first contact' });
          // hasPreStagedWork only guards the claim-based first-contact
          // path, not an explicit trigger - and only makes sense there.
          // hasPreStagedWork can ONLY be true on a customer's literal
          // first-ever message if another caller (e.g. _handleNativeOrder)
          // staged something THIS turn, since no earlier turn could have
          // written conv: state otherwise - that's the one case skipping
          // the flow engine would lose real, unrecoverable work. An
          // explicit trigger, by contrast, can fire on a customer's 50th
          // message just as easily as their 1st - hasPreStagedWork there
          // just means "this customer has chatted before" (the flow engine
          // sets currentFlowId on every ordinary turn), not "something is
          // about to be lost". Skipping the flow engine for it doesn't
          // lose anything - their state is merely paused, not discarded,
          // and resumes normally on their next ordinary message. A failed
          // send (already logged inside _sendCatalogWelcome) falls through
          // to the normal flow below either way, so the customer still
          // gets *something* rather than silence.
          if (sentOk && (matchesExplicitTrigger || !hasPreStagedWork)) {
            logger.info(`${this.constructor.name}[${this.config.botId}] message from ${from} handled by catalog welcome only (${matchesExplicitTrigger ? 'explicit trigger' : 'first contact'}) - flow engine skipped this turn`);
            return;
          }
        }
      }
    }

    const result = await this.flowEngine.step({
      from,
      message,
      phone,
      state: conversationState,
      send: (outboundIntent) => this.sendIntent(outboundIntent)
    });

    await redisManager.setex(conversationKey, appConfig.redis.ttlSeconds, JSON.stringify(result.state));

    logger.info(
      `${this.constructor.name}[${this.config.botId}] handled message from ${from} ` +
        `(flow=${result.state.currentFlowId}, state=${result.state.currentStateId})`
    );
  }

  async sendIntent(outboundIntent) {
    if (!outboundIntent || !outboundIntent.type) {
      logger.warn('Unsupported outbound intent', outboundIntent);
      return;
    }

    if (!this.whatsapp.isConfigured()) {
      logger.warn('WhatsApp client not configured; logging intent only', {
        botId: this.config && this.config.botId ? this.config.botId : null,
        hasAccessToken: Boolean(this.whatsapp.accessToken),
        hasPhoneNumberId: Boolean(this.whatsapp.phoneNumberId)
      });
      logger.info('Outbound intent', outboundIntent);
      return;
    }

    // Every branch below returns the WhatsApp API's parsed response (not
    // just awaits it) - flowEngine.js's cards state uses the returned
    // message id to wait for that specific message's delivery-status
    // webhook before sending a trailing footer, instead of a fixed delay.
    // Harmless for every other outbound intent, which ignore the return
    // value entirely.
    if (outboundIntent.type === 'text') {
      return this.whatsapp.sendText({ to: outboundIntent.to, body: outboundIntent.body });
    }

    if (outboundIntent.type === 'buttons') {
      return this.whatsapp.sendButtons({
        to: outboundIntent.to,
        body: outboundIntent.body,
        buttons: outboundIntent.buttons,
        image: outboundIntent.image
      });
    }

    if (outboundIntent.type === 'list') {
      return this.whatsapp.sendList({
        to: outboundIntent.to,
        body: outboundIntent.body,
        buttonText: outboundIntent.buttonText,
        sections: outboundIntent.sections
      });
    }

    if (outboundIntent.type === 'image') {
      return this.whatsapp.sendImage({
        to: outboundIntent.to,
        link: outboundIntent.link,
        caption: outboundIntent.caption
      });
    }

    if (outboundIntent.type === 'cta_url') {
      return this.whatsapp.sendCtaUrl({
        to: outboundIntent.to,
        body: outboundIntent.body,
        image: outboundIntent.image,
        buttonText: outboundIntent.buttonText,
        url: outboundIntent.url,
        footer: outboundIntent.footer
      });
    }

    if (outboundIntent.type === 'product_list') {
      return this.whatsapp.sendProductList({
        to: outboundIntent.to,
        catalogId: outboundIntent.catalogId,
        header: outboundIntent.header,
        body: outboundIntent.body,
        footer: outboundIntent.footer,
        sections: outboundIntent.sections
      });
    }

    if (outboundIntent.type === 'catalog_message') {
      return this.whatsapp.sendCatalogMessage({
        to: outboundIntent.to,
        body: outboundIntent.body,
        footer: outboundIntent.footer,
        thumbnailProductRetailerId: outboundIntent.thumbnailProductRetailerId
      });
    }

    if (outboundIntent.type === 'template_carousel') {
      return this.whatsapp.sendCarouselTemplate({
        to: outboundIntent.to,
        templateName: outboundIntent.templateName,
        languageCode: outboundIntent.languageCode,
        bodyParams: outboundIntent.bodyParams,
        cards: outboundIntent.cards
      });
    }

    if (outboundIntent.type === 'promo_template') {
      return this.whatsapp.sendPromoTemplate({
        to: outboundIntent.to,
        templateName: outboundIntent.templateName,
        languageCode: outboundIntent.languageCode,
        percentOff: outboundIntent.percentOff,
        productName: outboundIntent.productName,
        imageLink: outboundIntent.imageLink,
        imageMediaId: outboundIntent.imageMediaId,
        quickReplyPayload: outboundIntent.quickReplyPayload
      });
    }

    logger.warn('Unsupported outbound intent', outboundIntent);
  }

  async _sendCatalogWelcome({ from, phone, reason = 'first message' }) {
    const catalogWelcome = this.config.catalogWelcome;
    const templateContext = this.flowEngine.buildTemplateContext(from, phone);
    const body = renderTemplate(catalogWelcome.body || '', templateContext);
    const footer = catalogWelcome.footer ? renderTemplate(catalogWelcome.footer, templateContext) : undefined;

    try {
      await this.sendIntent({
        type: 'catalog_message',
        to: from,
        body,
        footer,
        thumbnailProductRetailerId: catalogWelcome.thumbnailProductRetailerId
      });

      logger.info(`${this.constructor.name}[${this.config.botId}] sent catalog welcome to ${from} (${reason})`);
      return true;
    } catch (err) {
      // Never let a failed catalog send (e.g. a transient Graph API error)
      // silently swallow the customer's first message entirely - the caller
      // falls through to the normal flow engine when this returns false, so
      // a missed catalog card is far better than a customer typing "Hi" and
      // getting no response at all.
      logger.warn(`${this.constructor.name}[${this.config.botId}] catalog welcome send failed for ${from} - falling back to normal flow`, {
        error: err.message
      });
      return false;
    }
  }
}

module.exports = { ConfigBot };
