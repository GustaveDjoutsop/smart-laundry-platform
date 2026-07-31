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
- `02-TARGET-ARCHITECTURE.md` — ADR-001, gateway + outbox + **Supabase
  Postgres (A4, revised from original A2/MongoDB)**
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

### Target topology (per ADR-001 as revised, status: Proposed/Accepted — A4)
API Gateway (Spring Cloud Gateway) as single entry point → 3 services +
Reporting BFF + new `OperationsService` (for users/timekeeping/absences/
feedback). All persistence consolidates onto **one managed Supabase
PostgreSQL project**, schema-per-service (`bot`, `payment`, `machine`, `ops`
schemas, each with a least-privilege role). TimescaleDB-style range
partitioning for `machine_events`/`telemetry`. Pay→start becomes
event-driven via Outbox (Postgres table) + Supabase Realtime "Postgres
Changes" (or `pg_notify`) + idempotency, breaking the Payment↔Machine sync
dependency. Dashboard moves to Auth0 + gateway, single API client.

**Decision A (persistence engine) was revised from A2 (MongoDB Atlas) to A4
(Supabase Postgres, schema-per-service)** — see `02-TARGET-ARCHITECTURE.md`
and `03-MIGRATION-TODO.md` for the updated rationale. This consolidation is
lower-risk and lower-effort than the original Mongo rewrite (P3 effort
dropped from 3–5 weeks to 1–2 weeks) because JPA entities/repositories carry
over largely unchanged — it's a consolidation, not a data-model rewrite.

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
- [x] ~~Give `MachineStartService` an Auth0 M2M client; attach `Authorization:
  Bearer` to `/api/machines/start-cycle`~~ — moot: Phase 4 removed that
  synchronous call entirely rather than patching it. Pay→start is now async
  via the `outbox` table + `OutboxRelayService`, which already carries
  fail-closed M2M auth (`MicroserviceClientConfig`, throws if unconfigured —
  see `PaymentManagementService/PaymentManagementService_CLAUDE.md`).
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
| P2 | Provision Supabase Postgres project (`smartlaundry-prod`), schemas + least-privilege roles, Supavisor pooler, backups/PITR | P1 |
| P3 | Consolidate each service's existing Postgres → Supabase schema (`bot`/`payment`/`machine`); standardize on Flyway everywhere | P2 |
| P4 | Outbox table + Supabase Realtime/`pg_notify` + idempotency for pay→start; remove sync `MachineStartService` call | P3 |
| P5 | Reporting BFF (SQL views/queries against consolidated schemas); dashboard finally sees new-service data; retire legacy monolith | P3, P4 |
| P6 | Dashboard → gateway, Auth0 OIDC/PKCE, unify `api.ts`/`lib.ts` | P1, P5 |
| P7 | Load/chaos testing, optional device-gateway split, Kafka/sharding/read-replica if volume warrants | P6 |

---

## Repository Map
- `spring-bot-manager-only/` — WhatsApp chat layer. See its `CLAUDE.md`.
- `PaymentManagementService/` — mobile money + RFID. See its `CLAUDE.md`.
- `MachineStateService/` — machine lifecycle, MQTT/Modbus/EQLink, reservations.
  See its `CLAUDE.md`.
- `smart-laundry-dashboard/` — Next.js operator UI. See its `CLAUDE.md`.
- `architecture-review/` — `01-CURRENT-ARCHITECTURE.md`,
  `02-TARGET-ARCHITECTURE.md` (ADR-001), `03-MIGRATION-TODO.md`.
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
- P1 (gateway) — second priority, directly fixes W1/W2 visibility problem.
- P2/P3 (Supabase consolidation) — decided (A4), lower-risk than originally
  scoped; proceed after P0/P1.
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
  to do something that's clearly a later phase (e.g. building the Reporting
  BFF while P0 is open), say so.
- Terse confirms are fine (e.g. "Weiter" = continue).
- Notion tasks created progressively, not all upfront.

## Git & PR Workflow (always follow)
- **Never push directly to `master`/`develop`.** All work goes on its own
  branch (`bugfix/...` or `feature/...` per the bug-vs-feature convention
  below) and gets its own pull request for review — no exceptions.
- **Before every commit, have a subagent do a code review of the diff first**
  (spawn a review subagent / use the code-review skill), and address what it
  finds before committing.
- **After pushing any new commit to an open PR, always check that PR for new
  review comments** (e.g. Copilot's automated review, human reviewers) —
  `gh api repos/<owner>/<repo>/pulls/<n>/reviews` and `.../comments` — and
  address them before considering that push done. Don't wait to be asked.
