# Spring Bot Manager

Spring Boot **modular monolith** service for a multi-tenant Bot-as-a-Service platform (WhatsApp Cloud API).

Local setup and required environment variables are documented in `document/LOCAL_RUN_GUIDE.md`.

## Features

- **Multi-bot routing** via `phone_number_id`
- **Configuration-driven conversation flows** (JSON)
- **Redis-backed state** with in-memory fallback for graceful degradation
- **Payment provider abstraction** (CamPay/MTN MoMo)
- **MQTT integration** for IoT machine control (HiveMQ client)
- **Internationalization** (EN/FR) with template rendering
- **Business hours validation** with timezone support
- **Rate limiting** middleware (token bucket)
- **Webhook signature verification** (HMAC-SHA256)

## Bots Included

### LaundryBot
Self-service laundromat chatbot with:
- Bilingual support (English/French)
- Machine selection (manual ID or list)
- Cycle selection with business hours validation
- Mobile money payment integration
- Feedback collection system
- Staff alerts for low ratings

### ThomasNetworkBot
Network access service bot for pressing/laundry services.

## Tech Stack

- **Java 17** + **Spring Boot 3.2.2**
- **Maven** build system
- **Redis** for state management
- **HiveMQ MQTT Client** for IoT
- **Mustache** for template rendering
- **Lombok** for boilerplate reduction

## Quick Start

### Prerequisites

- Java 17+
- Maven 3.8+
- Redis (optional, falls back to in-memory)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/GustaveDjoutsop/spring-bot-manager.git
   cd spring-bot-manager
   ```

2. Configure environment:
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

3. Build:
   ```bash
   mvn clean package -DskipTests
   ```

4. Run:
   ```bash
   java -jar target/spring-bot-manager-1.0.0-SNAPSHOT.jar
   ```

   Or with Maven:
   ```bash
   mvn spring-boot:run
   ```

## Configuration

### Local Development

- Copy [.env.example](.env.example) to `.env` for environment-based config.
- Or use the Spring profile file [src/main/resources/application-local.properties](src/main/resources/application-local.properties) when `SPRING_PROFILES_ACTIVE=local`.

### Environment Variables (and where to get them)

This service supports **multi-bot routing** using WhatsApp webhook metadata `phone_number_id`. Each bot is configured in JSON (see next section) and has its own WhatsApp credentials.

#### Server / Spring

| Variable | Meaning | Where to set/get |
|----------|---------|------------------|
| `PORT` | HTTP port for the API | Local choice (default `3000`) |
| `MANAGEMENT_PORT` | Spring actuator port | Local choice (default `8081`) |
| `SPRING_PROFILES_ACTIVE` | Spring profile (`local`, `cicd`, etc.) | Local choice |

#### Redis (optional)

| Variable | Meaning | Where to set/get |
|----------|---------|------------------|
| `REDIS_URL` | Redis connection URL | Your Redis provider or local redis (`redis://localhost:6379`) |

#### WhatsApp Cloud API (Meta)

| Variable | Meaning | Where to get it in Meta |
|----------|---------|--------------------------|
| `WHATSAPP_API_BASE` | Graph API base URL | Usually keep default `https://graph.facebook.com` |
| `WHATSAPP_API_VERSION` | Graph API version | e.g. `v20.0` |
| `WHATSAPP_VERIFY_SIGNATURE` | If `true`, reject webhooks with invalid `X-Hub-Signature-256` | Recommended `true` in production |
| `WHATSAPP_ACCESS_TOKEN_<BOTID>` | Token used to call WhatsApp Cloud API **for that bot** (send messages) | Meta App → WhatsApp → API Setup → (Temporary/Permanent) access token |
| `WHATSAPP_APP_SECRET_<BOTID>` | App secret used to validate `X-Hub-Signature-256` **for that bot** | Meta App → Settings → Basic → **App secret** |
| `WHATSAPP_APP_SECRET` | Global fallback app secret (single-app setups) | Same as above (only if you run one Meta app) |

Notes:
- The **WhatsApp Business Account ID (WABA)** is not required by this service.
- `<BOTID>` must match the bot config `botId` (example: `LAUNDRY`, `THOMASNETWORK`).

#### WhatsApp Webhook Verification Token

This is not an env var. It is configured per bot in the bot JSON as `verifyToken` and is used only for the initial webhook handshake (`GET /api/whatsapp/webhook`).

| Field | Meaning | Where to set/get |
|------|---------|------------------|
| `verifyToken` (in bot JSON) | A static string you choose; Meta sends it back as `hub.verify_token` during verification | You choose it; set the same value in Meta webhook config |

#### CamPay

| Variable | Meaning | Where to get it in CamPay |
|----------|---------|----------------------------|
| `CAMPAY_BASE_URL` | CamPay API base URL | Use `https://demo.campay.net/api` for sandbox, `https://www.campay.net/api` for live |
| `CAMPAY_AUTH_SCHEME` | Auth scheme for `Authorization` header | Usually `Token` |
| `CAMPAY_TOKEN_<BOTID>` | **Permanent access token** for that bot’s CamPay app | CamPay dashboard → Application → API Access Keys → **Permanent Access token** |
| `CAMPAY_WEBHOOK_SECRET_<BOTID>` | Webhook signing key for that CamPay app | CamPay dashboard → Application → API Access Keys → **App webhook key** |
| `CAMPAY_TOKEN` / `CAMPAY_WEBHOOK_SECRET` | Global fallbacks (single CamPay app setup) | Same as above |

Webhook URL to configure per CamPay app:
- `POST /api/payments/webhooks/campay/laundry`
- `POST /api/payments/webhooks/campay/thomasnetwork`

#### MQTT (optional)

| Variable | Meaning | Where to set/get |
|----------|---------|------------------|
| `MQTT_URL` | Broker URL | Your MQTT broker |
| `MQTT_USERNAME` | Broker username | Your MQTT broker |
| `MQTT_PASSWORD` | Broker password | Your MQTT broker |
| `MQTT_TOPIC_PREFIX` | Optional prefix | Your choice |

#### Rate limiting / Queue

| Variable | Meaning | Default |
|----------|---------|---------|
| `RATE_LIMIT_WHATSAPP_WINDOW_MS` | Window for WhatsApp requests | `60000` |
| `RATE_LIMIT_WHATSAPP_MAX` | Max WhatsApp requests per window | `120` |
| `RATE_LIMIT_PAYMENTS_WEBHOOK_WINDOW_MS` | Window for payment webhooks | `60000` |
| `RATE_LIMIT_PAYMENTS_WEBHOOK_MAX` | Max payment webhooks per window | `120` |
| `QUEUE_MAX_SIZE` | In-memory queue size | `500` |

#### Bot configuration directory

| Variable | Meaning | Default |
|----------|---------|---------|
| `BOT_CONFIG_DIRECTORY` | Where `*.bot.json` configs are loaded from | `configs/bots` |

### Bot Configuration

Bots are configured via JSON files in `configs/bots/`:

```json
{
  "botId": "laundry",
  "botName": "Smart Laundry",
  "botType": "laundry",
  "phoneNumberId": "YOUR_PHONE_NUMBER_ID",
  "verifyToken": "YOUR_VERIFY_TOKEN",
  "shortCycle": { "duration": 30, "price": 1000, "pulseCount": 1 },
  "longCycle": { "duration": 60, "price": 2000, "pulseCount": 2 },
  "businessHours": {
    "openTime": "07:00",
    "closeTime": "22:00",
    "timezone": "Africa/Douala"
  }
}
```

Where to get the WhatsApp `phoneNumberId`:
- Meta App → WhatsApp → API Setup → **Phone number ID** (also appears in webhook payload as `metadata.phone_number_id`).

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/health/ready` | Readiness probe |
| `GET` | `/api/health/live` | Liveness probe |
| `GET` | `/api/whatsapp/webhook` | Meta verification |
| `POST` | `/api/whatsapp/webhook` | WhatsApp inbound messages |
| `POST` | `/api/payments/webhooks/campay/{botId}` | CamPay callbacks (per bot) |
| `GET` | `/api/machines/{botId}` | List machines for a bot |

## Docker

### Build

```bash
docker build -t spring-bot-manager:latest .
```

### Run

```bash
docker run -p 3000:3000 --env-file .env spring-bot-manager:latest
```

## Kubernetes Deployment

Helm charts are available in `ci/helm-chart/`:

```bash
helm install spring-bot-manager ./ci/helm-chart \
  -f ./ci/helm-values/prod.yaml \
  --set secrets.whatsappAccessToken=$WHATSAPP_TOKEN
```

## Testing

### Unit Tests

```bash
mvn test
```

### Integration Tests

```bash
cd integration-tests
docker-compose up --build
```

## Project Structure

```
src/main/java/com/botmanager/
├── bots/
│   ├── laundry/          # LaundryBot implementation
│   └── thomasnetwork/    # ThomasNetworkBot implementation
├── config/               # Configuration properties
├── controller/           # REST controllers
├── core/
│   ├── bot/              # Bot base classes and registry
│   ├── flow/             # Conversation flow engine
│   ├── i18n/             # Internationalization
│   ├── machine/          # Machine management
│   ├── mqtt/             # MQTT client
│   ├── payment/          # Payment gateway
│   ├── queue/            # Message queue
│   ├── redis/            # Redis manager
│   └── whatsapp/         # WhatsApp client
├── handler/              # Webhook handlers
├── middleware/           # Request filters
└── util/                 # Utilities
```

## Related Projects

- [BotManagerService](https://github.com/GustaveDjoutsop/BotManagerService) - Node.js variant
- [SmartLaundromatControlSystem](https://github.com/GustaveDjoutsop/SmartLaundromatControlSystem) - Original laundromat system

## License

MIT
