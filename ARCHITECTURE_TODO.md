# Architecture Migration TODO

**Date:** 2026-06-12
**Reference:** [TARGET_ARCHITECTURE.md](./TARGET_ARCHITECTURE.md) | [CURRENT_ARCHITECTURE.md](./CURRENT_ARCHITECTURE.md)

## Phase 0 — Security & Config Hygiene (do first, low risk)
- [ ] Remove hardcoded CamPay app key/secret/webhook-secret defaults from `PaymentManagementService/src/main/resources/application.yml`; require via env vars
- [ ] Remove hardcoded Auth0 client-id/secret defaults and WhatsApp access token default from `spring-bot-manager-only/bot-app/src/main/resources/application.yaml`
- [ ] Rotate any secrets that were committed in plaintext — inventory complete, rotation tracked in [`docs/SECRET-ROTATION.md`](./docs/SECRET-ROTATION.md) (R1). Note: the earlier stripping pass covered `application.yml`/`application.yaml` only; a live Twilio SID + auth token survived at HEAD in root `docker-compose.yml` and a real Meta token in a test fixture. Both remediated in code; provider-side rotation still outstanding.
- [x] Add automated secret scanning so this cannot recur — blocking gitleaks gate in `.github/workflows/secret-scan.yml` plus weekly full-history sweep (R1)
- [ ] Move all secrets to a secret manager (Vault / AWS Secrets Manager / k8s Secrets) per environment
- [ ] Remove legacy MQTT fallback config from spring-bot-manager-only
- [ ] Fix `smart-laundry-dashboard/.env.example` vs `src/lib/api.ts` API base URL mismatch (align both on the future reporting-api URL)
- [ ] Standardize `cors.allowed-origins` across all 3 Spring services to env-driven, no `:3000` hardcoded default

## Phase 1 — Shared Contracts
- [ ] Create `laundry-contracts` shared module (Maven, versioned/published to internal repo)
- [ ] Define DTOs: `MachineStartRequest`, `ReservationRequest`/`ReservationResponse`, `PaymentInitiateRequest`, `TransactionStatus`
- [ ] Refactor `bot-laundry/MachineService.java` to use `MachineStartRequest` DTO instead of `Map<String,Object>`
- [ ] Refactor `PaymentManagementService/.../MachineStartService.java` to use the same DTO
- [ ] Refactor MSS controllers (`MachineController`, `ReservationController`) to accept the shared request DTOs
- [ ] Regenerate/align each service's `api-doc/openapi.yaml` from the shared contracts

## Phase 2 — Event Backbone
- [ ] Stand up message broker (RabbitMQ recommended) per environment
- [ ] Define event schemas: `payment.succeeded`, `payment.failed`, `machine.cycle.started`, `machine.cycle.completed`, `reservation.created`, `reservation.activated`
- [ ] PMS: publish `payment.succeeded`/`payment.failed` on transaction status change
- [ ] MSS: publish `machine.cycle.started`/`machine.cycle.completed`/`reservation.*` events
- [ ] Implement `payment.succeeded` consumer (in MSS) to trigger `MachineService.startCycle()` with retry + dead-letter queue
- [ ] Remove the old fire-and-forget `MachineStartService.notifyMachineStart()` synchronous call from PMS (or keep as a fast-path optimization, with the event as the durable guarantee — decide based on latency requirements)
- [ ] Add alerting on dead-letter queue depth
- [ ] Add a reconciliation job to replay/inspect dead-lettered machine-start events

## Phase 3 — Single Source of Truth for Shared Constants
- [ ] Identify all manually-synced business constants (reservation fee vs. long-cycle price, etc.)
- [ ] Implement shared config source (config map, or PMS exposes pricing via API that MSS reads on startup/refresh)
- [ ] Update MSS and PMS to consume from the shared source; remove duplicated literals

## Phase 4 — MongoDB Cluster Setup
- [ ] Provision 3-node MongoDB replica set (Atlas managed cluster, or self-hosted PSA topology)
- [ ] Configure network access, auth (SCRAM users per service), TLS
- [ ] Create `laundry_reporting` database with collections: `transactions_view`, `machine_events_view`, `machine_cycles_view`, `reservations_view`, `revenue_daily`
- [ ] Migrate existing dashboard-only collections (`users`, `timekeeping`, `absences`, `cafe`, `feedback`, `expenses`) from the current unidentified Mongo backend into this cluster
- [ ] Set up indexes (machineId, transactionId, date ranges) per collection
- [ ] Set up scheduled aggregation job for `revenue_daily`

## Phase 5 — Reporting Sync & Reporting API
- [ ] Build "reporting-sync" consumer subscribing to the event broker, projecting events into MongoDB views
- [ ] Build "reporting-api" service (thin Node/Express or Spring module):
  - [ ] Read endpoints backed by MongoDB views for dashboard (`/admin/dashboard/summary`, `/admin/machines`, `/admin/transactions`, `/admin/revenue/*`, `/users`, `/timekeeping/*`, `/absences/*`)
  - [ ] Write endpoints proxy to MSS/PMS via Auth0 M2M using `laundry-contracts` DTOs (machine commands, refunds, reservation management)
  - [ ] Auth: validate dashboard JWTs (same Auth0 tenant) on inbound; M2M client-credentials outbound to MSS/PMS

## Phase 6 — Dashboard Cutover
- [ ] Point `smart-laundry-dashboard` at the new reporting-api (update `NEXT_PUBLIC_API_URL`)
- [ ] Verify all dashboard pages (machines, transactions, revenue, maintenance, reports, expenses, feedback, users, timekeeping, absences, cafe, settings) against reporting-api
- [ ] Decommission the old unidentified Mongo backend once parity confirmed
- [ ] Implement/verify socket.io real-time updates if live machine status is required (currently unused dependency)

## Phase 7 — Validation & Rollout
- [ ] End-to-end test: WhatsApp payment → payment.succeeded event → machine start → cycle.completed event → dashboard reflects updated state
- [ ] Load-test message broker and MongoDB cluster under expected peak transaction volume
- [ ] Update Helm values / deployment manifests for new services (broker, reporting-sync, reporting-api, MongoDB connection strings)
- [ ] Update `docs/COMMUNICATION_FLOW.md` in all repos to reflect new architecture
- [ ] Staged rollout: Phase 0-1 first (no behavior change risk), then Phase 2 with feature flag to fall back to sync call, then Phases 4-6
