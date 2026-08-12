const { botRegistry } = require('../core/botRegistry');
const { queueManager } = require('../core/messageQueue');
const { getAppConfig } = require('../core/appConfig');
const { logger } = require('../utils/logger');
const { verifyWhatsAppSignature } = require('./whatsappSignature');
const { messageStatusWaiter } = require('../core/whatsapp/messageStatusWaiter');

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
      const value = payload?.entry?.[0]?.changes?.[0]?.value;

      const phoneNumberId = value?.metadata?.phone_number_id;
      const message = value?.messages?.[0];
      const contact = value?.contacts?.[0];
      const messageId = message?.id || null;

      // Delivery-status updates (sent/delivered/read/failed) for messages we
      // sent arrive on this same "messages" field subscription, as
      // value.statuses instead of value.messages - see
      // messageStatusWaiter.js. Notify anything waiting on that message id
      // (the carousel-then-footer ordering guard in flowEngine.js) before
      // falling through to the "ignore non-message events" branch below,
      // since a status-only payload has no `message` and would otherwise be
      // dropped without ever being inspected.
      const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
      for (const status of statuses) {
        if (status?.id) {
          messageStatusWaiter.notify(status.id, status.status || null);
        }
      }

      // Once a customer adopts a WhatsApp username, Meta may omit the phone
      // number entirely (message.from and contacts[0].wa_id both become "")
      // and send only contacts[0].user_id (their Business-Scoped User ID)
      // instead - see afromarket-bsuid-codebase-readiness-agent-instructions.md.
      // Previously this branch required `from` truthy and silently dropped
      // every BSUID-only message with no log, no reply, no error. Fall back
      // to the BSUID so the customer is still routed instead of ignored.
      const phone = (contact?.wa_id || message?.from || '').trim() || null;
      const bsuid = (contact?.user_id || '').trim() || null;
      const from = phone || bsuid;
      const identifierType = phone ? 'phone' : bsuid ? 'bsuid' : null;

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
        identifierType,
        // Carried separately (not just derived from `from`/identifierType)
        // so a bot can detect when Meta's Portfolio Contact Book has already
        // paired both identifiers for this customer (both present on the
        // same contacts[] entry) and link them - see
        // afromarket-identity-linkage-design.md. Either may be null.
        phone,
        bsuid,
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
