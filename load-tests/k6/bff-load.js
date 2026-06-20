/**
 * BFF Reporting API — load test
 *
 * Tests the reporting-bff endpoints through the API gateway under sustained
 * concurrent load.  All endpoints require a valid Auth0 JWT.
 *
 * Run:
 *   k6 run load-tests/k6/bff-load.js \
 *     -e AUTH0_DOMAIN=dev-iuo6si32jobgnmod.eu.auth0.com \
 *     -e AUTH0_CLIENT_ID=<m2m-client-id> \
 *     -e AUTH0_CLIENT_SECRET=<m2m-client-secret> \
 *     -e GATEWAY_URL=http://localhost:8080
 *
 * Targets:
 *   p95 response time  < 500 ms
 *   error rate         < 1 %
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { getM2MToken } from './lib/auth.js';

const errorRate   = new Rate('errors');
const summaryTime = new Trend('dashboard_summary_duration', true);
const txTime      = new Trend('transactions_list_duration', true);
const revenueTime = new Trend('revenue_summary_duration', true);

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // ramp up
    { duration: '2m',  target: 20 },   // sustained load
    { duration: '30s', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration:          ['p(95)<500'],
    errors:                     ['rate<0.01'],
    dashboard_summary_duration: ['p(95)<400'],
    transactions_list_duration: ['p(95)<600'],
    revenue_summary_duration:   ['p(95)<400'],
  },
};

export function setup() {
  return { token: getM2MToken() };
}

export default function ({ token }) {
  const base    = __ENV.GATEWAY_URL || 'http://localhost:8080';
  const bff     = `${base}/reports/api`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const today    = new Date().toISOString().split('T')[0];
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // ── Dashboard summary ─────────────────────────────────────────────────────
  {
    const res = http.get(`${bff}/admin/dashboard/summary`, { headers });
    summaryTime.add(res.timings.duration);
    const ok = check(res, {
      'dashboard/summary 200': (r) => r.status === 200,
      'has machines key':      (r) => JSON.parse(r.body).machines !== undefined,
    });
    errorRate.add(!ok);
  }

  sleep(0.5);

  // ── Transactions list (first page) ────────────────────────────────────────
  {
    const res = http.get(`${bff}/admin/transactions?size=20&page=0`, { headers });
    txTime.add(res.timings.duration);
    const ok = check(res, {
      'transactions 200':    (r) => r.status === 200,
      'has data array':      (r) => Array.isArray(JSON.parse(r.body).data),
    });
    errorRate.add(!ok);
  }

  sleep(0.3);

  // ── Revenue summary ───────────────────────────────────────────────────────
  {
    const res = http.get(
      `${bff}/admin/revenue/summary?startDate=${monthAgo}&endDate=${today}`,
      { headers },
    );
    revenueTime.add(res.timings.duration);
    const ok = check(res, {
      'revenue/summary 200':   (r) => r.status === 200,
      'has totalRevenue':      (r) => JSON.parse(r.body).totalRevenue !== undefined,
    });
    errorRate.add(!ok);
  }

  sleep(0.5);

  // ── Revenue by provider ───────────────────────────────────────────────────
  {
    const res = http.get(
      `${bff}/admin/revenue/by-provider?startDate=${monthAgo}&endDate=${today}`,
      { headers },
    );
    check(res, { 'revenue/by-provider 200': (r) => r.status === 200 });
    errorRate.add(res.status !== 200);
  }

  sleep(1);
}
