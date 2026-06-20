# Smart Laundromat Control System - AI Coding Agent Instructions

## Project Overview

Node.js/Express backend for IoT laundry machine control system. Orchestrates mobile payments (Campay/MTN), WhatsApp bot interactions, and MQTT-based hardware control (ESP32 → washing machines). Deployed on Heroku/VPS with MongoDB, Redis, and Mosquitto MQTT broker.

## Architecture Key Points

**Hub-and-Spoke Model**: Backend acts as traffic controller between:
- **WhatsApp Cloud API** (Meta) → User interactions via webhooks
- **Payment Gateways** (Campay/MTN) → Mobile money webhooks
- **MQTT Broker** (Mosquitto) → ESP32 controllers at physical shop
- **MongoDB** → Transaction state, user sessions, machine status

**Critical Flow**: WhatsApp message → Payment webhook → MQTT command → ESP32 pulse → Machine starts.

**Race Condition Prevention**: [whatsappHandler.js](../src/handlers/whatsappHandler.js) checks for `PENDING` transactions (5-min window) before allowing machine selection. Prevents double-booking during payment processing.

## Configuration System

Uses **YAML + env vars** via [src/config/env.js](../src/config/env.js):
1. Loads `config/environments/values.yml` (base)
2. Merges `dev.yml|test.yml|stage.yml|prod.yml` based on `NODE_ENV`
3. Env vars override YAML (secrets like `CAMPAY_TOKEN`, `META_TOKEN`)

**Never hardcode**: Pricing, API URLs, machine IDs. Access via `config.pricing.short_cycle`, `config.MACHINES.AVAILABLE_MACHINES`.

## Service Layer Patterns

**mqttService** ([src/services/mqttService.js](../src/services/mqttService.js)):
- Validates machineId against whitelist, pulse count (1-10 range + regex check), and action types
- **Command Topic**: Publishes to `laundry/cameroon/{machineId}/command` with QoS 1
  - Payload: `{ action: "pulse", count: pulseCount }` (actions: pulse, status, stop, reset)
- **Telemetry Topic**: Subscribes to `laundry/cameroon/{machineId}/telemetry` (published every 5s)
  - Payload: `{ status, currentCycle, telemetry: {temperature, waterLevel, spinSpeed}, maintenance: {totalCycles}, isOnline, lastHeartbeat }`
  - Auto-upserts Machine collection via `processTelemetry()` → findOneAndUpdate
- In TEST env, embeds simulator; in PROD, connects to real broker

**whatsappService** ([src/services/whatsappService.js](../src/services/whatsappService.js)):
- Two functions: `sendMessage(to, text)` and `sendButtons(to, text, buttons)`
- Uses WhatsApp Cloud API v18.0 with Bearer token from `config.META_TOKEN`
- i18n via [src/locales/translations.js](../src/locales/translations.js): `t(phone, 'key')` auto-detects language from phone prefix

**paymentService** ([src/services/paymentService.js](../src/services/paymentService.js)):
- Wraps Campay/MTN APIs with network detection (MTN: `237677/67x`, Orange: `23769x`)
- Creates Transaction record with `status: 'PENDING'` before API call
- Webhook updates status to `SUCCESS|FAILED`, triggers MQTT pulse on success

**cycleMonitorService** ([src/services/cycleMonitorService.js](../src/services/cycleMonitorService.js)):
- Polls every 30s for transactions with `cycleStatus: 'IN_PROGRESS'` and expired `cycleEndsAt`
- Sends WhatsApp notification "Your laundry is ready" on completion
- Schedules feedback request 30min later via [feedbackService.js](../src/services/feedbackService.js)

## State Management

**Session Storage** ([src/utils/stateManager.js](../src/utils/stateManager.js)):
- Uses Redis in PROD, in-memory Map in DEV/TEST
- Pattern: `setSession(userId, { step: 'AWAITING_PAYMENT', machineId: 'washer_01' })`
- **WhatsApp State Machine** (see [whatsappHandler.js](../src/handlers/whatsappHandler.js)):
  - `LANGUAGE_SELECTION` → `MAIN_MENU` → `SELECT_MACHINE_METHOD` → `AWAITING_MACHINE_SELECTION` → `SELECT_CYCLE` → `AWAITING_FEEDBACK` → `AWAITING_FEEDBACK_COMMENT`
  - Global reset: "hi", "hello", "reset", "cancel" → returns to MAIN_MENU (preserves language)
  - QR deep links: "START washer_01" → jumps directly to SELECT_CYCLE

**Business Hours** ([src/utils/businessHours.js](../src/utils/businessHours.js)):
- Enforces Mon-Sat 6:00-22:00 (configurable in YAML)
- Rejects payments outside hours with localized message
- Used in [whatsappHandler.js](../src/handlers/whatsappHandler.js) before payment initiation

## Security & Validation

**Input Sanitization** (see [src/tests/unit/security/inputSanitization.test.js](../src/tests/unit/security/inputSanitization.test.js)):
- Phone numbers: Regex validated, prefixes checked against network whitelist
- Pulse counts: Integer 1-10, regex `^-?\d+$` to prevent injection
- Machine IDs: Whitelist validation against `config.MACHINES.AVAILABLE_MACHINES`

**Secrets Management**:
- NEVER log `CAMPAY_TOKEN`, `META_TOKEN`, `JWT_SECRET`, phone numbers, or emails
- [src/utils/logger.js](../src/utils/logger.js) auto-redacts PII using regex patterns
- Production uses Heroku Config Vars or GitHub Secrets, not `.env` files

**HTTP Security** ([src/server.js](../src/server.js#L45-L62)):
- Helmet with CSP, HSTS (1 year), X-Frame-Options
- CORS whitelist in PROD (comma-separated `CORS_ALLOWED_ORIGINS`)
- Trust proxy enabled in production for HTTPS detection

## Testing Strategy

**Test Structure** (Jest):
```javascript
describe('functionName', () => {
  test('shouldDoSomethingWhenCondition', () => {
    // given
    const input = setupTestData();
    
    // when
    const result = functionUnderTest(input);
    
    // then
    expect(result.status).toBe(200);
  });
});
```

**Key Test Files**:
- [src/tests/unit/services/mqttService.test.js](../src/tests/unit/services/mqttService.test.js) - MQTT validation logic
- [src/tests/integration/security.test.js](../src/tests/integration/security.test.js) - Helmet, CORS, rate limiting
- [src/tests/unit/controllers/webhookController.test.js](../src/tests/unit/controllers/webhookController.test.js) - Payment webhook handling

**Coverage Requirements**: 80% branches/functions/lines (see [package.json](../package.json#L41-L46))

## Common Workflows

**Local Development**:
```bash
docker-compose up              # Start MongoDB + MQTT + Redis
npm run dev:all                # Start server + embedded simulator
# In new terminal: ngrok http 3000
# Update Meta webhook URL to ngrok HTTPS
```

**Run Tests**:
```bash
npm test                       # All tests
npm run test:unit              # Unit tests only
npm run test:integration       # Integration tests only
npm run test:coverage          # With coverage report
```

**Add New Machine**:
1. Add machine ID to `config/environments/{env}.yml` → `machines.available_machines`
2. Update pricing if needed in same file
3. Restart server (config loads at startup)

## Branching & Git Workflow

**Branch Naming**:
- Features: `feature/sl-XXX-description` (e.g., `feature/sl-042-qr-codes`)
- Bugs: `bug/sl-XXX-description` or `bugfix/sl-XXX-description`
- Hotfixes: `hotfix/sl-XXX-description`

**Workflow**:
1. Create branch from `develop`: `git checkout -b feature/sl-XXX-name`
2. Commit changes (standard commit messages)
3. Open PR to `develop` → triggers [PR Quality Check](.github/workflows/pull-request.yml)
4. PR title auto-formatted from branch (e.g., `feature/sl-003-payment` → "Payment (SL-003)")
5. After approval, merge to `develop` → auto-deploys to TEST

## CI/CD Pipeline

**GitHub Actions Triggers** (see [CI-CD.md](../CI-CD.md)):

| Workflow | Trigger | Action |
|----------|---------|--------|
| **PR Quality Check** | PR opened/updated | Runs tests (Node 18.x, 20.x), Docker build, security audit |
| **Deploy to TEST** | Merge to `develop` | **Auto-deploy** to Heroku TEST (`smartlaundry-test`) |
| **Deploy to STAGE** | Manual (workflow_dispatch) | Requires confirmation, deploys `develop` to STAGE |
| **Deploy to PROD** | GitHub Release (tag `vX.Y.Z`) | Validates tag, runs tests, deploys to PROD with rollback |

**Heroku Deployment Pattern**:
1. GitHub Action builds Docker image
2. Pushes to Heroku Container Registry: `heroku container:push web -a {APP_NAME}`
3. Releases: `heroku container:release web -a {APP_NAME}`
4. Sets env vars via `heroku config:set` (from GitHub Secrets)
5. Health check: `curl https://{APP_NAME}.herokuapp.com/api/health`

**Required GitHub Secrets** (Settings → Secrets → Actions):
- `HEROKU_API_KEY`, `HEROKU_EMAIL`
- `{ENV}_MONGO_URI`, `{ENV}_CAMPAY_KEY`, `{ENV}_WHATSAPP_TOKEN` (per environment)
- See [CONFIGURATION.md](../CONFIGURATION.md) for full list

## Error Handling

**Controller Pattern** ([src/controllers/paymentController.js](../src/controllers/paymentController.js)):
- Return `{ error: 'message' }` with appropriate status code (400/500)
- Let [middleware/errorHandler.js](../src/middleware/errorHandler.js) catch unhandled errors
- Never expose stack traces in PROD (errorHandler checks `NODE_ENV`)

**Service Layer**: Throw `Error` objects with actionable messages, never strings.

## Documentation References

- [API.md](../API.md) - REST endpoints, request/response schemas
- [CONFIGURATION.md](../CONFIGURATION.md) - Environment setup, deployment configs
- [DOCKER.md](../DOCKER.md) - Container setup, multi-stage builds
- [CI-CD.md](../CI-CD.md) - GitHub Actions workflows, deployment pipeline
- [docs/PAYMENT_FLOW.md](../docs/PAYMENT_FLOW.md) - End-to-end payment sequence
- [Notion Project Hub](https://www.notion.so/Buanderie-Automatique-Cameroun-Project-Hub-2c67cc5ed1ea81a99d00f552b1f89625) - Product requirements, design specs, business context
