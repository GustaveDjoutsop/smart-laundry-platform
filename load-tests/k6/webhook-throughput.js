/**
 * PMS webhook throughput test
 *
 * Floods the MTN MoMo webhook endpoint to measure how many callbacks
 * per second the PaymentManagementService can process (DB write + outbox
 * insert inside a single @Transactional) before latency or errors rise.
 *
 * The MTN webhook has no signature check yet (TODO in WebhookController),
 * so no auth header is needed.  Each iteration uses a unique
 * external_reference so no deduplication occurs.
 *
 * Most requests will log TRANSACTION_NOT_FOUND (no matching pre-seeded
 * transaction) — this is expected and the controller returns 200 OK.
 * This still exercises the full DB lookup path + outbox write path when
 * a matching transaction does exist (see pay-to-start.js for that flow).
 *
 * Run:
 *   k6 run load-tests/k6/webhook-throughput.js \
 *     -e GATEWAY_URL=http://localhost:8080
 *
 * Targets:
 *   p95 webhook duration  < 200 ms
 *   error rate (non-2xx)  < 0.5 %
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter } from 'k6/metrics';

const errorRate = new Rate('errors');
const webhooks  = new Counter('webhooks_sent');

export const options = {
  scenarios: {
    // Steady-state: 20 VUs hammering the webhook endpoint for 2 minutes
    steady: {
      executor:  'constant-vus',
      vus:       20,
      duration:  '2m',
      gracefulStop: '10s',
    },
    // Spike: 100 VUs for 15 seconds to test burst handling
    spike: {
      executor:     'constant-vus',
      vus:          100,
      duration:     '15s',
      startTime:    '2m10s',
      gracefulStop: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<200', 'p(99)<500'],
    errors:            ['rate<0.005'],
  },
};

export default function () {
  const base = __ENV.GATEWAY_URL || 'http://localhost:8080';

  // Unique reference per iteration — won't match any real transaction,
  // but exercises the full webhook parse → DB lookup → swallowed-TRANSACTION_NOT_FOUND path.
  const ref = `LOAD-${__VU}-${__ITER}-${Date.now()}`;

  const payload = JSON.stringify({
    externalReference:        ref,
    externalId:               ref,         // alias field (some providers send this)
    status:                   'SUCCESSFUL',
    financialTransactionId:   `FIN-${ref}`,
    reason:                   null,
  });

  const res = http.post(
    `${base}/payments/api/webhook/mtn`,
    payload,
    { headers: { 'Content-Type': 'application/json' } },
  );

  webhooks.add(1);

  const ok = check(res, {
    'webhook 200': (r) => r.status === 200,
    'status received': (r) => {
      try { return JSON.parse(r.body).status === 'received'; } catch { return false; }
    },
  });
  errorRate.add(!ok);

  sleep(0.1);
}
