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

    // Meta removed the `request_welcome` webhook event and
    // `enable_welcome_message` from the Conversational Automation API on
    // 2026-03-27 ("this feature is no longer supported", per Meta's own
    // changelog) - there is no way left to react to a customer opening the
    // chat before they've typed anything. The closest achievable
    // substitute: send catalogWelcome once, on the customer's genuine first
    // message, then let that same message continue through the flow engine
    // as normal below.
    //
    // Deliberately NOT keyed off `conversationKey` (unlike the flow-engine
    // state above) - other code paths write to that exact key before ever
    // reaching here (e.g. AfroMarketBot._handleNativeOrder persists
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
    if (this.config.catalogWelcome && !this.whatsapp.isConfigured()) {
      // Don't claim the key at all here - sendIntent() would return early
      // without sending or throwing (see below), so claiming now would
      // permanently suppress the welcome for this customer even after the
      // misconfiguration is fixed, for the full 90-day claim TTL.
      logger.warn(`${this.constructor.name}[${this.config.botId}] catalogWelcome configured but WhatsApp client isn't - skipping without claiming`);
    } else if (this.config.catalogWelcome) {
      const catalogWelcomeClaimKey = `catalog_welcome_sent:${this.config.botId}:${from}`;
      const isFirstMessage = await redisManager.setnx(catalogWelcomeClaimKey, '1', CATALOG_WELCOME_CLAIM_TTL_SECONDS);
      if (isFirstMessage) {
        await this._sendCatalogWelcome({ from, phone });
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

    logger.warn('Unsupported outbound intent', outboundIntent);
  }

  async _sendCatalogWelcome({ from, phone }) {
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

      logger.info(`${this.constructor.name}[${this.config.botId}] sent catalog welcome to ${from} (first message)`);
    } catch (err) {
      // Never let a failed catalog send (e.g. a transient Graph API error)
      // stop the customer's actual message from reaching the flow engine
      // below - a missed catalog card is far better than a customer typing
      // "Hi" and getting no response at all.
      logger.warn(`${this.constructor.name}[${this.config.botId}] catalog welcome send failed for ${from} - continuing without it`, {
        error: err.message
      });
    }
  }
}

module.exports = { ConfigBot };
