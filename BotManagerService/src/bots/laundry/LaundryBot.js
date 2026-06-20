const { BaseBot } = require('../base/BaseBot');
const { redisManager } = require('../../core/redisManager');
const { getAppConfig } = require('../../core/appConfig');
const { FlowEngine } = require('../../core/flows/flowEngine');
const { createWhatsAppClientForBot } = require('../../core/whatsapp/whatsappClientFactory');
const { LaundryFlowPlugin } = require('./laundryFlowPlugin');
const { logger } = require('../../utils/logger');

class LaundryBot extends BaseBot {
  constructor(config) {
    super(config);

    this.flowEngine = new FlowEngine({ botConfig: config, plugin: new LaundryFlowPlugin({ botConfig: config }) });
    this.whatsapp = createWhatsAppClientForBot(config);
  }

  async handleMessage({ from, message }) {
    const appConfig = getAppConfig();
    const key = `conv:${this.config.botId}:${from}`;
    const existing = await redisManager.get(key);

    const state = existing
      ? JSON.parse(existing)
      : { currentFlowId: null, currentStateId: null, context: {} };

    const send = async (intent) => {
      if (!intent || !intent.type) {
        logger.warn('Unsupported outbound intent', intent);
        return;
      }

      if (!this.whatsapp.isConfigured()) {
        logger.warn('WhatsApp client not configured; logging intent only', {
          botId: this.config && this.config.botId ? this.config.botId : null,
          hasAccessToken: Boolean(this.whatsapp.accessToken),
          hasPhoneNumberId: Boolean(this.whatsapp.phoneNumberId)
        });
        logger.info('Outbound intent', intent);
        return;
      }

      if (intent.type === 'text') {
        await this.whatsapp.sendText({ to: intent.to, body: intent.body });
        return;
      }

      if (intent.type === 'buttons') {
        await this.whatsapp.sendButtons({ to: intent.to, body: intent.body, buttons: intent.buttons });
        return;
      }

      if (intent.type === 'list') {
        await this.whatsapp.sendList({
          to: intent.to,
          body: intent.body,
          buttonText: intent.buttonText,
          sections: intent.sections
        });
        return;
      }

      logger.warn('Unsupported outbound intent', intent);
    };

    const result = await this.flowEngine.step({ from, message, state, send });

    await redisManager.setex(key, appConfig.redis.ttlSeconds, JSON.stringify(result.state));

    logger.info(
      `LaundryBot handled message from ${from} (flow=${result.state.currentFlowId}, state=${result.state.currentStateId})`
    );
  }
}

module.exports = { LaundryBot };
