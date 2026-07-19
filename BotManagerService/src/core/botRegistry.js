const path = require('path');
const fs = require('fs');

const { loadBotConfig } = require('./configLoader');
const { ConfigBot } = require('../bots/base/ConfigBot');
const { LaundryBot } = require('../bots/laundry/LaundryBot');
const { ThomasNetworkBot } = require('../bots/thomasNetwork/ThomasNetworkBot');
const { validateFlowConfig } = require('./flows/flowEngine');

function validateBotConfig(botConfig, { configPath } = {}) {
  const errors = [];
  const context = configPath ? ` (${configPath})` : '';

  if (!botConfig || typeof botConfig !== 'object' || Array.isArray(botConfig)) {
    return [`Bot config must be an object${context}`];
  }

  if (!botConfig.botId || typeof botConfig.botId !== 'string' || !botConfig.botId.trim()) {
    errors.push(`botId is required and must be a non-empty string${context}`);
  }

  if (!botConfig.phoneNumberId || typeof botConfig.phoneNumberId !== 'string' || !botConfig.phoneNumberId.trim()) {
    errors.push(`phoneNumberId is required and must be a non-empty string${context}`);
  }

  if (!botConfig.verifyToken || typeof botConfig.verifyToken !== 'string' || !botConfig.verifyToken.trim()) {
    errors.push(`verifyToken is required and must be a non-empty string${context}`);
  }

  if (botConfig.botType != null && (typeof botConfig.botType !== 'string' || !botConfig.botType.trim())) {
    errors.push(`botType must be a non-empty string when provided${context}`);
  }

  if (botConfig.botName != null && (typeof botConfig.botName !== 'string' || !botConfig.botName.trim())) {
    errors.push(`botName must be a non-empty string when provided${context}`);
  }

  const flows = botConfig.flows;
  if (!flows || typeof flows !== 'object' || Array.isArray(flows) || Object.keys(flows).length === 0) {
    errors.push(`flows is required and must be a non-empty object${context}`);
  } else {
    try {
      validateFlowConfig(botConfig);
    } catch (err) {
      errors.push(`Invalid flows configuration${context}: ${err && err.message ? err.message : String(err)}`);
    }

    if (botConfig.defaultFlowId && !flows[botConfig.defaultFlowId]) {
      errors.push(`defaultFlowId '${botConfig.defaultFlowId}' does not exist in flows${context}`);
    }
  }

  return errors;
}

function getBotTypeKey(botConfig) {
  return String((botConfig && (botConfig.botType || botConfig.botId)) || '').trim().toLowerCase();
}

function createBotInstanceForConfig(botConfig) {
  const botTypeKey = getBotTypeKey(botConfig);
  if (botTypeKey === 'laundry') {
    return new LaundryBot(botConfig);
  }
  if (botTypeKey === 'thomas_network' || botTypeKey === 'thomasnetwork' || botTypeKey === 'thomas-network') {
    return new ThomasNetworkBot(botConfig);
  }

  // Any other botType runs as a pure configuration-driven bot: adding a new
  // business only requires a configs/bots/<name>.bot.json file plus its
  // WHATSAPP_ACCESS_TOKEN_<BOTID> env var — no code changes.
  return new ConfigBot(botConfig);
}

class BotRegistry {
  constructor() {
    this.bots = new Map();
    this.phoneIdToBotName = new Map();
    this.verifyTokenToBotName = new Map();
  }

  registerBot(name, botInstance, { phoneNumberId, verifyToken }) {
    if (!name || typeof name !== 'string') throw new Error('BotRegistry.registerBot requires a bot name');
    if (!botInstance) throw new Error('BotRegistry.registerBot requires a bot instance');
    if (!phoneNumberId || typeof phoneNumberId !== 'string') throw new Error('BotRegistry.registerBot requires phoneNumberId');
    if (!verifyToken || typeof verifyToken !== 'string') throw new Error('BotRegistry.registerBot requires verifyToken');

    const existingByPhone = this.phoneIdToBotName.get(phoneNumberId);
    if (existingByPhone && existingByPhone !== name) {
      throw new Error(`phoneNumberId '${phoneNumberId}' is already registered for bot '${existingByPhone}'`);
    }

    const existingByVerifyToken = this.verifyTokenToBotName.get(verifyToken);
    if (existingByVerifyToken && existingByVerifyToken !== name) {
      throw new Error(`verifyToken is already registered for bot '${existingByVerifyToken}'`);
    }

    this.bots.set(name, botInstance);
    this.phoneIdToBotName.set(phoneNumberId, name);
    this.verifyTokenToBotName.set(verifyToken, name);
  }

  getBotByPhoneId(phoneNumberId) {
    const name = this.phoneIdToBotName.get(phoneNumberId);
    if (!name) return null;
    return this.bots.get(name) || null;
  }

  getBotNameByVerifyToken(verifyToken) {
    return this.verifyTokenToBotName.get(verifyToken) || null;
  }

  getBotByName(name) {
    return this.bots.get(name) || null;
  }

  loadBotsFromDirectory(botsDirectory) {
    const botsDir = botsDirectory || path.join(process.cwd(), 'configs', 'bots');
    const files = fs.existsSync(botsDir) ? fs.readdirSync(botsDir) : [];

    for (const fileName of files.sort()) {
      if (!fileName.endsWith('.bot.json')) continue;
      const configPath = path.join(botsDir, fileName);

      let botConfig = null;
      try {
        botConfig = loadBotConfig(configPath);
      } catch (err) {
        throw new Error(`Failed to load bot config (${configPath}): ${err && err.message ? err.message : String(err)}`);
      }

      const validationErrors = validateBotConfig(botConfig, { configPath });
      if (validationErrors.length) {
        throw new Error(`Invalid bot config (${configPath}): ${validationErrors.join('; ')}`);
      }

      const botInstance = createBotInstanceForConfig(botConfig);

      this.registerBot(botConfig.botId, botInstance, {
        phoneNumberId: botConfig.phoneNumberId,
        verifyToken: botConfig.verifyToken
      });
    }
  }
}

function createDefaultRegistry() {
  const registry = new BotRegistry();

  registry.loadBotsFromDirectory();

  return registry;
}

const botRegistry = createDefaultRegistry();

module.exports = { botRegistry, BotRegistry, createDefaultRegistry, validateBotConfig };
