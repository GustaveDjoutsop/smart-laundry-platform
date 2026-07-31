# PaymentManagementService

## What This Is
Owns **money movement and RFID balances** for the SmartLaundromatControlSystem.
Java 17 / Spring Boot 3.3.5, port 8081. OAuth2 resource server (Auth0 JWT).
H2 (dev) / PostgreSQL (prod).

**Sibling services:**
- `spring-bot-manager-only` (:8090) — calls `POST /api/payments/initiate`
- `MachineStateService` (:8082) — receives `POST /api/machines/start-cycle`
  from this service after successful payment (fire-and-forget)

## Current Status (updated after the payment-gateway hardening pass)
- **Phase 4 (reliable pay→start) is done**, not just planned — see
  `architecture-review/03-MIGRATION-TODO.md` Phase 4, marked ✅ Complete.
  `MachineStartService`'s old synchronous, unauthenticated call was **removed
  entirely**, not patched — the pay→start flow is now async via the
  `outbox` table (written in the same transaction as `SUCCESSFUL`) +
  `OutboxRelayService` (scheduled poll, retry/backoff, dead-letter) +
  `MicroserviceClientConfig` (Auth0 M2M, **fail-closed**: throws on every
  call if the client secret isn't configured, no silent unauthenticated
  fallback). See "Pay-then-Start Sequence" below for the actual flow.
- **CamPay is the only active payment provider.** MTN MoMo and Orange Money
  were removed (not signature-hardened) — see "Provider Abstraction" below
  for why and what that means for historical data.
- Flyway is in use (`db/migration/V1`...`V15`), not `ddl-auto: update` — the
  P3 schema-drift item this section used to flag is done.
- If you're picking up work here and unsure what's still open, check
  `architecture-review/03-MIGRATION-TODO.md` directly rather than trusting
  a stale summary — this section has been wrong before.

## Project Structure
```
config/      PaymentConfig (CamPay settings), WebClientConfig
controller/  RfidCardController, PaymentController, TopUpController, WebhookController
dto/         Request/response DTOs
model/       RfidCard, Transaction, TopUpTransaction, IdempotencyKey, PaymentEvent, enums
repository/  JPA repositories
service/
  RfidCardService                — balance, debit, credit
  PaymentService                 — payment orchestration
  TopUpService                   — card top-up orchestration
  PaymentTimeoutService          — scheduled, marks PENDING → TIMEOUT after 5 min
  IdempotencyKeyCleanupService   — scheduled, purges expired idempotency keys hourly
  provider/CampayService
```

## Provider Abstraction
**CamPay only.** MTN MoMo and Orange Money were removed — their webhook
endpoints had no signature verification (CamPay's does), and rather than
building that out for two providers not currently used in Cameroon, the
integrations were deleted outright (`MtnMomoService`/`OrangeMoneyService`
no longer exist).

`PaymentProvider.MTN` / `PaymentProvider.ORANGE_MONEY` (and the equivalent
`TopUpChannel` values) **still exist as enum constants** — deleting them
would break deserialization of historical transactions that used them
before removal. Requesting either at `POST /api/payments/initiate` or
`POST /api/topups` is rejected with `PROVIDER_DISABLED`; they only remain
valid values on `GET` responses for old data.

`PaymentProviderService` is still the abstraction point — `PaymentService`
and `WebhookController` stay provider-agnostic. **If a provider is ever
re-added**: implement the contract, register it in `resolveProvider()`
(`PaymentService`) and the equivalent switch in `TopUpService`, and give it
real webhook signature verification from day one — don't repeat the gap
that got MTN/Orange removed.

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
   (optionally `idempotencyKey` — see "Idempotency & Payment Ledger" below)
2. `PaymentService` inserts `Transaction(PENDING)`, calls CamPay's
   `requestPayment()`, returns `{reference, PENDING}` to bot immediately
3. CamPay sends async webhook → `WebhookController` (JWT-signature verified)
   → `PaymentService.processWebhook` marks the transaction `SUCCESSFUL` and,
   in the **same Postgres transaction**, writes a `PaymentSucceeded` row to
   the `outbox` table
4. `OutboxRelayService` (`@Scheduled(fixedDelay = 5000)`) polls unprocessed
   outbox rows and dispatches to MachineStateService's
   `POST /api/machines/start-cycle` via `MachineStartService`, with an
   Auth0 M2M Bearer token (`MicroserviceClientConfig` — fail-closed) and
   exponential-backoff retry, dead-lettering after `MAX_RETRIES`

This is Phase 4, done — not a plan. The old synchronous, unauthenticated
`MachineStartService` call this section used to describe (gated behind
`eqlink.auto-start-machine-after-payment`) was **removed**, not fixed in
place; that flag is now dead code (zero call sites). Don't build new
features assuming step 4 is a direct fire-and-forget HTTP call from
`processWebhook` — it isn't, the outbox is the only path.

Still open, deferred as explicit P4 follow-on items (see
`architecture-review/03-MIGRATION-TODO.md` Phase 4): saga/compensation on
permanent dead-letter (refund/staff alert), and a dead-letter monitoring
endpoint.

## Idempotency & Payment Ledger
Two gaps identified against a Stripe-style "bulletproof payment gateway"
design review (`smart-laundry-platform/architecture-review/06-PAYMENT-GATEWAY-DESIGN-REVIEW.md`)
were closed:

- **Idempotency key** (`V14__idempotency_keys_link_transaction.sql`):
  `PaymentInitiationRequest.idempotencyKey` is optional. If set,
  `PaymentService.initiatePayment` checks `idempotency_keys` first — a
  **sequential** retry (the common case: client resubmits after a timeout)
  returns the linked transaction's **current** state (not a frozen
  snapshot) instead of creating a duplicate payment or calling CamPay
  again. A **genuinely concurrent** retry (two requests with the same key
  in flight at once) instead gets a `IDEMPOTENCY_KEY_CONFLICT` error and
  must retry — the loser's transaction is rolled back, not left as an
  orphan row, and the recovery deliberately does not attempt to read the
  winner's row in the same DB transaction (a failed statement aborts the
  whole transaction on Postgres; any further read there would itself
  fail). Keys expire after 24h; `IdempotencyKeyCleanupService` purges
  expired rows hourly. Callers that omit the field get unchanged
  (non-idempotent) behavior — `spring-bot-manager-only` does not send one
  yet, this is capability-only until the bot is wired up.
- **`payment_events` ledger** (`V15__payment_events_ledger.sql`): an
  append-only table recording every `PaymentStatus` transition
  (PENDING/SUCCESSFUL/FAILED/TIMEOUT) a transaction goes through, written
  alongside — not instead of — the mutable `transactions.status` column.
  `transactions.status` stays the fast "current state" lookup;
  `payment_events` is the audit trail that never existed before. Not
  exposed via any endpoint yet — `PaymentEventRepository.findByExternalReferenceOrderByOccurredAtAsc`
  is scaffolding for a future timeline view.

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
| POST | `/api/webhook/campay` | Provider callback |

## Tech Stack
- Java 17, Spring Boot 3.3.5, Spring Data JPA, Lombok
- H2 (dev) / PostgreSQL (prod)
- Spring WebFlux `WebClient` for outbound HTTP (provider APIs, MSS call)
- OAuth2 resource server, Auth0 JWKS validation

## Critical Rules
- Provider secrets (`CAMPAY_*`) — env vars only, never committed.
  `CAMPAY_WEBHOOK_SECRET` used to verify webhook signatures — treat as
  critical, a forged webhook can mark a fake payment SUCCESSFUL.
- Webhook handlers must verify provider signatures before trusting payload.
  `/api/webhook/campay` does (JWT via `WebhookSignatureVerifier`). If a
  provider is ever re-added, its webhook must have real signature
  verification from the first commit — CamPay is the only endpoint left
  precisely because MTN/Orange never got this and were removed instead.
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
