/**
 * End-to-end pay→start load test
 *
 * Tests the full outbox relay path under load:
 *   1. Each VU fires a webhook for a pre-seeded transaction (unique per VU)
 *   2. Polls MachineStateService until the cycle appears (status RUNNING)
 *      or times out after MAX_WAIT_S seconds
 *   3. Verifies idempotency: a duplicate webhook for the same reference
 *      must not create a second cycle
 *
 * ── Setup required BEFORE running ────────────────────────────────────────────
 * Seed the payment.transactions and machine.machines tables with test data
 * using the SQL script at load-tests/seed/pay-to-start-seed.sql.
 * Run it against the dev Supabase (or local dev Postgres) once:
 *
 *   psql $SPRING_DATASOURCE_URL -f load-tests/seed/pay-to-start-seed.sql
 *
 * The seed creates transactions with external_reference = 'LT-VU-{1..MAX_VUS}'
 * for machines washer_01..washer_XX, all pre-marked PENDING.
 *
 * ── Run ──────────────────────────────────────────────────────────────────────
 *   k6 run load-tests/k6/pay-to-start.js \
 *     -e GATEWAY_URL=http://localhost:8080 \
 *     -e AUTH0_DOMAIN=dev-iuo6si32jobgnmod.eu.auth0.com \
 *     -e AUTH0_CLIENT_ID=<m2m-client> \
 *     -e AUTH0_CLIENT_SECRET=<secret>
 *
 * ── Thresholds ───────────────────────────────────────────────────────────────
 *   cycle_start_lag p95 < 15 s   (5 s relay poll + network + DB)
 *   cycle_start_success rate > 95 %
 *   duplicate_cycles  = 0
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { getM2MToken } from './lib/auth.js';

const startLag       = new Trend('cycle_start_lag', true);
const startSuccess   = new Rate('cycle_start_success');
const duplicates     = new Counter('duplicate_cycles');

const MAX_VUS      = 10;   // must match the seed script
const MAX_WAIT_S   = 20;   // give OutboxRelayService (5 s interval) 4 tries
const POLL_INTERVAL = 2;   // seconds between MSS polls

export const options = {
  vus:      MAX_VUS,
  duration: '3m',
  thresholds: {
    cycle_start_lag:     ['p(95)<15000'],
    cycle_start_success: ['rate>0.95'],
    duplicate_cycles:    ['count==0'],
  },
};

export function setup() {
  return { token: getM2MToken() };
}

export default function ({ token }) {
  const base    = __ENV.GATEWAY_URL || 'http://localhost:8080';
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Each VU operates on its own pre-seeded transaction / machine pair
  const vuIndex  = (__VU - 1) % MAX_VUS + 1;    // 1-based
  const ref      = `LT-VU-${vuIndex}`;
  const machineId = `washer_${String(vuIndex).padStart(2, '0')}`;

  // ── Step 1: fire the MTN webhook ──────────────────────────────────────────
  const webhookStart = Date.now();
  const webhookRes = http.post(
    `${base}/payments/api/webhook/mtn`,
    JSON.stringify({ externalReference: ref, externalId: ref, status: 'SUCCESSFUL', financialTransactionId: `FIN-${ref}` }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(webhookRes, { 'webhook 200': (r) => r.status === 200 });

  // ── Step 2: poll MSS until cycle appears ─────────────────────────────────
  let started     = false;
  let cycleCount  = 0;
  const deadline  = Date.now() + MAX_WAIT_S * 1000;

  while (Date.now() < deadline) {
    sleep(POLL_INTERVAL);

    const msRes = http.get(
      `${base}/machines/api/machines/${machineId}/cycles`,
      { headers },
    );

    if (msRes.status !== 200) continue;

    let cycles;
    try { cycles = JSON.parse(msRes.body); } catch { continue; }

    // Count cycles that match our specific transaction reference
    const matching = cycles.filter(
      (c) => c.transactionReference === ref || c.transaction_reference === ref,
    );

    if (matching.length > 0) {
      startLag.add(Date.now() - webhookStart);
      started    = true;
      cycleCount = matching.length;
      break;
    }
  }

  startSuccess.add(started);

  if (cycleCount > 1) {
    duplicates.add(cycleCount - 1);
  }

  // ── Step 3: duplicate webhook — must produce no additional cycle ──────────
  if (started) {
    const dupRes = http.post(
      `${base}/payments/api/webhook/mtn`,
      JSON.stringify({ externalReference: ref, externalId: ref, status: 'SUCCESSFUL', financialTransactionId: `FIN-${ref}` }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    check(dupRes, { 'dup webhook 200': (r) => r.status === 200 });

    sleep(6); // wait > 1 relay cycle

    const msRes2 = http.get(`${base}/machines/api/machines/${machineId}/cycles`, { headers });
    if (msRes2.status === 200) {
      let cycles2;
      try { cycles2 = JSON.parse(msRes2.body); } catch { cycles2 = []; }
      const matchingAfterDup = cycles2.filter(
        (c) => c.transactionReference === ref || c.transaction_reference === ref,
      );
      if (matchingAfterDup.length > 1) {
        duplicates.add(matchingAfterDup.length - 1);
      }
    }
  }

  sleep(2);
}
