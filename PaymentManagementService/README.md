# PaymentManagementService

Spring Boot microservice for the **SmartLaundromatControlSystem** ecosystem.  
Handles all payment concerns: RFID card accounts, mobile money top-ups, transaction processing, and provider webhook ingestion.

> Part of a 3-service architecture. See also:
> - [MachineStateService](https://github.com/GustaveDjoutsop/MachineStateService) — machine lifecycle & ESP32 MQTT
> - [spring-bot-manager-only](https://github.com/GustaveDjoutsop/spring-bot-manager-only) — WhatsApp bot chat layer

---

## Features

- **RFID card accounts** — register cards, check balance, debit per wash cycle, top-up
- **Mobile money payments** — CamPay, MTN MoMo, and Orange Money providers
- **Top-up flow** — recharge RFID cards via mobile money or cash
- **Webhook ingestion** — receives and processes provider callbacks (CamPay, MTN, Orange)
- **Payment timeout scheduler** — marks pending payments as `TIMEOUT` after 5 minutes
- **H2 in-memory DB** (dev) / **PostgreSQL** (production)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Java 17, Spring Boot 3.3.5 |
| Persistence | Spring Data JPA, H2 (dev), PostgreSQL (prod) |
| HTTP Client | Spring WebFlux WebClient |
| Build | Maven |
| Utilities | Lombok |

---

## Project Structure

```
src/main/java/com/smartlaundromat/payment/
├── config/
│   ├── PaymentConfig.java          # CamPay, MTN, Orange Money settings
│   └── WebClientConfig.java
├── controller/
│   ├── RfidCardController.java     # RFID card management endpoints
│   ├── PaymentController.java      # Mobile money payment endpoints
│   ├── TopUpController.java        # Card top-up endpoints
│   └── WebhookController.java      # Provider webhook receivers
├── dto/                            # Request/response DTOs
├── exception/                      # Global error handling
├── model/
│   ├── RfidCard.java
│   ├── Transaction.java
│   ├── TopUpTransaction.java
│   └── enums/
├── repository/                     # JPA repositories
└── service/
    ├── RfidCardService.java        # Card balance, debit, credit
    ├── PaymentService.java         # Payment orchestration
    ├── TopUpService.java           # Card top-up orchestration
    ├── PaymentTimeoutService.java  # Scheduled timeout checker
    └── provider/
        ├── CampayService.java
        ├── MtnMomoService.java
        └── OrangeMoneyService.java
```

---

## API Reference

### RFID Cards — `/api/rfid`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/rfid/register` | Register a new RFID card |
| `GET` | `/api/rfid/balance/{cardUid}?requiredAmount=1500` | Check balance (ESP32 calls this) |
| `POST` | `/api/rfid/debit` | Debit card and create transaction |
| `GET` | `/api/rfid/cards` | List all cards |
| `GET` | `/api/rfid/cards/{cardUid}` | Get single card |
| `PATCH` | `/api/rfid/cards/{cardUid}/activate` | Activate a card |
| `PATCH` | `/api/rfid/cards/{cardUid}/deactivate` | Deactivate a card |

### Mobile Money Payments — `/api/payments`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/payments/initiate` | Initiate a mobile money payment |
| `GET` | `/api/payments/transaction/{reference}` | Get transaction by reference |
| `GET` | `/api/payments/machine/{machineId}` | Transactions for a machine |
| `GET` | `/api/payments/card/{cardUid}` | Transactions for a card |
| `GET` | `/api/payments/providers/status` | Provider configuration status |

### Card Top-Up — `/api/topup`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/topup` | Initiate a top-up (mobile money or cash) |
| `GET` | `/api/topup/history/{cardUid}` | Top-up history for a card |

### Webhooks — `/api/webhook`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/webhook/campay` | CamPay payment callback |
| `POST` | `/api/webhook/mtn` | MTN MoMo payment callback |
| `POST` | `/api/webhook/orange` | Orange Money payment callback |

---

## RFID Flow (ESP32 Integration)

```
1. Customer taps RFID card on reader
2. ESP32 reads card UID (e.g. UID-4F2A)
3. ESP32 → GET /api/rfid/balance/UID-4F2A?requiredAmount=1500
4. Service responds: { balance: 3500, sufficient: true, message: "Solde = 3500 XAF — OK" }
5. ESP32 displays available programs
6. Customer selects program (e.g. Cotton 60° — 1500 XAF)
7. ESP32 → POST /api/rfid/debit  { cardUid, amount, machineId, pulseCount, cycleDuration }
8. Service debits card, creates SUCCESSFUL transaction
9. ESP32 sends START signal to machine (REQ-02)
```

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CAMPAY_APP_KEY` | CamPay application key | — |
| `CAMPAY_APP_SECRET` | CamPay application secret | — |
| `CAMPAY_WEBHOOK_SECRET` | CamPay webhook signing secret | — |
| `MTN_SUBSCRIPTION_KEY` | MTN MoMo subscription key | — |
| `MTN_API_USER_ID` | MTN MoMo API user ID | — |
| `MTN_API_KEY` | MTN MoMo API key | — |
| `ORANGE_CLIENT_ID` | Orange Money client ID | — |
| `ORANGE_CLIENT_SECRET` | Orange Money client secret | — |
| `ORANGE_MERCHANT_KEY` | Orange Money merchant key | — |

### application.yml (key settings)

```yaml
server:
  port: 8081

payment:
  currency: XAF
  timeout-minutes: 5
  pricing:
    short-cycle: 1000   # XAF for 30-min cycle
    long-cycle: 2000    # XAF for 60-min cycle
  campay:
    base-url: https://demo.campay.net   # use https://www.campay.net for production
  mtn:
    environment: sandbox                 # use 'production' for live
```

---

## Quick Start

### Prerequisites

- Java 17+
- Maven 3.8+

### Run (dev — H2 in-memory DB)

```bash
git clone https://github.com/GustaveDjoutsop/PaymentManagementService.git
cd PaymentManagementService
mvn spring-boot:run
```

Service starts on **http://localhost:8081**  
H2 console: **http://localhost:8081/h2-console**

### Run with PostgreSQL

```bash
# Override datasource via env vars
export SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:5432/paymentdb
export SPRING_DATASOURCE_USERNAME=youruser
export SPRING_DATASOURCE_PASSWORD=yourpassword
mvn spring-boot:run
```

### Build JAR

```bash
mvn clean package -DskipTests
java -jar target/payment-management-service-1.0.0.jar
```

---

## Related Projects

- [MachineStateService](https://github.com/GustaveDjoutsop/MachineStateService)
- [spring-bot-manager-only](https://github.com/GustaveDjoutsop/spring-bot-manager-only)
- [SmartLaundromatControlSystem](https://github.com/GustaveDjoutsop/SmartLaundromatControlSystem)

## License

MIT
