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

function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

test('GET /payment-return shows a friendly landing page instead of 404ing', async () => {
  const app = createApp({});

  const { server, port } = await startServer(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/payment-return`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');

    const body = await res.text();
    assert.match(body, /Payment received/);
    assert.match(body, /close this tab/i);
  } finally {
    await stopServer(server);
  }
});
