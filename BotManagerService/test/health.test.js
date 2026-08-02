const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../src/app');

async function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

test('GET /api/health includes dependency connectivity', async () => {
  const app = createApp({
    redisManager: { connected: false },
    mqttManager: { url: 'mqtt://localhost:1883', connected: false }
  });

  const { server, port } = await startServer(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.ok, true);
    assert.equal(body.service, 'BotManagerService');
    assert.ok(body.dependencies);
    assert.ok(body.dependencies.redis);
    assert.ok(body.dependencies.mqtt);

    assert.equal(body.dependencies.mqtt.configured, true);
    assert.equal(body.dependencies.mqtt.connected, false);
  } finally {
    server.close();
  }
});
