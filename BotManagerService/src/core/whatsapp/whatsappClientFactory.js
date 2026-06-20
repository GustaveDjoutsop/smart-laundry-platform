const { getAppConfig } = require('../appConfig');
const { WhatsAppCloudClient } = require('./whatsappClient');

function getAccessTokenForBot(botId) {
  if (!botId) return null;
  const key = `WHATSAPP_ACCESS_TOKEN_${String(botId).toUpperCase()}`;
  return process.env[key] || null;
}

function createWhatsAppClientForBot(botConfig) {
  const config = getAppConfig();

  return new WhatsAppCloudClient({
    accessToken: getAccessTokenForBot(botConfig && botConfig.botId),
    phoneNumberId: botConfig && botConfig.phoneNumberId,
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v20.0',
    apiBase: process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com'
  });
}

module.exports = { createWhatsAppClientForBot, getAccessTokenForBot };
