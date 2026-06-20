# PaymentManagementService

## What This Is
Owns **money movement and RFID balances** for the SmartLaundromatControlSystem.
Java 17 / Spring Boot 3.3.5, port 8081. OAuth2 resource server (Auth0 JWT).
H2 (dev) / PostgreSQL (prod).

**Sibling services:**
- `spring-bot-manager-only` (:8090) — calls `POST /api/payments/initiate`
- `MachineStateService` (:8082) — receives `POST /api/machines/start-cycle`
  from this service after successful payment (fire-and-forget)

## 🔴 Open from architecture review (2026-06-13)
- **Migration plan** — see root `CLAUDE.md` and
  `architecture-review/03-MIGRATION-TODO.md`. P0 items affecting this repo:
  strip CamPay app-key/secret/webhook-secret from `application.yml` to env
  placeholders, rotate all three. Give `MachineStartService` an Auth0 M2M
  client (mirror bot's `MicroserviceClientConfig`) and attach
  `Authorization: Bearer` to the `start-cycle` call — this is the W4 fix and
  is **load-bearing for P4** (can't build reliable outbox/events on top of a
  call that 401s if enabled).
- **The call to MachineStateService's `start-cycle` uses plain `RestTemplate`
  with NO Authorization header**, against an endpoint protected by
  `SCOPE_sls-machine-start`. Masked today because
  `eqlink.auto-start-machine-after-payment` defaults to `false`. Fix per P0
  above before this flag is ever set `true`.
- This service uses `ddl-auto: update` (Hibernate), not Flyway —
  `paymentdb` schema drift risk. **P3 fixes this**: introduce Flyway
  baseline migrations matching the current schema, set `ddl-auto: validate`,
  retarget at the Supabase `payment` schema.
- `paymentdb` is **not** read by `smart-laundry-dashboard` until P5
  (Reporting BFF) — transactions here are operator-invisible until then.
- **Target (ADR-001 as revised, A4)**: `paymentdb` → `payment` schema on the
  shared Supabase project (P3) — `transactions`, `rfid_cards`, `topups`
  carry over largely as-is via `pg_dump`/`pg_restore`, plus new `outbox` and
  `idempotency_keys` tables added in P3 as prep for P4. Debit + transaction
  insert stays a normal multi-table `@Transactional` — **no JPA/entity
  changes needed**, this is genuinely just "same Postgres, different host
  and schema." **P4's outbox pattern is the actual fix for the W4/W5
  reliability gap**: `outbox` table written in the same transaction as
  `SUCCESSFUL`, relayed via Supabase Realtime "Postgres Changes" or
  `pg_notify`, consumed idempotently by MachineStateService. Once P4 lands,
  `MachineStartService`'s synchronous call is removed entirely. Don't build
  new features on top of the current synchronous call expecting it to
  survive P4 unchanged.
- The relational nature of this service's data (`transactions` →
  `rfid_cards`/`machines` FKs) is exactly why A4 (Postgres) was chosen over
  the original A2 (MongoDB) — this service was the weakest fit for a
  document model and the strongest argument for staying relational. No
  further action needed here, just context for why the engine didn't change.

## Project Structure
```
config/      PaymentConfig (CamPay/MTN/Orange settings), WebClientConfig
controller/  RfidCardController, PaymentController, TopUpController, WebhookController
dto/         Request/response DTOs
model/       RfidCard, Transaction, TopUpTransaction, enums
repository/  JPA repositories
service/
  RfidCardService        — balance, debit, credit
  PaymentService         — payment orchestration
  TopUpService           — card top-up orchestration
  PaymentTimeoutService  — scheduled, marks PENDING → TIMEOUT after 5 min
  provider/CampayService, MtnMomoService, OrangeMoneyService
```

## Provider Abstraction
`PaymentProviderService` picks the configured provider at runtime
(`campay`/`mtn`/`orange`). All providers implement the same collect/verify
contract — `PaymentService` and `WebhookController` stay provider-agnostic.
**When adding a 4th provider**: implement the same contract, register in
`PaymentProviderService`'s switch — don't special-case it in `PaymentService`.

## Transaction State Machine
```
[*] → PENDING (initiate)
PENDING → SUCCESSFUL (webhook success)
PENDING → FAILED (webhook failure / provider reject)
PENDING → TIMEOUT (PaymentTimeoutService, no webhook within timeout window)
```
Timeout window = `payment.timeout-minutes` (default 5).

## Pay-then-Start Sequence (the critical cross-service flow)
1. Bot → `POST /api/payments/initiate {amount, phone, machineId, ref}`
2. `PaymentService` inserts `Transaction(PENDING)`, calls provider `collect()`,
   returns `{reference, PENDING}` to bot immediately
3. Provider sends async webhook → `WebhookController` → `PaymentService`
   marks transaction `SUCCESSFUL`
4. **If `eqlink.auto-start-machine-after-payment = true`**:
   `MachineStartService.notifyMachineStart()` → `POST /api/machines/start-cycle`
   on MachineStateService — **fire-and-forget**

### ⚠️ Known reliability gap — now has a plan (P4), don't reinvent it
Step 4 swallows errors by design, with no documented fallback. **This is
W5, and ADR-001/P4 has already chosen the fix**: Transactional Outbox —
write a `PaymentSucceeded` row to an `outbox` table in the same Postgres
transaction as marking `SUCCESSFUL` (native multi-table ACID, no special
infrastructure), relay via Supabase Realtime "Postgres Changes" or a
`pg_notify` trigger, MachineStateService consumes idempotently keyed on
`transactionReference`. On permanent failure, emit `MachineStartFailed` for
refund/staff alert (Saga compensation).

**If asked to "improve payment reliability" before P3 (Supabase
consolidation) has landed**: don't build a parallel ad-hoc retry mechanism —
that's exactly the kind of one-off fix P4 is meant to replace. The interim
fix is the P0 auth fix above (so the call at least has a chance of
succeeding); full reliability is P4's job. Note that since P4 is "just"
Postgres tables + `pg_notify`/Realtime, **P4 could in principle be built
against the current `paymentdb` before P3 completes** if business urgency
demands it — the outbox table doesn't care which Postgres instance it's in.
If that reordering is wanted, say so explicitly; the default sequencing is
P3 first for simplicity (build new patterns once, on the final infra).

## RFID Flow
```
ESP32 reads card UID
→ GET /api/rfid/balance/{cardUid}?requiredAmount=1500
  → { balance, sufficient, message }
→ customer selects program
→ POST /api/rfid/debit {cardUid, amount, machineId, pulseCount, cycleDuration}
  → debits card, creates SUCCESSFUL transaction
→ ESP32 sends START signal directly (this path does NOT go through
  MachineStateService's start-cycle — verify this is intentional vs. a gap
  vs. the WhatsApp/payment path which does route through MSS)
```
**Note the asymmetry**: RFID path → ESP32 starts machine directly; mobile
money path → PaymentManagementService calls MachineStateService. Two
different "how does the machine actually start" mechanisms for two payment
methods. If reconciling machine state (MachineStateService's view) with
actual hardware state, remember RFID-path starts may not be visible to MSS
unless ESP32 also reports telemetry independently (it does, via MQTT/HTTP
telemetry — but that's *status*, not the *start command* MSS issued).

## Top-Up Flow
`POST /api/topups {cardUid, amount, phone}` → provider collect → webhook
success → `RfidCardService` credits balance. Subsequent washes can be paid
from RFID balance instead of fresh mobile-money collection.

## API Reference
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/rfid/register` | Register RFID card |
| GET | `/api/rfid/balance/{cardUid}?requiredAmount=N` | Balance check (ESP32 calls this) |
| POST | `/api/rfid/debit` | Debit card, create transaction |
| GET/PATCH | `/api/rfid/cards...` | List/get/activate/deactivate |
| POST | `/api/payments/initiate` | Initiate mobile money payment |
| GET | `/api/payments/transaction/{reference}` | Get transaction |
| GET | `/api/payments/machine/{machineId}` / `/card/{cardUid}` | Filtered transactions |
| GET | `/api/payments/providers/status` | Provider config status |
| POST | `/api/topup` | Top-up (mobile money or cash) |
| GET | `/api/topup/history/{cardUid}` | Top-up history |
| POST | `/api/webhook/{campay,mtn,orange}` | Provider callbacks |

## Tech Stack
- Java 17, Spring Boot 3.3.5, Spring Data JPA, Lombok
- H2 (dev) / PostgreSQL (prod)
- Spring WebFlux `WebClient` for outbound HTTP (provider APIs, MSS call)
- OAuth2 resource server, Auth0 JWKS validation

## Critical Rules
- Provider secrets (`CAMPAY_*`, `MTN_*`, `ORANGE_*`) — env vars only, never
  committed. `CAMPAY_WEBHOOK_SECRET` used to verify webhook signatures —
  treat as critical, a forged webhook can mark a fake payment SUCCESSFUL.
- Webhook handlers must verify provider signatures before trusting payload —
  check each provider's webhook controller does this; don't assume.
- `payment.pricing.short-cycle` / `long-cycle` (1000/2000 XAF) must stay in
  sync with `spring-bot-manager-only`'s `shortCycle.price`/`longCycle.price`
  and MachineStateService's `reservation.fee-amount`. No automated sync —
  changing one without the others is a likely source of "price mismatch" bugs.
- `PaymentTimeoutService` runs on a schedule — if transactions are getting
  stuck in PENDING longer than expected, check this service is actually
  running (not just configured) and the timeout value.

## Local Dev
```bash
mvn spring-boot:run                    # H2, port 8081, console at /h2-console
```
PostgreSQL: set `SPRING_DATASOURCE_URL`, `_USERNAME`, `_PASSWORD` env vars.
