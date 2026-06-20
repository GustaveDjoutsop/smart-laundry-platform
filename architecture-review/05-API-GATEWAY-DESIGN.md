# API Gateway Design (P1, item 1)

**Date:** 2026-06-13
**Status:** Implemented (2026-06-14) — see `api-gateway/` and
`03-MIGRATION-TODO.md` Phase 1 for build/test details.
**Scope:** This covers only the **gateway module itself** — routing, JWT
validation, CORS, correlation-ID propagation, rate limiting, and the config
needed to stand it up. The other P1 items (Resilience4j on the 3 services'
inter-service hops, replacing hardcoded `localhost` URLs *inside* those
services, and end-to-end OpenTelemetry tracing) are separate, follow-up
pieces of work and are referenced here only where the gateway needs to be
built so they slot in cleanly later.

---

## 1. Goals

- Single entry point for the dashboard (and, later, the Reporting BFF) at a
  new port (proposed: **8080**).
- Centralize Auth0 JWT validation, CORS, rate limiting, correlation-ID
  injection — per ADR-001 Decision C.
- **Non-breaking**: existing direct access on :8090/:8081/:8082 keeps working
  during rollout; nothing in the 3 services changes on day one.
- Reuse the Auth0 config/validator pattern that already exists and works in
  `spring-bot-manager-only` rather than inventing a new one.

---

## 2. Module layout

New standalone Maven project, sibling to the existing services:

```
C:\Users\sunda\Codierung\api-gateway\
  pom.xml
  src/main/java/com/smartlaundry/gateway/
    GatewayApplication.java
    config/SecurityConfig.java        (reactive JWT + permitAll routes)
    config/CorsConfig.java            (global CORS)
    config/AudienceValidator.java     (ported from bot-app, reactive)
    filter/CorrelationIdFilter.java   (GlobalFilter)
  src/main/resources/
    application.yml
    application-local.yaml
```

**Why standalone (not a 6th module under `spring-bot-manager-only`'s
aggregator pom):** Spring Cloud Gateway requires **WebFlux** (reactive), but
`spring-bot-manager-only` and its siblings are all **Spring MVC**
(servlet/blocking). Mixing reactive and servlet starters in one
dependency tree causes auto-configuration conflicts. A separate Boot
project avoids that entirely and matches how PaymentManagementService /
MachineStateService are already independent Maven projects.

**Versions:** Spring Boot `3.5.14` (match the rest of the fleet), Java `25`.
Spring Cloud release train must be the one compatible with Boot 3.5.x
(verify exact BOM version at implementation time — likely `2025.0.x`).
Dependencies: `spring-cloud-starter-gateway`,
`spring-boot-starter-oauth2-resource-server`,
`spring-boot-starter-data-redis-reactive` (rate limiter), `lombok`.

---

## 3. Routing table

Matches the prefixes already named in ADR-001's target topology
(`/bot/**`, `/payments/**`, `/machines/**`). All three backends mount their
controllers at `/api/<resource>` with **no per-service prefix**
(`/api/machines` exists in *both* MachineStateService and the bot's
`bot-laundry` module, `/api/payments` in both PaymentManagementService and
the bot's `bot-payment` module) — so the gateway prefix is what
disambiguates, and `StripPrefix=1` removes it again before forwarding:

| Gateway path | StripPrefix | Forwards to | Backend sees |
|---|---|---|---|
| `/bot/**` | 1 | `${BOT_SERVICE_URL:http://localhost:8090}` | `/api/...` (bot-manager) |
| `/payments/**` | 1 | `${PAYMENT_SERVICE_URL:http://localhost:8081}` | `/api/...` (PaymentManagementService) |
| `/machines/**` | 1 | `${MACHINE_SERVICE_URL:http://localhost:8082}` | `/api/...` (MachineStateService) |

`/reports/**` (Reporting BFF) is reserved but not routed yet — added in P5.

Each backend URI comes from an env var with the current `localhost` value as
default. This is the gateway's own piece of "replace hardcoded localhost" —
the *other* P1 item (the 3 services' inter-service `RestTemplate`/`WebClient`
base URLs) is unchanged by this design and stays a separate task.

Example `application.yml` route block:

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: bot-manager
          uri: ${BOT_SERVICE_URL:http://localhost:8090}
          predicates:
            - Path=/bot/**
          filters:
            - StripPrefix=1
        - id: payment-service
          uri: ${PAYMENT_SERVICE_URL:http://localhost:8081}
          predicates:
            - Path=/payments/**
          filters:
            - StripPrefix=1
        - id: machine-service
          uri: ${MACHINE_SERVICE_URL:http://localhost:8082}
          predicates:
            - Path=/machines/**
          filters:
            - StripPrefix=1
```

---

## 4. Security (JWT validation)

Port the existing `spring-bot-manager-only` pattern
(`bot-app/.../config/SecurityConfig.java` +
`bot-app/.../auth/AudienceValidator.java`) to the reactive equivalents:

- `ReactiveJwtDecoder` via `NimbusReactiveJwtDecoder.withIssuerLocation(...)`
- Same issuer/audience:
  ```yaml
  spring.security.oauth2.resourceserver.jwt:
    issuer-uri: https://dev-iuo6si32jobgnmod.eu.auth0.com/
    audience: https://smartlaundry.api
  ```
- `AudienceValidator` ported as-is (claim-matching logic is
  decoder-implementation-agnostic).
- `ServerHttpSecurity` filter chain, `permitAll` for:
  - `POST /payments/api/webhook/**` — CamPay calls this directly, unauthenticated
    by design (signature-verified inside PaymentManagementService)

    > **Security note — signature header must survive the hop.** `permitAll`
    > at the gateway means PaymentManagementService's HMAC signature check
    > (`X-Campay-Signature` header, `WebhookController.java:38`, and the
    > equivalent for MTN/Orange once added) is the **only** thing standing
    > between this route and an unauthenticated attacker. Two failure modes
    > to rule out explicitly during implementation, not assume away:
    > 1. **Gateway strips the header** — Spring Cloud Gateway forwards
    >    request headers by default, but this must be verified with an
    >    integration test that sends a real `X-Campay-Signature` value
    >    through the gateway and asserts PaymentManagementService receives
    >    it unchanged (not just "the route returns 200"). If any global
    >    filter, header-rewrite rule, or future `RemoveRequestHeader` /
    >    sanitization filter is added to this route, it must explicitly
    >    allow-list signature headers.
    > 2. **Signature check is silently bypassed downstream** — if the
    >    header is missing/empty, `WebhookController` must **reject** the
    >    request (not treat a missing signature as "skip verification").
    >    Confirm this is the current behavior before relying on
    >    `permitAll` at the gateway; if it isn't, fix it as part of this
    >    change, since `permitAll` + a fail-open signature check = an open
    >    payment-webhook endpoint.
  - `/actuator/health`, `/actuator/info`
  - `/*/swagger-ui/**`, `/*/v3/api-docs/**` (dev convenience, gate behind
    profile if needed)
- Everything else: `authenticated()` — **coarse-grained only**. Fine-grained
  scope checks (`SCOPE_sls-payment-read` etc.) stay in each backend service
  as defense-in-depth; the gateway does not duplicate that authorization
  matrix.
- **Token pass-through**: the gateway validates the JWT and forwards the
  original `Authorization: Bearer` header unchanged to the backend. Backends
  keep validating it themselves (cheap — JWKS is cached). This means **zero
  code changes** are required in the 3 services for this phase. Removing the
  backend-side validation (if ever) is a separate, later decision — not part
  of this design.

---

## 5. CORS

Centralize at the gateway via `spring.cloud.gateway.globalcors`, reusing the
existing env var name and default:

```yaml
spring:
  cloud:
    gateway:
      globalcors:
        cors-configurations:
          '[/**]':
            allowedOrigins: ${CORS_ALLOWED_ORIGINS:http://localhost:3000}
            allowedMethods: [GET, POST, PUT, PATCH, DELETE, OPTIONS]
            allowedHeaders: '*'
            allowCredentials: true
            maxAge: 3600
```

**Backend CORS configs are left in place for now.** They become redundant
once the dashboard exclusively calls the gateway (P6), but removing them
prematurely would break any direct-port access still in use during rollout.
Track removal as a P6 cleanup item.

---

## 6. Correlation ID

A `GlobalFilter` (`CorrelationIdFilter`, high precedence — runs first):

- If incoming request has `X-Correlation-Id`, keep it; else generate a UUIDv4.
- Add/overwrite the header on the **outbound** request to the backend.
- Add the same header to the **response** sent back to the caller.

This gives every request a correlation ID at the front door regardless of
whether the caller sets one. Backends picking it up into their logging MDC
(structured JSON logs) is part of the separate OpenTelemetry/tracing P1 item
— this filter just guarantees the ID exists and is propagated.

---

## 7. Rate limiting

Replace the bot's in-app per-IP token bucket
(`spring-bot-manager-only/bot-core/.../middleware/RateLimitFilter.java`) with
Spring Cloud Gateway's built-in `RequestRateLimiter` backed by Redis (Redis
is already a running dependency for the bot service, per
`docker-compose.yml`).

- Key resolver: JWT `sub` claim when present (per-user), fall back to client
  IP (via `X-Forwarded-For`, matching the existing detection logic) for
  unauthenticated requests.
- Initial limits: mirror the current values as a starting point —
  `whatsapp`/general: 120 req/min, `payments`: 120 req/min — tune per-route
  via `RedisRateLimiter` `replenishRate`/`burstCapacity`.
- **The bot's existing `RateLimitFilter` is NOT removed in this phase.** Run
  both in parallel, verify the gateway limiter behaves correctly under real
  traffic, then remove the in-app filter as a follow-up cleanup (this is the
  "replace the bot's in-app token bucket" item from the P1 task list, but
  doing the removal only after the gateway's limiter is proven avoids a
  window with no rate limiting at all).

---

## 8. Config / env vars summary

| Var | Default | Purpose |
|---|---|---|
| `BOT_SERVICE_URL` | `http://localhost:8090` | bot-manager route target |
| `PAYMENT_SERVICE_URL` | `http://localhost:8081` | PaymentManagementService route target |
| `MACHINE_SERVICE_URL` | `http://localhost:8082` | MachineStateService route target |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000` | same convention as the 3 services |
| `AUTH0_ISSUER_URI` | `https://dev-iuo6si32jobgnmod.eu.auth0.com/` | resource server |
| `AUTH0_AUDIENCE` | `https://smartlaundry.api` | resource server |
| `SPRING_REDIS_HOST` / `SPRING_REDIS_PORT` | `localhost` / `6379` | rate limiter store |
| `SERVER_PORT` | `8080` | gateway port |

All via Doppler once the existing P0 secret-manager rollout reaches this
project. **Decision: fold into the existing `spring-bot-manager` Doppler
project** (no 4th project) — it already holds `AUTH0_ISSUER_URI`/
`AUTH0_AUDIENCE`, and the gateway's other vars (`*_SERVICE_URL`,
`CORS_ALLOWED_ORIGINS`, `SERVER_PORT`, Redis host/port) are the same
"platform routing config" bucket. 8 vars don't justify a separate project,
access boundary, and CI wiring. See resolved item in §10.

---

## 9. Rollout plan (non-breaking)

1. Stand up `api-gateway` locally on :8080, routes to the 3 services'
   existing :8090/:8081/:8082 (unchanged).
2. Manually verify each route: auth (valid/invalid/missing JWT), CORS
   preflight, correlation-ID propagation, rate limiting, and **webhook
   passthrough** (`/payments/api/webhook/**`) — specifically: send a request
   with a real/test `X-Campay-Signature` header through the gateway and
   confirm (a) PaymentManagementService receives the header byte-for-byte,
   and (b) a request with the header stripped/altered is rejected by
   PaymentManagementService's own check, not just by the gateway. See the
   security note in §4.
3. Point a **local-only** dashboard build's `NEXT_PUBLIC_API_URL` at
   `http://localhost:8080` as a smoke test — dashboard's existing
   localStorage-token axios client should work unchanged against the
   gateway since the gateway passes the Authorization header through.
   (Full Auth0 OIDC/PKCE migration for the dashboard is still P6 — this is
   just confirming the gateway doesn't break the *current* token flow.)
4. Add gateway to `docker-compose.yml` for local dev parity.
5. Once stable: production cutover for the dashboard (still within P1/early
   P6), then start the Resilience4j and tracing P1 items against the now-
   centralized entry point.

---

## 10. Open questions before implementation

1. ~~**Exact Spring Cloud BOM version** compatible with Boot 3.5.14~~ —
   **Resolved**: `2025.0.0` resolves and builds cleanly against Boot 3.5.14.
   Used `spring-cloud-starter-gateway-server-webflux` (the non-deprecated
   successor to `spring-cloud-starter-gateway` in this train), with config
   under `spring.cloud.gateway.server.webflux.*`.
2. ~~**Doppler project** for gateway secrets~~ — **Resolved**: folded into
   the existing `spring-bot-manager` Doppler project (see §8).
3. **Swagger/api-docs exposure through the gateway** — currently
   `permitAll` for `/*/swagger-ui/**` and `/*/v3/api-docs/**` with no
   profile gate (`SecurityConfig.java`). Still open: revisit before
   production cutover — either profile-gate or drop once the gateway is the
   only front door.
4. ~~**Port 8080**~~ — **Resolved**: free, used as the gateway's port. Added
   as a profile-guarded (`profiles: ['gateway']`) service in the root
   `docker-compose.yml`, reaching the 3 host-run Spring services via
   `host.docker.internal`.

---

## Explicitly out of scope (separate P1 work)

- Resilience4j circuit breaker/retry/timeout/bulkhead on bot→payment,
  bot→machine, payment→machine calls.
- Replacing the hardcoded `localhost:8081`/`:8082` URLs *inside*
  `MicroserviceClientConfig` (bot, payment) with config/service discovery.
- OpenTelemetry tracing instrumentation across the 3 services + gateway,
  and structured JSON logging with correlation ID in MDC.
