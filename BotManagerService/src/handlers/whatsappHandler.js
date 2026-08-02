const { botRegistry } = require('../core/botRegistry');
const { queueManager } = require('../core/messageQueue');
const { getAppConfig } = require('../core/appConfig');
const { logger } = require('../utils/logger');
const { verifyWhatsAppSignature } = require('./whatsappSignature');

function getQueryParam(req, key) {
  return req && req.query ? req.query[key] : undefined;
}

const whatsappHandler = {
  verify: (req, res) => {
    const mode = getQueryParam(req, 'hub.mode');
    const token = getQueryParam(req, 'hub.verify_token');
    const challenge = getQueryParam(req, 'hub.challenge');

    if (mode !== 'subscribe') {
      return res.status(400).send('Invalid mode');
    }

    const botName = botRegistry.getBotNameByVerifyToken(token);
    if (!botName) {
      logger.warn('Webhook verification failed: unknown verify_token');
      return res.status(403).send('Forbidden');
    }

    logger.info(`Webhook verified for bot: ${botName}`);
    return res.status(200).send(String(challenge || ''));
  },

  receive: async (req, res, next) => {
    try {
      const config = getAppConfig();
      if (config.whatsapp.verifySignature) {
        const signatureHeader = req.get('x-hub-signature-256');
        const ok = verifyWhatsAppSignature({
          appSecret: config.whatsapp.appSecret,
          rawBody: req.rawBody,
          signatureHeader
        });

        if (!ok) {
          logger.warn('Webhook signature verification failed');
          return res.status(403).send('Forbidden');
        }
      }

      const payload = req.body;

      const phoneNumberId =
        payload?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

      const message = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      const from = message?.from;
      const messageId = message?.id || null;

      if (!phoneNumberId || !message || !from) {
        return res.status(200).json({ ok: true }); // Ignore non-message events
      }

      const bot = botRegistry.getBotByPhoneId(phoneNumberId);
      if (!bot) {
        logger.warn(`No bot configured for phone_number_id=${phoneNumberId}`);
        return res.status(200).json({ ok: true });
      }

      queueManager.enqueue({
        phoneNumberId,
        from,
        messageId,
        message,
        raw: payload
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      return next(err);
    }
  }
};

module.exports = { whatsappHandler };
