const test = require('node:test');
const assert = require('node:assert/strict');

const { createRateLimiter } = require('../src/middleware/rateLimit');

function createReqRes(ip) {
  const req = { ip };
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    set: function (name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
    },
    status: function (code) {
      this.statusCode = code;
      return this;
    },
    json: function (payload) {
      this.body = payload;
      return this;
    }
  };
  return { req, res };
}

test('rate limiter returns 429 after max requests in window', async () => {
  let now = 1_000;
  const limiter = createRateLimiter({ windowMs: 1000, maxRequests: 2, keyPrefix: 't', nowFn: () => now });

  const { req, res } = createReqRes('1.2.3.4');

  let nextCalls = 0;
  const next = () => {
    nextCalls += 1;
  };

  limiter(req, res, next);
  limiter(req, res, next);
  limiter(req, res, next);

  assert.equal(nextCalls, 2);
  assert.equal(res.statusCode, 429);
  assert.ok(res.body);
  assert.equal(res.body.error, 'Too Many Requests');
  assert.ok(Number(res.headers['retry-after']) >= 1);

  // After window reset, requests pass again
  now += 1001;
  const { req: req2, res: res2 } = createReqRes('1.2.3.4');
  let nextCalls2 = 0;
  const next2 = () => {
    nextCalls2 += 1;
  };
  limiter(req2, res2, next2);
  assert.equal(nextCalls2, 1);
  assert.equal(res2.statusCode, 200);
});
