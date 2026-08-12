// Regression coverage for the BSUID silent-drop bug: a customer who adopted
// a WhatsApp username arrives with message.from and contacts[0].wa_id both
// "" and only contacts[0].user_id (their BSUID) populated. Before this fix,
// `receive` required `from` truthy and returned 200 without ever enqueueing
// the message - no bot reply, no error, no log. See
// afromarket-bsuid-codebase-readiness-agent-instructions.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { createApp } = require('../src/app');
const { botRegistry } = require('../src/core/botRegistry');
const { queueManager } = require('../src/core/messageQueue');
const { messageStatusWaiter } = require('../src/core/whatsapp/messageStatusWaiter');

const TEST_PHONE_NUMBER_ID = 'phone-number-id-bsuid-test';
const TEST_BOT_NAME = 'bsuid-test-bot';

function registerTestBot() {
  if (botRegistry.getBotByPhoneId(TEST_PHONE_NUMBER_ID)) return;
  botRegistry.registerBot(
    TEST_BOT_NAME,
    { config: { botId: TEST_BOT_NAME } },
    { phoneNumberId: TEST_PHONE_NUMBER_ID, verifyToken: 'verify-token-bsuid-test' }
  );
}

async function withServer(fn) {
  const app = createApp({});
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function webhookPayload({ from, waId, userId }) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-id',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550783881', phone_number_id: TEST_PHONE_NUMBER_ID },
              contacts: [{ profile: { name: 'Test Customer' }, wa_id: waId, user_id: userId }],
              messages: [{ from, id: 'wamid.test123', timestamp: '1700000000', type: 'text', text: { body: 'Hi!' } }]
            },
            field: 'messages'
          }
        ]
      }
    ]
  };
}

test('POST /api/whatsapp/webhook enqueues a BSUID-only message instead of silently dropping it', async (t) => {
  registerTestBot();

  const enqueued = [];
  queueManager.setProcessor(async (job) => enqueued.push(job));
  t.after(() => queueManager.setProcessor(async () => {}));

  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload({ from: '', waId: '', userId: 'user.bsuid-only-customer' }))
    });

    assert.equal(res.status, 200);
  });

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].from, 'user.bsuid-only-customer');
  assert.equal(enqueued[0].identifierType, 'bsuid');
  assert.equal(enqueued[0].phone, null);
  assert.equal(enqueued[0].bsuid, 'user.bsuid-only-customer');
});

test('POST /api/whatsapp/webhook still routes normally on a plain phone-number message', async (t) => {
  registerTestBot();

  const enqueued = [];
  queueManager.setProcessor(async (job) => enqueued.push(job));
  t.after(() => queueManager.setProcessor(async () => {}));

  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload({ from: '16505551234', waId: '16505551234', userId: undefined }))
    });

    assert.equal(res.status, 200);
  });

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].from, '16505551234');
  assert.equal(enqueued[0].identifierType, 'phone');
  assert.equal(enqueued[0].phone, '16505551234');
  assert.equal(enqueued[0].bsuid, null);
});

test('POST /api/whatsapp/webhook carries both identifiers when Meta pairs them via the contact book', async (t) => {
  registerTestBot();

  const enqueued = [];
  queueManager.setProcessor(async (job) => enqueued.push(job));
  t.after(() => queueManager.setProcessor(async () => {}));

  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        webhookPayload({ from: '16505551234', waId: '16505551234', userId: 'user.paired-customer' })
      )
    });

    assert.equal(res.status, 200);
  });

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].from, '16505551234');
  assert.equal(enqueued[0].identifierType, 'phone');
  assert.equal(enqueued[0].phone, '16505551234');
  assert.equal(enqueued[0].bsuid, 'user.paired-customer');
});

test('POST /api/whatsapp/webhook notifies messageStatusWaiter on a delivery-status payload, without enqueueing it as a conversation message', async (t) => {
  registerTestBot();

  const enqueued = [];
  queueManager.setProcessor(async (job) => enqueued.push(job));
  t.after(() => queueManager.setProcessor(async () => {}));
  t.after(() => messageStatusWaiter.reset());

  const statusPromise = messageStatusWaiter.waitFor('wamid.status-test123', 5000);

  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-id',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '15550783881', phone_number_id: TEST_PHONE_NUMBER_ID },
                  statuses: [{ id: 'wamid.status-test123', status: 'sent', timestamp: '1700000000' }]
                },
                field: 'messages'
              }
            ]
          }
        ]
      })
    });

    assert.equal(res.status, 200);
  });

  const { status, timedOut } = await statusPromise;
  assert.equal(timedOut, false);
  assert.equal(status, 'sent');
  assert.equal(enqueued.length, 0);
});

test('POST /api/whatsapp/webhook still ignores a genuinely empty non-message event (no from, no BSUID)', async (t) => {
  registerTestBot();

  const enqueued = [];
  queueManager.setProcessor(async (job) => enqueued.push(job));
  t.after(() => queueManager.setProcessor(async () => {}));

  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'waba-id', changes: [] }] })
    });

    assert.equal(res.status, 200);
  });

  assert.equal(enqueued.length, 0);
});
