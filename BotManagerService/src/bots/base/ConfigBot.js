const { BaseBot } = require('./BaseBot');
const { redisManager } = require('../../core/redisManager');
const { getAppConfig } = require('../../core/appConfig');
const { FlowEngine } = require('../../core/flows/flowEngine');
const { createWhatsAppClientForBot } = require('../../core/whatsapp/whatsappClientFactory');
const { renderTemplate } = require('../../core/flows/templateRenderer');
const { logger } = require('../../utils/logger');

// Generic configuration-driven bot: runs entirely off a .bot.json flow config.
// Bots that need custom actions/integrations extend this class and pass a plugin.
class ConfigBot extends BaseBot {
  constructor(config, { plugin } = {}) {
    super(config);

    this.flowEngine = new FlowEngine({ botConfig: config, plugin: plugin || null });
    this.whatsapp = createWhatsAppClientForBot(config);
  }

  async handleMessage({ from, message, phone }) {
    // A `request_welcome` event fires the instant a customer opens the chat
    // for the first time - before they've typed anything - once
    // conversational_automation.enable_welcome_message is turned on for the
    // phone number (see scripts/setConversationalAutomation.js). It's not a
    // real conversation turn: there's no message content to route through
    // the flow engine, and no conversation state to advance, so it's
    // handled entirely separately here rather than falling into
    // flowEngine.step(). Config-driven per bot (catalogWelcome), so a bot
    // with none configured just no-ops - existing bots are unaffected.
    if (message?.type === 'request_welcome') {
      return this._handleRequestWelcome({ from, phone });
    }

    const appConfig = getAppConfig();
    const conversationKey = `conv:${this.config.botId}:${from}`;

    const existingSerializedState = await redisManager.get(conversationKey);
    const conversationState = existingSerializedState
      ? JSON.parse(existingSerializedState)
      : { currentFlowId: null, currentStateId: null, context: {} };

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

  async _handleRequestWelcome({ from, phone }) {
    const catalogWelcome = this.config.catalogWelcome;
    if (!catalogWelcome) {
      logger.info(`${this.constructor.name}[${this.config.botId}] request_welcome received but no catalogWelcome configured - ignoring`);
      return;
    }

    const templateContext = this.flowEngine.buildTemplateContext(from, phone);
    const body = renderTemplate(catalogWelcome.body || '', templateContext);
    const footer = catalogWelcome.footer ? renderTemplate(catalogWelcome.footer, templateContext) : undefined;

    await this.sendIntent({
      type: 'catalog_message',
      to: from,
      body,
      footer,
      thumbnailProductRetailerId: catalogWelcome.thumbnailProductRetailerId
    });

    logger.info(`${this.constructor.name}[${this.config.botId}] sent catalog welcome message to ${from} (request_welcome)`);
  }
}

module.exports = { ConfigBot };
