# Load Tests — Smart Laundry Platform

k6 scripts for P7 load/chaos validation of the pay→start critical path and BFF reporting API.

## Prerequisites

- [k6](https://k6.io/docs/get-started/installation/) v0.50+
- All services running locally (or point `GATEWAY_URL` at staging)
- Auth0 M2M client with at least `read:reports` scope (or the standard admin M2M used by CI)

## Scripts

| Script | What it tests | Auth required |
|--------|--------------|---------------|
| `k6/bff-load.js` | BFF reporting endpoints under sustained 20-VU load | Yes (Auth0 M2M) |
| `k6/webhook-throughput.js` | PMS webhook processing throughput + spike | No |
| `k6/pay-to-start.js` | End-to-end outbox relay: webhook → cycle start + idempotency | Yes (Auth0 M2M) |

## Running

### 1. BFF reporting load test

```bash
k6 run load-tests/k6/bff-load.js \
  -e AUTH0_DOMAIN=dev-iuo6si32jobgnmod.eu.auth0.com \
  -e AUTH0_CLIENT_ID=<m2m-client-id> \
  -e AUTH0_CLIENT_SECRET=<m2m-client-secret> \
  -e GATEWAY_URL=http://localhost:8080
```

Expected: p95 < 500 ms, error rate < 1 %.

### 2. Webhook throughput test

```bash
k6 run load-tests/k6/webhook-throughput.js \
  -e GATEWAY_URL=http://localhost:8080
```

Runs a 2-minute steady load (20 VUs) then a 15-second spike (100 VUs).
Expected: p95 < 200 ms, non-2xx rate < 0.5 %.

### 3. Pay→start end-to-end test

**Step 1 — seed the database:**
```bash
psql "$SPRING_DATASOURCE_URL" -f load-tests/seed/pay-to-start-seed.sql
```

**Step 2 — run the test:**
```bash
k6 run load-tests/k6/pay-to-start.js \
  -e AUTH0_DOMAIN=dev-iuo6si32jobgnmod.eu.auth0.com \
  -e AUTH0_CLIENT_ID=<m2m-client-id> \
  -e AUTH0_CLIENT_SECRET=<m2m-client-secret> \
  -e GATEWAY_URL=http://localhost:8080
```

Expected:
- `cycle_start_lag` p95 < 15 s (OutboxRelayService polls every 5 s)
- `cycle_start_success` rate > 95 %
- `duplicate_cycles` count = 0 (idempotency holds)

**Step 3 — clean up:**
```bash
psql "$SPRING_DATASOURCE_URL" -c "DELETE FROM payment.transactions WHERE external_reference LIKE 'LT-VU-%';"
psql "$SPRING_DATASOURCE_URL" -c "DELETE FROM machine.machine_cycles WHERE transaction_reference LIKE 'LT-VU-%';"
```

## Interpreting Results

| Metric | Threshold | If exceeded |
|--------|-----------|-------------|
| `http_req_duration p95` | < 500 ms (BFF) / < 200 ms (webhook) | Tune HikariCP pool sizes or Resilience4j timeouts |
| `errors rate` | < 1 % | Check gateway rate-limiter burst capacity |
| `cycle_start_lag p95` | < 15 s | Reduce `OutboxRelayService` poll interval (default 5 s) |
| `duplicate_cycles` | 0 | Idempotency index on `machine_cycles.transaction_reference` is missing or not applied |

## Tuning levers

After a test run, adjust these before re-running:

- **Gateway rate limiter**: `api-gateway/src/main/resources/application.yml` → `redis-rate-limiter.burstCapacity`
- **HikariCP pool**: each service's `application.yml` → `spring.datasource.hikari.maximum-pool-size`
- **Outbox relay interval**: `PaymentManagementService` → `OutboxRelayService` `@Scheduled(fixedDelay=5000)` → reduce to 2000 if lag is too high
- **Resilience4j timeouts**: `api-gateway` circuit-breaker config
