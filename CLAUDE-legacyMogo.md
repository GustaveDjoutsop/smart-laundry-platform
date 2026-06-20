# Codierung Workspace — Gustave (Sunday) Djoutsop

## Who I Am / Business Context
Solo entrepreneur in Douala, Cameroon, building two interconnected ventures:

1. **Smart Laundry & Cafe Lounge** (SmartLaundromatControlSystem) — first
   automated laundromat in Douala. Customers pay via WhatsApp or RFID card
   (MTN MoMo, Orange Money, CamPay); washers/dryers driven by ESP32 over
   MQTT / Modbus RTU / EQLink.
2. **Smart Bot Platform** — service company building/operating WhatsApp bots
   for multiple clients (pharmacies, healthcare, restaurants...). The
   laundromat is the flagship tenant.

---

## 🔴 STATUS: MID-MIGRATION — execution plan exists, follow the phases

Three architecture docs exist in `architecture-review/`:
- `01-CURRENT-ARCHITECTURE.md` — as-is analysis, weaknesses W1–W12
- `02-TARGET-ARCHITECTURE.md` — ADR-001 (Proposed), gateway + outbox + MongoDB Atlas
- `03-MIGRATION-TODO.md` — phased plan P0–P7, sequencing P0→P1→P2→P3→{P4,P5}→P6→P7

**Default behavior: work according to the current phase.** Don't jump ahead
to P3+ work if P0 isn't done — the plan is explicitly sequenced so each phase
is independently shippable, and P0/P1 reduce the most risk for the least
effort.

### The 5 components (current state)
| # | Component | Runtime | Port | Datastore (current) |
|---|---|---|---|---|
| 1 | `spring-bot-manager-only` | Java 21 / Spring Boot 3.3.7, Maven multi-module | 8090 | PostgreSQL `smartbot` (15432) + Redis |
| 2 | `PaymentManagementService` | Java 17 / Spring Boot 3.3.5 | 8081 | PostgreSQL `paymentdb` (5434) |
| 3 | `MachineStateService` | Java 17 / Spring Boot 3.3.5 | 8082 | PostgreSQL `machinedb` (5435) |
| 4 | `smart-laundry-dashboard` | Next.js 14 / React / TS / Tailwind | 3000 | — (HTTP client) |
| 5 | *SmartLaundromatControlSystem* (legacy, to be decommissioned per P5) | Node/Express 5/Mongoose | Heroku | MongoDB |

### Target topology (per ADR-001, status: Proposed)
API Gateway (Spring Cloud Gateway) as single entry point → 3 services +
Reporting BFF + new `OperationsService` (for users/timekeeping/absences/
feedback). All persistence consolidates onto **one MongoDB Atlas cluster**,
database-per-service (`bot_db`, `payment_db`, `machine_db`, `ops_db`).
Pay→start becomes event-driven via Outbox + Change Streams + idempotency,
breaking the Payment↔Machine sync dependency. Dashboard moves to Auth0 +
gateway, single API client.

---

## ⚠️ OPEN DISAGREEMENT — read before doing Phase 2/3 work

**The MongoDB consolidation (P2/P3) deserves a second look before 3–5 weeks
go into it.** ADR-001's case for MongoDB over a single Postgres
(schema-per-service, Option A3) leans heavily on "legacy data is already
MongoDB" — but the legacy system is being **decommissioned in P5**. That
argument evaporates once P5 completes; it's a transitional-convenience
argument being used to justify a permanent architecture choice. The actual
data (`transactions`, `rfid_cards`, `reservations`, `cycles`) is relational
by nature (FKs between cards/machines/transactions); Mongo's multi-document
transactions get you back to where Postgres already was for the money path,
not ahead of it. Telemetry/events are the one genuinely document/time-series
shaped dataset — that could go into Mongo or a time-series store without
moving the relational core.

**This is flagged, not blocking** — ADR-001 is marked "Proposed" with named
deciders including Gustave. If it's since been formally accepted, treat P2/P3
as decided and proceed. If not, **this is worth 30 minutes of discussion
before committing the highest-risk phase (P3: 3–5 weeks, "High" risk) to an
engine switch whose strongest justification disappears in P5.** Either way:
P0 and P1 are correct and valuable regardless of how this lands — do those
first without waiting for a DB decision.

---

## 🔴 P0 — Stop the bleeding (do this regardless of anything else)
- [ ] Strip CamPay app-key/secret/webhook-secret from
  `PaymentManagementService/.../application.yml` → env placeholders only.
- [ ] Strip Auth0 client-secret + live `WHATSAPP_ACCESS_TOKEN_LAUNDRY` from
  `spring-bot-manager-only/.../application.yaml` → env placeholders only.
- [ ] **Rotate** every leaked credential (CamPay, Auth0 M2M client, WhatsApp
  token) — placeholder swap alone does nothing if the old values still work.
- [ ] Purge from git history (BFG/`git filter-repo`), force-push, invalidate
  caches.
- [ ] Give `MachineStartService` (in PaymentManagementService) an Auth0 M2M
  client mirroring the bot's `MicroserviceClientConfig`; attach
  `Authorization: Bearer` to `/api/machines/start-cycle`.
- [ ] Make the bot's no-token `microserviceWebClientFallback` **fail-closed**
  (throw on missing M2M config) instead of silently sending unauthenticated
  requests.
- [ ] Add a secret manager (Doppler/Vault/platform env) wired into CI/CD.

**If you start a session and don't know whether P0 is done — ask first.**
Any work on P1+ that assumes secrets are rotated/auth is fixed is building on
sand until this is confirmed.

## Phase Overview (P1–P7) — see `03-MIGRATION-TODO.md` for full detail
| Phase | What | Depends on |
|---|---|---|
| P1 | API Gateway (Spring Cloud Gateway), Resilience4j on all hops, OpenTelemetry tracing, replace hardcoded `localhost` URLs | P0 |
| P2 | Provision MongoDB Atlas cluster (infra only, no cutover) — *see disagreement above* | P1 |
| P3 | Migrate each service Postgres→MongoDB via Mongock — *see disagreement above* | P2 |
| P4 | Outbox + Change Streams + idempotency for pay→start; remove sync `MachineStartService` call | P3 |
| P5 | Reporting BFF; dashboard finally sees new-service data; retire legacy monolith | P3, P4 |
| P6 | Dashboard → gateway, Auth0 OIDC/PKCE, unify `api.ts`/`lib.ts` | P1, P5 |
| P7 | Load/chaos testing, optional device-gateway split, Kafka/sharding if volume warrants | P6 |

---

## Repository Map
- `spring-bot-manager-only/` — WhatsApp chat layer. See its `CLAUDE.md`.
- `PaymentManagementService/` — mobile money + RFID. See its `CLAUDE.md`.
- `MachineStateService/` — machine lifecycle, MQTT/Modbus/EQLink, reservations.
  See its `CLAUDE.md`.
- `smart-laundry-dashboard/` — Next.js operator UI. See its `CLAUDE.md`.
- `architecture-review/` — `01-CURRENT-ARCHITECTURE.md`,
  `02-TARGET-ARCHITECTURE.md` (ADR-001), `03-MIGRATION-TODO.md`.
- `spring-bot-manager/` (legacy, no `-only`) — predecessor monolith, archive.
- `SmartLaundromatControlSystem/` — legacy Node/Express/MongoDB monolith,
  currently the real backend for the dashboard. **Scheduled for
  decommissioning in P5** — don't delete yet, it's load-bearing until then.
- `laundry-esp32/` — ESP32 firmware; MQTT/HTTP telemetry + feature-flagged
  Modbus RTU / EQLink to MachineStateService. Must keep working through the
  whole migration (explicit constraint in ADR-001).

## Global Conventions
- **English only** for supplier-facing communication.
- **Validate protocol/spec docs before committing money** on hardware orders.
- **No secrets in source** — currently violated (P0 item), don't add more.
- MQTT: dev `tcp://localhost:1883`; production must use `ssl://` + 8883 + auth.
- 80% of bot behavior config-driven JSON (`configs/bots/*.bot.json`).
- Architecture decisions → ADRs in Notion (`MultibotService > 📁 Documentation`)
  — note ADR-001 for this migration now lives in `architecture-review/`, not
  Notion; consider cross-linking.
- Currency: XAF. `longCycle.price` (bot/PMS) and `reservation.fee-amount`
  (MachineStateService) must match — no automated sync (P3/P4 modeling should
  consider fixing this as a side effect).

## Current Focus
- P0 (secrets + auth fix) — highest priority, low effort, do first.
- P1 (gateway) — second priority, directly fixes W1/W2 visibility problem
  without requiring a database decision.
- P2/P3 (MongoDB) — **flagged for discussion**, see disagreement section.
- Hardware: Alice supplier selected (XGQ washers/HG dryers, Modbus register
  4X1150). `ModbusWasherClient.java` likely belongs in MachineStateService's
  existing feature-flagged Modbus RTU gateway — independent of the
  P0–P7 migration, can proceed in parallel.

## How I Like to Work With Claude
- Be a technical co-architect — direct, rigorous, no rubber-stamping. Push
  back on weak reasoning, sunk-cost justifications, or scope creep.
- Max 3 best options with a clear recommendation and trade-offs.
- Best-practice, clean code, secure-by-default — flag security/reliability
  gaps proactively, especially anything touching P0 items.
- Default to working within the current phase of the migration plan; if asked
  to do something that's clearly a later phase (e.g. Mongo modeling while P0
  is open), say so.
- Terse confirms are fine (e.g. "Weiter" = continue).
- Notion tasks created progressively, not all upfront.
