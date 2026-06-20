# Current Architecture — Smart Laundry Platform

**Date:** 2026-06-12
**Scope:** spring-bot-manager-only, MachineStateService (MSS), PaymentManagementService (PMS), smart-laundry-dashboard

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
   │        └──► MachineStateService /api/machines/start-cycle (fire-and-forget)
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
- Calls MSS `/api/machines/start-cycle` after successful payment (fire-and-forget, exceptions swallowed)
- API: `/api/payments/**`, `/api/rfid/**`, `/api/topup/**`, `/api/webhook/{provider}`
- Port 8081

### 2.4 smart-laundry-dashboard
- Next.js 14 / React 18 / TypeScript, port 3001
- Consumes a separate, unidentified Mongo-backed admin API (`/admin/*`, `/users`, `/timekeeping`, `/absences`) — not MSS/PMS
- JWT bearer auth via localStorage
- socket.io-client dependency present but unused

## 3. Shared Infrastructure (current)
- **Auth**: shared Auth0 tenant (`dev-iuo6si32jobgnmod.eu.auth0.com`, audience `https://smartlaundry.api`) for both inbound resource-server validation and outbound M2M client-credentials between the 3 Spring services
- **Databases**: 3 separate Postgres databases (`smartbot`, `machinedb`, `paymentdb`), no shared schema
- **Service discovery**: none — hardcoded `localhost:808x` URLs with per-environment overrides

## 4. Weak Points

1. **Duplicated/untyped inter-service contracts** — `bot-laundry/MachineService.java` and PMS's `MachineStartService.java` independently hand-build the same `start-cycle` JSON payload as `Map<String,Object>`. No shared DTO/contract library despite each service publishing OpenAPI specs.

2. **Fire-and-forget payment→machine-start coupling** — `MachineStartService.notifyMachineStart()` in PMS swallows exceptions on the call to MSS. A network blip after a successful payment leaves the customer charged but the machine never starts, with no retry, no queue, no compensating action — only a log line.

3. **Hardcoded secrets/defaults in committed YAML** — PMS `application.yml` contains CamPay app key/secret/webhook-secret as literal default values; bot-manager `application.yaml` has default Auth0 client-id/secret and a WhatsApp access token as fallback defaults. These are committed secrets risks.

4. **No service discovery, hardcoded localhost URLs** — all cross-service base URLs default to `http://localhost:808x`; consistency across environments depends on manually-maintained Helm values per repo.

5. **Dashboard is disconnected from MSS/PMS** — the dashboard targets a fourth, unanalyzed Node/Mongo backend with a completely different API shape (`_id`, `/admin/dashboard/summary`). If the intended end state is for the dashboard to manage machines/payments/reservations, there is currently no direct integration path. Also `.env.example` (port 3001) and `src/lib/api.ts` default (port 3000) disagree.

6. **CORS default mismatch** — all 3 Spring services default `cors.allowed-origins` to `:3000`, but the dashboard runs on `:3001`.

7. **Dead/duplicate MQTT config** — bot-manager retains MQTT config "for fallback" though MQTT ownership moved to MSS, adding confusion and configuration drift risk.

8. **Manually-synchronized business constants** — the reservation fee in MSS must equal PMS's long-cycle price; no single source of truth, so the two configs can silently diverge.

9. **No event-driven backbone** — all communication is synchronous REST. Payment success, machine state changes, and reservation events are not published anywhere for other consumers (e.g., dashboard, analytics, audit log) to subscribe to.

10. **3 separate relational databases with no unified reporting/read model** — cross-cutting queries (e.g., "revenue per machine per day", "customer payment + machine usage history") require joining across service boundaries at the application level, which doesn't currently happen anywhere — likely why the dashboard uses yet another backend/store.
