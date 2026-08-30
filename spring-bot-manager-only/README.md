# spring-bot-manager-only

Spring Boot **modular monolith** — the WhatsApp bot chat layer for the **SmartLaundromatControlSystem** ecosystem.

All payment and machine-state concerns are **delegated to dedicated microservices** via HTTP, keeping this service focused purely on conversation management, flow orchestration, and WhatsApp Cloud API integration.

> Part of a 3-service architecture:
> - **spring-bot-manager-only** ← you are here (WhatsApp bot / chat)
> - [PaymentManagementService](https://github.com/GustaveDjoutsop/PaymentManagementService) — RFID cards & mobile money (port 8081)
> - [MachineStateService](https://github.com/GustaveDjoutsop/MachineStateService) — ESP32, MQTT & machine lifecycle (port 8082)

---

## Architecture Overview

```
WhatsApp User
      │
      ▼
spring-bot-manager-only  (port 8090)
  ├── Flow Engine          → drives conversation states (JSON-configured)
  ├── LaundryBot           → bilingual laundromat chatbot
  │     │
  │     ├── POST /api/payments/initiate
  │     │         └──► PaymentManagementService :8081
  │     │                   ├── CamPay / MTN MoMo / Orange Money
  │     │                   └── RFID card debit
  │     │
  │     └── POST /api/machines/start-cycle
  │               └──► MachineStateService :8082
  │                         ├── MQTT pulse → ESP32
  │                         └── Machine state tracking
  │
  └── Webhooks forwarded → PaymentManagementService :8081
```

---

## What Changed (Refactoring from spring-bot-manager)

| Component | Before | After |
|-----------|--------|-------|
| `DefaultPaymentGateway` | Called CamPay/MTN APIs directly | HTTP POST to `PaymentManagementService` |
| `MachineService` | Published MQTT commands, read Redis | HTTP calls to `MachineStateService` |
| `PaymentsController` | Handled webhooks locally | Forwards to `PaymentManagementService` via gateway |
| `MachinesController` | Read from local Redis store | Proxies to `MachineStateService` |
| `CamPayProvider` | Local implementation | **Deleted** — moved to `PaymentManagementService` |
| `MtnMomoProvider` | Local stub | **Deleted** — moved to `PaymentManagementService` |
| `PaymentProvider` abstract | Local base class | **Deleted** — no longer needed |

`LaundryFlowPlugin`, `LaundryBot`, and the `FlowEngine` are **unchanged** — they still call the same `PaymentGateway` and `MachineService` interfaces; only the implementations behind them changed.

---

## Features

- **Multi-bot routing** via `phone_number_id`
- **Configuration-driven conversation flows** (JSON)
- **Redis-backed state** with in-memory fallback
- **Microservice delegation** — payment & machine logic live in dedicated services
- **Internationalization** (EN / FR) with Mustache template rendering
- **Business hours validation** with timezone support
- **Rate limiting** (token bucket per IP)
- **Webhook signature verification** (HMAC-SHA256)

## Bots Included

### LaundryBot
Self-service laundromat chatbot:
- Bilingual (English / French)
- Machine selection (manual ID or list)
- Cycle selection with business hours validation
- Mobile money payment via `PaymentManagementService`
- Machine start via `MachineStateService`
- Feedback collection & staff alerts for low ratings

### ThomasNetworkBot
Network access service bot for pressing / laundry services.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Java 21, Spring Boot 3.3.7 |
| Modules | Maven multi-module (bot-core, bot-payment, bot-laundry, bot-app) |
| State | Redis (+ in-memory fallback) |
| Persistence | PostgreSQL + Flyway migrations |
| HTTP Client | Spring `RestTemplate` |
| Templating | Mustache |
| Build | Maven |
| Utilities | Lombok |

---

## Module Structure

```
spring-bot-manager-only/
├── bot-core/        # Flow engine, WhatsApp client, Redis, persistence
├── bot-payment/     # PaymentGateway interface + DefaultPaymentGateway (HTTP delegate)
│                    # PaymentsController (webhook forwarder)
│                    # MicroserviceProperties (configurable URLs)
├── bot-laundry/     # LaundryBot, LaundryFlowPlugin, MachineService (HTTP delegate)
│                    # MachinesController
├── bot-pharmacy/    # Pharmacy bot (separate domain)
└── bot-app/         # Spring Boot entry point, security, JWT, AppConfig
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/whatsapp/webhook` | Meta webhook verification |
| `POST` | `/api/whatsapp/webhook` | WhatsApp inbound messages |
| `POST` | `/api/payments/webhooks/campay/{botId}` | CamPay callback (forwarded to PaymentManagementService) |
| `POST` | `/api/payments/webhooks/mtn/{botId}` | MTN MoMo callback |
| `POST` | `/api/payments/webhooks/orange/{botId}` | Orange Money callback |
| `GET` | `/api/payments/{botId}/transactions/{transactionId}` | Retrieve transaction |
| `GET` | `/api/machines/{botId}` | List machines (proxied from MachineStateService) |
| `GET` | `/api/machines/{botId}/{machineId}` | Single machine status |
| `GET` | `/api/machines/{botId}/available` | Available machines only |

---

## Configuration

### Microservice URLs

| Variable | Description | Default |
|----------|-------------|---------|
| `PAYMENT_SERVICE_URL` | PaymentManagementService base URL | `http://localhost:8081` |
| `MACHINE_STATE_SERVICE_URL` | MachineStateService base URL | `http://localhost:8082` |

### WhatsApp Cloud API (Meta)

| Variable | Description |
|----------|-------------|
| `WHATSAPP_APP_SECRET` | App secret for webhook signature verification |
| `WHATSAPP_API_VERSION` | Graph API version (e.g. `v20.0`) |
| `WHATSAPP_ACCESS_TOKEN_<BOTID>` | Per-bot access token |
| `WHATSAPP_APP_SECRET_<BOTID>` | Per-bot app secret |

### CamPay (webhook secret only — payments handled by PaymentManagementService)

| Variable | Description |
|----------|-------------|
| `CAMPAY_WEBHOOK_SECRET` | Default webhook signing secret |
| `CAMPAY_WEBHOOK_SECRET_<BOTID>` | Per-bot webhook signing secret |

### Other

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8090` | HTTP port |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `DATABASE_URL` | `jdbc:postgresql://localhost:5432/smartbot` | PostgreSQL URL |
| `JWT_SECRET` | — | JWT signing secret (min 32 chars) |
| `BOT_CONFIG_DIRECTORY` | `configs/bots` | Directory for `*.bot.json` config files |

### Bot Configuration (JSON)

Place bot config files in `configs/bots/`:

```json
{
  "botId": "laundry",
  "botName": "Smart Laundry",
  "botType": "laundry",
  "phoneNumberId": "YOUR_PHONE_NUMBER_ID",
  "verifyToken": "YOUR_VERIFY_TOKEN",
  "shortCycle": { "duration": 30, "price": 1000, "pulseCount": 1 },
  "longCycle":  { "duration": 60, "price": 2000, "pulseCount": 2 },
  "businessHours": {
    "openTime": "07:00",
    "closeTime": "22:00",
    "closingBufferMinutes": 15,
    "timezone": "Africa/Douala"
  }
}
```

---

## Quick Start

### Prerequisites

- Java 21+
- Maven 3.8+
- Redis (optional — falls back to in-memory)
- PostgreSQL
- [PaymentManagementService](https://github.com/GustaveDjoutsop/PaymentManagementService) running on port 8081
- [MachineStateService](https://github.com/GustaveDjoutsop/MachineStateService) running on port 8082

### Run (local)

```bash
git clone https://github.com/GustaveDjoutsop/spring-bot-manager-only.git
cd spring-bot-manager-only

# Set required env vars
export DATABASE_URL=jdbc:postgresql://localhost:5432/smartbot
export DATABASE_USERNAME=smartbot
export DATABASE_PASSWORD=smartbot
export JWT_SECRET=change-me-in-production-must-be-at-least-32-chars
export PAYMENT_SERVICE_URL=http://localhost:8081
export MACHINE_STATE_SERVICE_URL=http://localhost:8082

mvn clean package -DskipTests -pl bot-app -am
java -jar bot-app/target/bot-app-0.1.0-SNAPSHOT.jar
```

Service starts on **http://localhost:8090**

### Build only

```bash
mvn clean package -DskipTests
```

---

## Running the Full Stack

Start all three services together:

```bash
# Terminal 1 — PaymentManagementService
cd PaymentManagementService && mvn spring-boot:run

# Terminal 2 — MachineStateService
cd MachineStateService && mvn spring-boot:run

# Terminal 3 — spring-bot-manager-only
cd spring-bot-manager-only && mvn spring-boot:run -pl bot-app -am
```

Ports:

| Service | Port |
|---------|------|
| spring-bot-manager-only | 8090 |
| PaymentManagementService | 8081 |
| MachineStateService | 8082 |

---

## Related Projects

- [PaymentManagementService](https://github.com/GustaveDjoutsop/PaymentManagementService)
- [MachineStateService](https://github.com/GustaveDjoutsop/MachineStateService)
- [SmartLaundromatControlSystem](https://github.com/GustaveDjoutsop/SmartLaundromatControlSystem) — original Node.js system

## License

MIT
