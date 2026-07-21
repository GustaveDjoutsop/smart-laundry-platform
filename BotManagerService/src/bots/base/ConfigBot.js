const { BaseBot } = require('./BaseBot');
const { redisManager } = require('../../core/redisManager');
const { getAppConfig } = require('../../core/appConfig');
const { FlowEngine } = require('../../core/flows/flowEngine');
const { createWhatsAppClientForBot } = require('../../core/whatsapp/whatsappClientFactory');
const { logger } = require('../../utils/logger');

// Generic configuration-driven bot: runs entirely off a .bot.json flow config.
// Bots that need custom actions/integrations extend this class and pass a plugin.
class ConfigBot extends BaseBot {
  constructor(config, { plugin } = {}) {
    super(config);

    this.flowEngine = new FlowEngine({ botConfig: config, plugin: plugin || null });
    this.whatsapp = createWhatsAppClientForBot(config);
  }

  async handleMessage({ from, message }) {
    const appConfig = getAppConfig();
    const conversationKey = `conv:${this.config.botId}:${from}`;

    const existingSerializedState = await redisManager.get(conversationKey);
    const conversationState = existingSerializedState
      ? JSON.parse(existingSerializedState)
      : { currentFlowId: null, currentStateId: null, context: {} };

    const result = await this.flowEngine.step({
      from,
      message,
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

    if (outboundIntent.type === 'text') {
      await this.whatsapp.sendText({ to: outboundIntent.to, body: outboundIntent.body });
      return;
    }

    if (outboundIntent.type === 'buttons') {
      await this.whatsapp.sendButtons({
        to: outboundIntent.to,
        body: outboundIntent.body,
        buttons: outboundIntent.buttons,
        image: outboundIntent.image
      });
      return;
    }

    if (outboundIntent.type === 'list') {
      await this.whatsapp.sendList({
        to: outboundIntent.to,
        body: outboundIntent.body,
        buttonText: outboundIntent.buttonText,
        sections: outboundIntent.sections
      });
      return;
    }

    if (outboundIntent.type === 'image') {
      await this.whatsapp.sendImage({
        to: outboundIntent.to,
        link: outboundIntent.link,
        caption: outboundIntent.caption
      });
      return;
    }

    if (outboundIntent.type === 'cta_url') {
      await this.whatsapp.sendCtaUrl({
        to: outboundIntent.to,
        body: outboundIntent.body,
        image: outboundIntent.image,
        buttonText: outboundIntent.buttonText,
        url: outboundIntent.url,
        footer: outboundIntent.footer
      });
      return;
    }

    if (outboundIntent.type === 'template_carousel') {
      await this.whatsapp.sendCarouselTemplate({
        to: outboundIntent.to,
        templateName: outboundIntent.templateName,
        languageCode: outboundIntent.languageCode,
        bodyParams: outboundIntent.bodyParams,
        cards: outboundIntent.cards
      });
      return;
    }

    logger.warn('Unsupported outbound intent', outboundIntent);
  }
}

module.exports = { ConfigBot };
