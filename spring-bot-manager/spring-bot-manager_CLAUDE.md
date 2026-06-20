# spring-bot-manager

## What This Is
Multi-tenant WhatsApp bot backend powering the Smart Bot Platform. The
**LaundryBot is in production and must never be broken.** All other bots
(pharmacy, healthcare, etc.) are future tenants on the same platform.

## Tech Stack
- Java 17 (target: upgrade to Java 21), Spring Boot 3.2.2 (target: 3.3.7)
- PostgreSQL + Flyway (planned — currently Redis-only, see gaps below)
- Redis — primary store for active conversation state (`conv:{botId}:{phone}`)
- MQTT — machine control commands; **must use TLS (`ssl://` port 8883)**,
  never plain `tcp://` 1883 (Heroku terminates SSL for HTTP/Redis/Postgres but
  not for MQTT — this is the one exception requiring app-level TLS)
- Deployment: Heroku (decision made — do not reintroduce/maintain K8s/Helm
  in parallel unless a client explicitly requires it)
- CI/CD: GitHub Actions (`.github/workflows/ci.yml`) — build, test, lint,
  OWASP, Docker

## Architecture — Patterns That Are Correct, Do Not "Fix"
- `phone_number_id` routing for multi-bot isolation
  (`WhatsAppWebhookController.extractPhoneNumberId()`)
- Redis key prefixing per bot/phone for state isolation
- `WhatsAppSignatureVerifier.verify()` — constant-time comparison via
  `MessageDigest.isEqual()`
- Idempotency via Redis SETNX (`lock:{botId}:{from}:{messageId}`)
- Per-bot error isolation in `MessageProcessor.processMessage()`
- `TokenBucket`-based per-IP/per-endpoint rate limiting
- `GlobalExceptionHandler` — no stack traces to clients
- `TranslationService` / `Language` enum for i18n
- `TemplateRenderer` (Mustache) for message templates
- `FlowEngine` JSON-driven state machine (`FlowState`, `FlowPlugin`,
  `FlowContext`) — this is a platform differentiator, preserve it
- `WhatsAppClientFactory.clientCache` (ConcurrentHashMap)
- `PaymentEventPublisher` via Spring events
- `LogRedactor` for PII in logs
- Non-root Docker user (`appuser:appgroup`), `/actuator/health` healthcheck

## Active Refactoring — feature/persistence-admin-api-security
9 remaining tasks per `AGENT_CONTINUATION_INSTRUCTIONS.md`. Execution order
(from gap analysis, do NOT reorder or batch):

1. Upgrade to Java 21 + Spring Boot 3.3.7 — update pom.xml, Dockerfile, CI;
   fix any breakage
2. Security defaults: `whatsapp.verify-signature=true` by default (only
   `false` in `application-local.properties`); move `verifyToken` out of
   committed JSON configs into env vars `VERIFY_TOKEN_{BOT_ID}`
3. Add PostgreSQL + Flyway — V1 migration, JPA entities/repos, persist
   `PaymentStore` to DB, message logging, `docker-compose.yml` w/ Postgres
   for local dev
4. Clean `BotConfig` — strip laundry-specific fields (`machines`, `programs`,
   `MqttConfig`) out of the shared core class; keep them in
   `LaundryBotConfig`
5. Convert to Maven multi-module — module boundaries enforced at compile time
6. Refactor `BotRegistry` to Spring auto-discovery — delete `BotType` enum,
   bots become `@Component` + `@ConditionalOnProperty`, inject `List<Bot>`
7. Replace `QueueManager`/`new Thread(...)` with Spring `@Async` +
   `ThreadPoolTaskExecutor`
8. Add Testcontainers (Postgres + Redis) integration tests — webhook
   end-to-end, payment flow, multi-bot routing, Flyway migrations
9. `bot-pharmacy` module — new Maven module, `PharmacyBot`, flow plugin,
   `pharmacy_products`/`pharmacy_reservations` tables, integration tests

**Rules while executing these:**
- One commit per step, run existing tests after each step
- No new features mixed into structural steps
- Preserve `FlowEngine` as-is
- Redis stays for active state; Postgres is the audit/persistence layer
  (dual-write)
- Don't over-engineer: no K8s on Heroku, no message broker if `@Async` works,
  no Redis Cluster for single-instance load

## Critical Rules
- Never break the LaundryBot — it's live.
- All secrets via env vars / encrypted admin-managed storage. Hot-reload via
  `POST /admin/bots/refresh` with AES-256-GCM encrypted token storage — not
  GitHub Secrets (needs redeploy), not a React admin UI (premature at this
  scale).
- New bot types must not require core changes beyond auto-discovery
  registration — that's the whole point of the plugin architecture.
- Bot behavior config (flows, templates, business rules) goes in JSON, not
  Java, wherever possible.

## Hardware Integration Context (for ModbusWasherClient.java work)
- Supplier: Alice (XGQ washer / HG dryer series). Modbus map doc:
  `SX174003A` (washers, confirmed). Dryer doc `SX274003A` pending.
- Comms: 9600 8N1, RS485
- Write registers 4X1145–4X1152 (reset/start/stop/program/coin), read
  register 5X1165 (20-field status block)
- Start sequence: write 4X1150 (program) → write 4X1149 (coin credits) →
  write 4X1146 (start)
- Open question: value to write to 4X1149 in non-coin mode (WhatsApp-bot
  triggered start, not coin-operated)
- This client can and should be built/tested now against the confirmed
  register map — don't block on hardware delivery (~50 days)
