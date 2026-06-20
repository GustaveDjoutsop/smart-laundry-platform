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
