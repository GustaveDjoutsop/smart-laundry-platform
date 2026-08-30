# Current Architecture — Smart Laundry Platform

**Date:** 2026-06-12 (R6 spot-fixes applied 2026-08-18 — see note below)
**Scope:** spring-bot-manager-only, MachineStateService (MSS), PaymentManagementService (PMS), smart-laundry-dashboard

> **Staleness warning:** this document predates `api-gateway` and `reporting-bff`
> entirely — neither appears anywhere below, including the diagram in §1. It
> also predates the P0-P5 migration work in `architecture-review/03-MIGRATION-
> TODO.md` (outbox pattern, Auth0 rollout, CI gates). Treat this as a historical
> snapshot of the pre-migration architecture, not the current one. The specific
> claims below were re-verified against the code on 2026-08-18 and corrected
> where they'd gone stale (marked "R6 update"); everything else in this
> document is unverified and may also be out of date. For current status, see
> `CLAUDE.md` and `architecture-review/03-MIGRATION-TODO.md`.

## 1. Overview

The platform is a WhatsApp-driven laundry kiosk system with separate Spring Boot microservices for bot orchestration, machine control, and payments, plus a Next.js admin dashboard.

```
WhatsApp user
   │ webhook
   ▼
spring-bot-manager-only (8090)
   │  Auth0 M2M (client-credentials, sls-* scopes)
   ├──► PaymentManagementService (8081)
   │        ├──► CamPay / MTN MoMo / Orange Money (webhooks back)
   │        └──► MachineStateService /api/machines/start-cycle
   │                 (R4 update: async via outbox + relay, not fire-and-forget
   │                  anymore — see PaymentManagementService's OutboxRelayService)
   │
   └──► MachineStateService (8082)
            ├──► EQLink cloud API (MD5-signed)
            ├──► Modbus RTU gateway
            ├──► MQTT broker (Mosquitto)
            └──► ESP32 telemetry

smart-laundry-dashboard (Next.js, 3001)
   └──► unidentified Node/Mongo "admin" backend (/admin/*, /users, /timekeeping)
        — NOT MSS or PMS directly
```

## 2. Per-Service Summary

### 2.1 spring-bot-manager-only
- Multi-module Maven Spring Boot (`bot-app`, `bot-core`, `bot-laundry`, `bot-payment`, `bot-pharmacy`)
- PostgreSQL `smartbot` DB (Flyway), optional Redis, per-bot JSON configs (`configs/bots/*.bot.json`)
- Inbound: WhatsApp Cloud API webhooks, admin REST API (`/admin/bots/**`, JWT/role-secured)
- Outbound: calls PMS (`/api/payments/initiate`, status) and MSS (`/api/machines/*`, `/api/reservations/*`) via Auth0 client-credentials
- Port 8090 (mgmt 8081)

### 2.2 MachineStateService (MSS)
- Spring Boot, PostgreSQL `machinedb` (port 5435)
- Owns machine state, cycles, events, reservations
- Integrations: EQLink cloud API, Modbus RTU gateway (HTTP bridge), MQTT (Mosquitto), ESP32 telemetry ingestion
- API: `/api/machines/**`, `/api/reservations/**`, `/api/esp32/**`
- Port 8082

### 2.3 PaymentManagementService (PMS)
- Spring Boot, PostgreSQL `paymentdb` (port 5434)
- Owns transactions, RFID cards, top-ups
- Integrations: CamPay, MTN MoMo, Orange Money (mobile money providers)
- Calls MSS `/api/machines/start-cycle` after successful payment (R4 update: async via
  transactional outbox + relay with retry/backoff, not fire-and-forget anymore)
- API: `/api/payments/**`, `/api/rfid/**`, `/api/topup/**`, `/api/webhook/{provider}`
- Port 8081

### 2.4 smart-laundry-dashboard
- Next.js 14 / React 18 / TypeScript, port 3001
- Consumes a separate, unidentified Mongo-backed admin API (`/admin/*`, `/users`, `/timekeeping`, `/absences`) — not MSS/PMS
- JWT bearer auth via localStorage
- ~~socket.io-client dependency present but unused~~ **R6 update:** removed — confirmed
  zero imports anywhere in `src/`, and no WebSocket/live-status server exists to pair it with.

## 3. Shared Infrastructure (current)
- **Auth**: shared Auth0 tenant (`dev-iuo6si32jobgnmod.eu.auth0.com`, audience `https://smartlaundry.api`) for both inbound resource-server validation and outbound M2M client-credentials between the 3 Spring services
- **Databases**: 3 separate Postgres databases (`smartbot`, `machinedb`, `paymentdb`), no shared schema
- **Service discovery**: none — hardcoded `localhost:808x` URLs with per-environment overrides

## 4. Weak Points

1. **Duplicated/untyped inter-service contracts** — `bot-laundry/MachineService.java` and PMS's `MachineStartService.java` independently hand-build the same `start-cycle` JSON payload as `Map<String,Object>`. No shared DTO/contract library despite each service publishing OpenAPI specs.

2. ~~**Fire-and-forget payment→machine-start coupling**~~ **R4 update: resolved.**
   PMS now writes a `PaymentSucceeded` outbox row in the same transaction as
   the status update; `OutboxRelayService` delivers it to MSS with retry/
   backoff, and a reconciliation query alerts on any paid transaction with no
   confirmed machine start after a grace period. See
   `architecture-review/03-MIGRATION-TODO.md` R4.

3. ~~**Hardcoded secrets/defaults in committed YAML**~~ **R6 update: resolved.**
   Re-checked 2026-08-18 — PMS's `CAMPAY_APP_KEY`/`CAMPAY_APP_SECRET`/
   `CAMPAY_WEBHOOK_SECRET` and bot-manager's `AUTH0_CLIENT_SECRET`/
   `WHATSAPP_ACCESS_TOKEN_LAUNDRY` all resolve to empty env placeholders
   (`${VAR:}`), not literal values, in the current `application.yml`/
   `application.yaml`. This was a real P0 finding at the time; it's since been
   fixed (git history rotation is a separate, distinct item — see R1).

4. **No service discovery, hardcoded localhost URLs** — all cross-service base URLs default to `http://localhost:808x`; consistency across environments depends on manually-maintained Helm values per repo.

5. **Dashboard is disconnected from MSS/PMS** — the dashboard targets a fourth, unanalyzed Node/Mongo backend with a completely different API shape (`_id`, `/admin/dashboard/summary`). If the intended end state is for the dashboard to manage machines/payments/reservations, there is currently no direct integration path.
   ~~Also `.env.example` (port 3001) and `src/lib/api.ts` default (port 3000) disagree.~~
   **R6 update:** re-checked 2026-08-18 — `src/lib/api.ts` never referenced
   either port (its default is the gateway's `localhost:8080`, not the
   dashboard's own port). The real mismatch was `.env.example`'s
   `APP_BASE_URL`/Auth0 callback docs saying `3000` while `package.json`'s
   `next dev -p 3001` is the actual dev port — fixed to `3001` consistently.
   By this point the dashboard also talks to `api-gateway`/`reporting-bff`
   (`NEXT_PUBLIC_BFF_URL`, not in this doc's scope) rather than only the
   legacy Mongo backend described above — worth re-verifying which is
   actually live before trusting this bullet either.

6. ~~**CORS default mismatch**~~ **R6 update: fixed.** All five Spring
   services with a CORS config (MSS, PMS, bot-manager, api-gateway,
   reporting-bff — the last two didn't exist when this doc was written)
   now default `cors.allowed-origins`/`allowedOrigins` to `http://localhost:3001`,
   matching the dashboard's actual dev port.

7. ~~**Dead/duplicate MQTT config**~~ **R6 update: removed**, not just fixed.
   `MqttManager`/`MqttProperties` in bot-manager connected to a broker (if
   configured) but were never subscribed or published to — the only
   consumer was a health-check boolean. Deleted rather than kept as a
   fallback nothing used; MachineStateService remains the sole MQTT owner.

8. **Manually-synchronized business constants** — the reservation fee in MSS must equal PMS's long-cycle price; no single source of truth, so the two configs can silently diverge.

9. **No event-driven backbone** — all communication is synchronous REST. Payment success, machine state changes, and reservation events are not published anywhere for other consumers (e.g., dashboard, analytics, audit log) to subscribe to.

10. **3 separate relational databases with no unified reporting/read model** — cross-cutting queries (e.g., "revenue per machine per day", "customer payment + machine usage history") require joining across service boundaries at the application level, which doesn't currently happen anywhere — likely why the dashboard uses yet another backend/store.
