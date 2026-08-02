const test = require('node:test');
const assert = require('node:assert/strict');

const { requireAdminToken } = require('../src/middleware/adminAuth');

function fakeReqRes({ authorization } = {}) {
  const req = { get: (name) => (String(name).toLowerCase() === 'authorization' ? authorization : undefined) };
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
  return { req, res };
}

test('requireAdminToken fails closed (503) when no token is configured, even with a plausible-looking header', () => {
  const middleware = requireAdminToken({ token: undefined });
  const { req, res } = fakeReqRes({ authorization: 'Bearer whatever' });

  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 503);
});

test('requireAdminToken rejects (401) a missing Authorization header', () => {
  const middleware = requireAdminToken({ token: 'secret-token' });
  const { req, res } = fakeReqRes({});

  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('requireAdminToken rejects (401) a wrong bearer token', () => {
  const middleware = requireAdminToken({ token: 'secret-token' });
  const { req, res } = fakeReqRes({ authorization: 'Bearer wrong-token' });

  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('requireAdminToken calls next() for a correct bearer token', () => {
  const middleware = requireAdminToken({ token: 'secret-token' });
  const { req, res } = fakeReqRes({ authorization: 'Bearer secret-token' });

  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});
