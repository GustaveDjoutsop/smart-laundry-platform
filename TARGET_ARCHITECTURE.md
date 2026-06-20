# Target Architecture — Smart Laundry Platform

**Date:** 2026-06-12
**Status:** Proposed
**Builds on:** [CURRENT_ARCHITECTURE.md](./CURRENT_ARCHITECTURE.md)

## 1. Goals

- Remove silent failure between Payment → Machine-start
- Single source of truth for cross-service contracts (machine/payment/reservation payloads)
- Connect smart-laundry-dashboard to real data from MSS/PMS/bot-manager
- Introduce a shared MongoDB cluster for reporting/read-models and dashboard consumption, without ripping out the existing Postgres-per-service transactional stores
- Eliminate hardcoded secrets and localhost-only service URLs
- Add an event backbone for async, auditable cross-service communication

## 2. High-Level Target Diagram

```
WhatsApp user
   │
   ▼
spring-bot-manager-only (8090)
   │  Auth0 M2M
   ├──► PaymentManagementService (8081) ──► CamPay/MTN/Orange
   └──► MachineStateService (8082) ──► EQLink / Modbus / MQTT / ESP32

PMS & MSS:
   - keep own Postgres (paymentdb, machinedb) for transactional/operational state
   - publish domain events to a message broker (e.g. RabbitMQ / Kafka)
       payment.succeeded, payment.failed, machine.cycle.started,
       machine.cycle.completed, reservation.created, ...

Event Consumers:
   - "machine-start" consumer (in MSS or bot-manager) replaces fire-and-forget call:
       subscribes to payment.succeeded → calls /api/machines/start-cycle
       with retry + dead-letter queue
   - "reporting-sync" consumer: projects events + periodic sync into MongoDB cluster
       (Atlas / self-hosted replica set, 3-node)

MongoDB Cluster (replica set, 3 nodes)
   - db: laundry_reporting
       collections: transactions_view, machine_events_view, reservations_view,
                     revenue_daily, users, timekeeping, absences
   - Used as the READ MODEL for smart-laundry-dashboard

smart-laundry-dashboard (Next.js, 3001)
   └──► new "reporting-api" (thin Node/Express service, or extend bot-manager)
            reads from MongoDB cluster
            proxies write-actions (machine commands, refunds) to MSS/PMS via Auth0 M2M
```

## 3. Key Changes

### 3.1 Shared Contracts Module
Create a small shared library (e.g. `laundry-contracts`, published as a versioned Maven artifact) containing DTOs for:
- `MachineStartRequest` (machineId, cycleType, durationMinutes, pulseCount, transactionReference, rfidCardUid)
- `ReservationRequest` / `ReservationResponse`
- `PaymentInitiateRequest` / `TransactionStatus`
- Common event payloads (see 3.2)

All three Spring services depend on this module instead of hand-building `Map<String,Object>`.

### 3.2 Event-Driven Payment → Machine-Start
Replace PMS's synchronous, exception-swallowed call to MSS:
- PMS publishes `payment.succeeded` (transactionId, machineId, cycle params, rfidCardUid) to a message broker on a durable queue/topic
- A consumer (new lightweight component, or a module inside MSS) subscribes, calls `MachineService.startCycle()` internally (in-process if hosted in MSS) or via the contracts-defined REST call with retry/backoff
- Failed attempts go to a dead-letter queue with alerting; a reconciliation job can replay them
- This guarantees: payment success is durably recorded as an intent to start a machine, independent of MSS availability at that instant

Broker choice: RabbitMQ is sufficient for this volume and simpler to operate than Kafka; use Kafka only if event replay/analytics fan-out across many consumers is anticipated.

### 3.3 MongoDB Cluster for Reporting & Dashboard
- Deploy a 3-node MongoDB replica set (MongoDB Atlas recommended for managed ops, or self-hosted replica set with PSA topology for cost-sensitive deployments)
- Each Spring service's event publisher also writes (or a single "reporting-sync" consumer writes) denormalized projections into MongoDB:
  - `transactions_view` (from PMS transaction lifecycle events)
  - `machine_events_view`, `machine_cycles_view` (from MSS)
  - `reservations_view` (from MSS)
  - `revenue_daily` aggregates (materialized via scheduled aggregation pipeline)
- The existing dashboard collections (`users`, `timekeeping`, `absences`, `cafe`, `feedback`, `expenses`) — currently served by the unidentified Mongo backend — move into this same cluster as their own databases/collections, consolidating to one operational MongoDB cluster instead of an unknown separate one
- Postgres remains the system-of-record for transactional writes in PMS/MSS; MongoDB is the read-optimized projection — avoids a risky rewrite of the transactional services

### 3.4 Dashboard Integration
- Introduce a thin "reporting-api" service (Node/Express or a new Spring module) that:
  - Reads from the MongoDB cluster for all dashboard list/summary/report views
  - For write actions (start/stop machine, issue refund, manage reservations), proxies authenticated requests to MSS/PMS using the shared Auth0 M2M client (reusing `laundry-contracts` DTOs)
- Fix `.env.example` vs `src/lib/api.ts` port mismatch (`NEXT_PUBLIC_API_URL` must point at reporting-api, both set to same value)
- Standardize CORS: each Spring service's `cors.allowed-origins` driven entirely by env var per environment, default to the dashboard's actual deployed origin (not hardcoded `:3000`)

### 3.5 Configuration & Secrets
- Remove all literal secret defaults from `application.yml`/`application.yaml` (CamPay keys, Auth0 client secret, WhatsApp access token) — require them via env vars / secret manager (e.g. Vault, AWS Secrets Manager, or k8s Secrets) with no fallback default
- Replace hardcoded `http://localhost:808x` service URLs with env-driven config in all environments (already partially done via Helm values — make this consistent and remove localhost fallbacks in non-dev profiles)

### 3.6 Single Source of Truth for Shared Business Constants
- Move shared pricing/fee constants (e.g., reservation fee = long-cycle price) into a single config source — either a shared config service, a config map mounted into both MSS and PMS, or computed by PMS and exposed via an API that MSS reads at startup/refresh — eliminating manual config-drift risk

### 3.7 Remove Dead Configuration
- Remove legacy MQTT fallback config from spring-bot-manager-only now that MSS owns MQTT

## 4. Deployment Topology (Production)

```
                ┌─────────────────────────┐
                │   MongoDB Replica Set    │
                │   (3 nodes, Atlas or     │
                │    self-hosted PSA)      │
                └────────────▲─────────────┘
                              │
   ┌──────────┐   ┌──────────┴────────┐   ┌──────────────┐
   │ bot-mgr  │   │  reporting-api    │   │  dashboard    │
   │ (8090)   │   │  (new)            │   │  (Next.js)    │
   └────┬─────┘   └─────────▲─────────┘   └──────┬────────┘
        │                    │                     │
        │ Auth0 M2M          │ Auth0 M2M           │ HTTPS
        ▼                    │                     ▼
   ┌─────────────┐    ┌──────┴──────┐      reporting-api
   │     MSS     │◄───┤     PMS     │
   │  (Postgres) │evt │ (Postgres)  │
   └─────────────┘    └─────────────┘
        │  ▲                 │
        │  │                 │
        ▼  │                 ▼
   ┌──────────────┐    ┌──────────────────┐
   │ Message Broker│    │ CamPay/MTN/Orange │
   │  (RabbitMQ)   │    └──────────────────┘
   └──────────────┘
```

## 5. Non-Goals / What We're NOT Changing
- Not migrating PMS/MSS transactional storage off Postgres
- Not replacing Auth0 — continue using existing tenant/scopes
- Not rewriting EQLink/Modbus/MQTT/ESP32 integrations in MSS
