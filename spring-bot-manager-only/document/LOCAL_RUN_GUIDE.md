# Local Run Guide (spring-bot-manager)

This guide explains how to run the service locally and which variables are required.

## 1. Prerequisites

- Java 21+
- Maven 3.9+
- Docker Desktop (recommended for local Postgres + Redis)

## 2. Start Local Dependencies

From repo root:

```powershell
docker compose up -d postgres redis
```

This starts:
- PostgreSQL on `localhost:15432` (db: `smartbot`, user: `smartbot`, password: `smartbot`)
- Redis on `localhost:6379`

## 3. Minimal Variables to Run the Service

For local startup (without real WhatsApp/CamPay traffic), these are enough:

```powershell
$env:SPRING_PROFILES_ACTIVE = "local"
$env:DATABASE_URL = "jdbc:postgresql://localhost:15432/smartbot"
$env:DATABASE_USERNAME = "smartbot"
$env:DATABASE_PASSWORD = "smartbot"
$env:REDIS_URL = "redis://localhost:6379"
```

Then run:

```powershell
mvn -pl bot-app -am spring-boot:run
```

Alternative (jar):

```powershell
mvn clean package -DskipTests
java -jar bot-app/target/bot-app-0.1.0-SNAPSHOT.jar
```

## 4. Complete Variable Reference

## 4.1 Server and Spring

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | No | `3000` | Main HTTP port |
| `MANAGEMENT_PORT` | No | `8081` | Actuator port |
| `SPRING_PROFILES_ACTIVE` | Recommended | none | Use `local` for local profile |

## 4.2 Database and Redis

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Yes (practically) | `jdbc:postgresql://localhost:15432/smartbot` | PostgreSQL JDBC URL |
| `DATABASE_USERNAME` | Yes (practically) | `smartbot` | DB username |
| `DATABASE_PASSWORD` | Yes (practically) | `smartbot` | DB password |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis URL; in-memory fallback exists if unavailable |
| `REDISCLOUD_URL` | No | none | Alternate Redis URL fallback key |

Note: Flyway + JPA validation are enabled in main config, so PostgreSQL should be reachable at startup.

## 4.3 Bot Config Discovery

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `BOT_CONFIG_DIRECTORY` | No | `configs/bots` | Directory containing `*.bot.json` files |

## 4.4 WhatsApp Variables

Global:

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `WHATSAPP_API_VERSION` | No | `v20.0` | Graph API version |
| `WHATSAPP_API_BASE` | No | `https://graph.facebook.com` | Graph API base URL |
| `WHATSAPP_VERIFY_SIGNATURE` | No | `true` (main app), `false` in local profile | Validate `X-Hub-Signature-256` |
| `WHATSAPP_APP_SECRET` | Required if signature verification is enabled and no per-bot secret exists | empty | Global app secret fallback |

Per-bot naming convention:
- `WHATSAPP_ACCESS_TOKEN_<BOTID_UPPER>`
- `WHATSAPP_APP_SECRET_<BOTID_UPPER>`
- `VERIFY_TOKEN_<BOTID_UPPER>`

Example bot IDs in this repo:
- `laundry` -> suffix `LAUNDRY`
- `thomasnetwork` -> suffix `THOMASNETWORK`
- `pharmacy` -> suffix `PHARMACY` (only if enabled)

Examples:
- `WHATSAPP_ACCESS_TOKEN_LAUNDRY`
- `WHATSAPP_APP_SECRET_THOMASNETWORK`
- `VERIFY_TOKEN_PHARMACY`

Also supported as Spring properties (alternative to env vars):
- `whatsapp.access-token.<botId>`
- `whatsapp.app-secret.<botId>`

## 4.5 CamPay Variables

Global:

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `CAMPAY_TOKEN` | Required for payments if no per-bot token | empty | Global CamPay token |
| `CAMPAY_BASE_URL` | No | `https://www.campay.net/api` | CamPay base URL |
| `CAMPAY_AUTH_SCHEME` | No | `Token` | Authorization scheme |
| `CAMPAY_COLLECT_PATH` | No | `/collect/` | Collect endpoint path |
| `CAMPAY_STATUS_PATH` | No | `/transaction/` | Status endpoint path |
| `CAMPAY_WEBHOOK_SECRET` | Recommended for webhook signature validation | empty | Global webhook secret |
| `CAMPAY_WEBHOOK_SIGNATURE_HEADER` | No | `x-campay-signature` | Signature header name |

Per-bot naming convention:
- `CAMPAY_TOKEN_<BOTID_UPPER>`
- `CAMPAY_WEBHOOK_SECRET_<BOTID_UPPER>`
- `CAMPAY_BASE_URL_<BOTID_UPPER>`
- `CAMPAY_AUTH_SCHEME_<BOTID_UPPER>`
- `CAMPAY_COLLECT_PATH_<BOTID_UPPER>`
- `CAMPAY_STATUS_PATH_<BOTID_UPPER>`

Also supported as Spring properties:
- `campay.token.<botId>`
- `campay.webhook-secret.<botId>`
- `campay.base-url.<botId>`
- `campay.auth-scheme.<botId>`
- `campay.collect-path.<botId>`
- `campay.status-path.<botId>`

## 4.6 Machine control (R6: MQTT removed)

This service no longer talks MQTT directly. MachineStateService owns MQTT for
real machine telemetry/control (ESP32 pulse, machine lifecycle); this service
calls it over HTTP (`POST /api/machines/start-cycle`). The `MqttManager` that
used to live here only ever connected to report a health-check boolean and
was never subscribed or published to — removed rather than kept as a fallback
nothing used.

## 4.7 Rate Limit and Payment Timing

| Variable | Required | Default |
|---|---|---|
| `RATE_LIMIT_WHATSAPP_WINDOW_MS` | No | `60000` |
| `RATE_LIMIT_WHATSAPP_MAX` | No | `120` |
| `RATE_LIMIT_PAYMENTS_WEBHOOK_WINDOW_MS` | No | `60000` |
| `RATE_LIMIT_PAYMENTS_WEBHOOK_MAX` | No | `120` |
| `PAYMENT_TTL_SECONDS` | No | `86400` |
| `PAYMENT_POLL_INTERVAL_MS` | No | `10000` |
| `PAYMENT_TIMEOUT_MS` | No | `600000` |

## 5. Bot Enablement Flags

Bot beans are loaded with these rules:
- `smartbot.bots.laundry.enabled`: default enabled (`matchIfMissing = true`)
- `smartbot.bots.thomasnetwork.enabled`: default enabled (`matchIfMissing = true`)
- `smartbot.bots.pharmacy.enabled`: default disabled (`matchIfMissing = false`)

To enable pharmacy locally:

```powershell
$env:SMARTBOT_BOTS_PHARMACY_ENABLED = "true"
```

(Equivalent Spring property: `smartbot.bots.pharmacy.enabled=true`.)

## 6. Recommended Local Startup (PowerShell)

```powershell
# 1) infra
 docker compose up -d postgres redis

# 2) minimum runtime vars
$env:SPRING_PROFILES_ACTIVE = "local"
$env:DATABASE_URL = "jdbc:postgresql://localhost:15432/smartbot"
$env:DATABASE_USERNAME = "smartbot"
$env:DATABASE_PASSWORD = "smartbot"
$env:REDIS_URL = "redis://localhost:6379"

# 3) optional: disable strict signature checks for local webhook simulation
$env:WHATSAPP_VERIFY_SIGNATURE = "false"

# 4) run
mvn -pl bot-app -am spring-boot:run
```

## 7. Local Health Checks

After startup:

- `http://localhost:3000/api/health`
- `http://localhost:8081/actuator/health`

## 8. Important Notes

- `.env` files are **not automatically loaded** by Spring Boot in `mvn spring-boot:run` unless you explicitly wire that behavior.
- Prefer setting env vars in shell, IDE run configuration, or OS environment.
- Do not keep real secrets in `application-local.yaml` in shared repositories.
