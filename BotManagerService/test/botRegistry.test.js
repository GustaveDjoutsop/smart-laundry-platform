const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { BotRegistry } = require('../src/core/botRegistry');

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function createMinimalFlowConfig({ botId, botType, phoneNumberId, verifyToken }) {
  return {
    botId,
    botType,
    botName: botId,
    phoneNumberId,
    verifyToken,
    defaultFlowId: 'main_menu',
    flows: {
      main_menu: {
        triggers: ['hi'],
        states: [{ id: 'welcome', type: 'message', template: 'hi', next: 'welcome' }]
      }
    }
  };
}

test('BotRegistry loads multiple bot configs and routes by phoneNumberId and verifyToken', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bms-bots-'));

  const botConfigA = createMinimalFlowConfig({
    botId: 'laundry_a',
    botType: 'laundry',
    phoneNumberId: 'PHONE_A',
    verifyToken: 'VERIFY_A'
  });
  const botConfigB = createMinimalFlowConfig({
    botId: 'laundry_b',
    botType: 'laundry',
    phoneNumberId: 'PHONE_B',
    verifyToken: 'VERIFY_B'
  });

  writeJson(path.join(tempDirectory, 'a.bot.json'), botConfigA);
  writeJson(path.join(tempDirectory, 'b.bot.json'), botConfigB);

  const registry = new BotRegistry();
  registry.loadBotsFromDirectory(tempDirectory);

  assert.ok(registry.getBotByPhoneId('PHONE_A'));
  assert.ok(registry.getBotByPhoneId('PHONE_B'));

  assert.equal(registry.getBotNameByVerifyToken('VERIFY_A'), 'laundry_a');
  assert.equal(registry.getBotNameByVerifyToken('VERIFY_B'), 'laundry_b');
});

test('BotRegistry registers unknown botType as a generic config-driven bot', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bms-bots-'));

  const botConfig = createMinimalFlowConfig({
    botId: 'brand_new_business',
    botType: 'brand_new_business',
    phoneNumberId: 'PHONE_NEW',
    verifyToken: 'VERIFY_NEW'
  });

  writeJson(path.join(tempDirectory, 'new.bot.json'), botConfig);

  const registry = new BotRegistry();
  registry.loadBotsFromDirectory(tempDirectory);

  const bot = registry.getBotByPhoneId('PHONE_NEW');
  assert.ok(bot, 'bot with unknown botType should still be registered');
  assert.equal(typeof bot.handleMessage, 'function');
  assert.equal(registry.getBotNameByVerifyToken('VERIFY_NEW'), 'brand_new_business');
});

test('BotRegistry rejects bot config without flows', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bms-bots-'));

  const botConfig = createMinimalFlowConfig({
    botId: 'flowless',
    botType: 'flowless',
    phoneNumberId: 'PHONE_FLOWLESS',
    verifyToken: 'VERIFY_FLOWLESS'
  });
  delete botConfig.flows;

  writeJson(path.join(tempDirectory, 'flowless.bot.json'), botConfig);

  const registry = new BotRegistry();
  assert.throws(() => registry.loadBotsFromDirectory(tempDirectory), /flows is required/);
});

test('BotRegistry substitutes ${VAR} env placeholders in bot configs', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bms-bots-'));

  const botConfig = createMinimalFlowConfig({
    botId: 'env_bot',
    botType: 'env_bot',
    phoneNumberId: 'PHONE_ENV',
    verifyToken: '${TEST_VERIFY_TOKEN_ENV_BOT}'
  });

  writeJson(path.join(tempDirectory, 'env.bot.json'), botConfig);

  process.env.TEST_VERIFY_TOKEN_ENV_BOT = 'resolved-secret';
  try {
    const registry = new BotRegistry();
    registry.loadBotsFromDirectory(tempDirectory);

    assert.equal(registry.getBotNameByVerifyToken('resolved-secret'), 'env_bot');
    assert.equal(registry.getBotNameByVerifyToken('${TEST_VERIFY_TOKEN_ENV_BOT}'), null);
  } finally {
    delete process.env.TEST_VERIFY_TOKEN_ENV_BOT;
  }
});

test('BotRegistry rejects duplicate phoneNumberId', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bms-bots-'));

  const botConfigA = createMinimalFlowConfig({
    botId: 'laundry_a',
    botType: 'laundry',
    phoneNumberId: 'PHONE_DUP',
    verifyToken: 'VERIFY_A'
  });
  const botConfigB = createMinimalFlowConfig({
    botId: 'laundry_b',
    botType: 'laundry',
    phoneNumberId: 'PHONE_DUP',
    verifyToken: 'VERIFY_B'
  });

  writeJson(path.join(tempDirectory, 'a.bot.json'), botConfigA);
  writeJson(path.join(tempDirectory, 'b.bot.json'), botConfigB);

  const registry = new BotRegistry();
  assert.throws(() => registry.loadBotsFromDirectory(tempDirectory), /phoneNumberId 'PHONE_DUP' is already registered/);
});

test('BotRegistry rejects invalid bot config missing verifyToken', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bms-bots-'));

  const botConfig = createMinimalFlowConfig({
    botId: 'laundry_a',
    botType: 'laundry',
    phoneNumberId: 'PHONE_A',
    verifyToken: 'VERIFY_A'
  });
  delete botConfig.verifyToken;

  writeJson(path.join(tempDirectory, 'invalid.bot.json'), botConfig);

  const registry = new BotRegistry();
  assert.throws(() => registry.loadBotsFromDirectory(tempDirectory), /verifyToken is required/);
});
