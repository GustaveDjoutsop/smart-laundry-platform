# spring-bot-manager-only

## What This Is
The **WhatsApp chat layer** of the 3-service SmartLaundromatControlSystem.
Modular monolith (Maven multi-module), Java 21 / Spring Boot 3.3.7, port 8090.
Owns conversation flows, WhatsApp Cloud API integration, and the FlowEngine —
delegates payment and machine-state concerns to other services via HTTP.

**Sibling services it talks to:**
- `PaymentManagementService` (:8081) — `PAYMENT_SERVICE_URL`
- `MachineStateService` (:8082) — `MACHINE_STATE_SERVICE_URL`

## 🔴 Open from architecture review (2026-06-13)
- **Migration plan exists** — see root `CLAUDE.md` and
  `architecture-review/03-MIGRATION-TODO.md`. P0 items affecting this repo:
  strip Auth0 client-secret + live `WHATSAPP_ACCESS_TOKEN_LAUNDRY` from
  `application.yaml`, rotate both, make `microserviceWebClientFallback`
  fail-closed instead of sending unauthenticated requests.
- Outbound calls to Payment/Machine use `microserviceWebClient` with Auth0
  **M2M `client_credentials`** (scopes `sls-machine-start`,
  `sls-payment-initiate`), via `.block()` (synchronous) — and on the Machine
  side, **write-path exceptions are swallowed**. If a feature depends on a
  write to MachineStateService actually succeeding, don't assume the current
  error handling will surface a failure to the user. P4 (outbox/events) is
  meant to fix this properly, but until then this is the reality.
- This service uses **Flyway** — currently the only one of the three that
  does. Don't let new entities slip into `ddl-auto: update`-style "let
  Hibernate handle it." (P3, if it proceeds, replaces Flyway with Mongock
  here — see target note below.)
- `smart-laundry-dashboard` does **not** read from this service's DB
  (`smartbot`, port 15432) — it talks to the legacy Mongo monolith (W1,
  fixed in P5). Any bot-side data is currently operator-invisible.
- **Target (ADR-001, Proposed)**: this service migrates `smartbot`
  Postgres → `bot_db` on MongoDB Atlas via Spring Data MongoDB + Mongock
  (P3), conversation/flow state model unchanged, Redis stays as hot cache.
  **Don't start this migration ahead of P0–P2** — there's an open question
  about whether P3 is the right call at all (see root CLAUDE.md "Open
  Disagreement"); if asked to do Mongo modeling here, surface that first.

## Module Structure
```
bot-core/      Flow engine, WhatsApp client, Redis, persistence, MQTT manager
bot-payment/   PaymentGateway interface + DefaultPaymentGateway (HTTP delegate to PaymentManagementService)
               PaymentsController (webhook forwarder), MicroserviceProperties
bot-laundry/   LaundryBot, LaundryFlowPlugin, MachineService (HTTP delegate to MachineStateService)
               MachinesController
bot-pharmacy/  Pharmacy bot (separate domain — scaffolded, not yet implemented)
bot-app/       Spring Boot entry point, security, JWT, AppConfig
```

**Dependency rule (enforced via module poms):** `bot-laundry` and `bot-pharmacy`
depend on `bot-core` only — never on each other or directly on `bot-payment`'s
provider internals. `bot-app` assembles everything.

## Refactor History — What Changed From `spring-bot-manager`
| Component | Before | After |
|---|---|---|
| `DefaultPaymentGateway` | Called CamPay/MTN APIs directly | HTTP POST to PaymentManagementService |
| `MachineService` | Published MQTT, read Redis | HTTP calls to MachineStateService |
| `PaymentsController` | Handled webhooks locally | Forwards to PaymentManagementService |
| `MachinesController` | Read local Redis store | Proxies MachineStateService |
| `CamPayProvider`, `MtnMomoProvider`, `PaymentProvider` | Local impls | **Deleted** — moved to PaymentManagementService |

`LaundryFlowPlugin`, `LaundryBot`, `FlowEngine` are **unchanged** — same
interfaces, different implementations behind them. If something behaves
differently post-split, suspect the HTTP delegate, not the flow logic.

## Conversation State Machine
```
language_selection → main_menu
main_menu → show_services / show_availability / show_user_status / WashGate

WashGate (choice):
  washFlowEnabled = false → wash_flow_disabled (info only, back to main_menu)
  washFlowEnabled = true  → machine_method_selection → cycle_selection
                          → initiate_payment → main_menu
```

### Feature flags (`configs/bots/laundry.bot.json` → `features`)
| Flag | Default | Effect when `false` |
|---|---|---|
| `washFlowEnabled` | `false` | Only availability/services/status visible. Enforced in `LaundryFlowPlugin.handleStartWashFlow` → short-circuits to `handleWashFlowDisabled`. |
| `reservationEnabled` | `false` | Reservation entry point hidden. Mechanism itself lives in MachineStateService. |

**Before debugging "wash flow doesn't work" — check this flag first.** It's
the most likely cause of "nothing happens" in a fresh environment.

## Reservation Flow (mechanism in MachineStateService, UI here)
- Reservation = `POST /api/reservations` on MachineStateService → returns
  `RES-XXXXXX` code + fee + 1-hour slot (slot length is fixed, not configurable)
- Fee payment goes through PaymentManagementService; on webhook success MSS
  activates the reservation (PENDING → ACTIVE)
- **Authorization is by code + machine, not by user** — whoever has the code
  for that machine can start it within the slot. This is a deliberate design
  choice (simple, WhatsApp-shareable) but means codes are bearer tokens —
  don't log them in plaintext, treat like a one-time password.

## Configuration Sync — Manual, No Automation
- `longCycle.price` (2000 XAF, here) must match `reservation.fee-amount`
  (MachineStateService). If you change one, change both. There's no shared
  config source — this is a known gap.

## API Endpoints
| Method | Endpoint | Description |
|---|---|---|
| GET/POST | `/api/whatsapp/webhook` | Meta webhook verify / inbound messages |
| POST | `/api/payments/webhooks/{campay,mtn,orange}/{botId}` | Forwarded to PaymentManagementService |
| GET | `/api/payments/{botId}/transactions/{transactionId}` | Retrieve transaction |
| GET | `/api/machines/{botId}` / `/{botId}/{machineId}` / `/{botId}/available` | Proxied from MachineStateService |
| GET | `/api/health` | Health check |

## Tech Stack
- Java 21, Spring Boot 3.3.7, Maven multi-module
- Redis (state, with in-memory fallback), PostgreSQL + Flyway (persistence)
- Spring `RestTemplate` for inter-service HTTP, Mustache templates, Lombok
- i18n: EN/FR via `TranslationService` in `bot-core`
- Webhook signature verification: HMAC-SHA256

## Critical Rules
- `washFlowEnabled`/`reservationEnabled` checks live in `LaundryFlowPlugin` —
  if you add a new entry point to the wash/reservation flow, gate it the
  same way, don't bypass.
- Never reintroduce payment-provider or MQTT logic into this service — that's
  the entire point of the split. If you find yourself adding a CamPay client
  here, stop and route through PaymentManagementService instead.
- `PAYMENT_SERVICE_URL` / `MACHINE_STATE_SERVICE_URL` are required env vars —
  this service is non-functional standalone for any payment/machine feature.
- Per-bot secrets: `WHATSAPP_ACCESS_TOKEN_<BOTID>`, `WHATSAPP_APP_SECRET_<BOTID>`,
  `CAMPAY_WEBHOOK_SECRET_<BOTID>` — never commit, env vars / K8s secrets only.
- `JWT_SECRET` min 32 chars.

## Local Dev — Full Stack
```bash
# Terminal 1
cd PaymentManagementService && mvn spring-boot:run
# Terminal 2
cd MachineStateService && mvn spring-boot:run
# Terminal 3
cd spring-bot-manager-only && mvn spring-boot:run -pl bot-app -am
```
