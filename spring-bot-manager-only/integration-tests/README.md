# Integration Tests — spring-bot-manager-only

End-to-end integration tests written with **Python Robot Framework**.
Three **WireMock** instances mock the external dependencies so the bot''s full
conversation engine, webhook routing, and microservice delegation are tested
without needing live Meta, PaymentManagementService, or MachineStateService instances.

---

## What Is Tested

| Suite | File | Covers |
|-------|------|--------|
| WhatsApp Webhooks | `01_whatsapp_webhook_tests.robot` | Webhook verification (GET challenge), inbound text messages, button replies, invalid token rejection |
| Payment Flow | `02_payment_flow_tests.robot` | CamPay/MTN/Orange webhook forwarding through the bot gateway, transaction retrieval |
| Machine Availability | `03_machine_availability_tests.robot` | Machine listing proxy, available machines filtering, single machine status proxy |

### WireMock Instances

| Port | Mocks | Stub folder |
|------|-------|-------------|
| **9090** | Meta WhatsApp Graph API (send messages) | `wiremock/meta/mappings/` |
| **9091** | PaymentManagementService REST API | `wiremock/payment/mappings/` |
| **9092** | MachineStateService REST API | `wiremock/machine/mappings/` |

---

## Project Structure

```
integration-tests/
├── README.md
├── requirements.txt
├── wiremock/
│   ├── meta/mappings/
│   │   └── whatsapp_stubs.json       # Meta Graph API stubs
│   ├── payment/mappings/
│   │   └── payment_service_stubs.json
│   └── machine/mappings/
│       └── machine_service_stubs.json
└── tests/
    ├── resources/
    │   └── variables.robot
    ├── keywords/
    │   └── common.robot
    └── suites/
        ├── 01_whatsapp_webhook_tests.robot
        ├── 02_payment_flow_tests.robot
        └── 03_machine_availability_tests.robot
```

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Python | 3.10+ | [python.org](https://python.org) |
| Docker | 20+ | [docker.com](https://docker.com) |
| Java | 21+ | [adoptium.net](https://adoptium.net) |
| Maven | 3.8+ | [maven.apache.org](https://maven.apache.org) |
| PostgreSQL | 14+ | Required by bot-app (or use H2 override — see below) |
| Redis | 6+ | Optional — service falls back to in-memory |

---

## Running Locally (step-by-step)

### 1. Install Python dependencies

```bash
cd integration-tests
pip install -r requirements.txt
```

### 2. Start the three WireMock instances

```bash
# Meta WhatsApp API
docker run -d --name wiremock-meta \
  -p 9090:8080 \
  -v $(pwd)/wiremock/meta:/home/wiremock \
  wiremock/wiremock:3.10.0

# PaymentManagementService mock
docker run -d --name wiremock-payment \
  -p 9091:8080 \
  -v $(pwd)/wiremock/payment:/home/wiremock \
  wiremock/wiremock:3.10.0

# MachineStateService mock
docker run -d --name wiremock-machine \
  -p 9092:8080 \
  -v $(pwd)/wiremock/machine:/home/wiremock \
  wiremock/wiremock:3.10.0
```

Verify stubs loaded:

```bash
curl http://localhost:9090/__admin/mappings | python3 -m json.tool
curl http://localhost:9091/__admin/mappings | python3 -m json.tool
curl http://localhost:9092/__admin/mappings | python3 -m json.tool
```

### 3. Build and start the bot service

```bash
# Build
mvn clean package -DskipTests -pl bot-app -am

# Run with H2 (no PostgreSQL needed locally)
export SPRING_FLYWAY_ENABLED=false
export SPRING_JPA_HIBERNATE_DDL_AUTO=create-drop
export DATABASE_URL=jdbc:h2:mem:integrationtestdb;DB_CLOSE_DELAY=-1;MODE=PostgreSQL
export DATABASE_USERNAME=sa
export DATABASE_PASSWORD=
export JWT_SECRET=integration-test-secret-must-be-at-least-32-chars
export WHATSAPP_VERIFY_SIGNATURE=false
export WHATSAPP_API_BASE=http://localhost:9090
export PAYMENT_SERVICE_URL=http://localhost:9091
export MACHINE_STATE_SERVICE_URL=http://localhost:9092

java -jar bot-app/target/bot-app-*.jar --server.port=8090
```

### 4. Add a bot configuration

Create `configs/bots/laundry.bot.json` (or wherever `BOT_CONFIG_DIRECTORY` points):

```json
{
  "botId": "laundry",
  "botName": "Smart Laundry IT",
  "botType": "laundry",
  "phoneNumberId": "123456789",
  "verifyToken": "test-verify-token",
  "shortCycle": { "duration": 30, "price": 1000, "pulseCount": 1 },
  "longCycle":  { "duration": 60, "price": 2000, "pulseCount": 2 },
  "businessHours": {
    "openTime": "00:00",
    "closeTime": "23:59",
    "closingBufferMinutes": 0,
    "timezone": "Africa/Douala"
  }
}
```

### 5. Run the tests

```bash
# All suites
robot --outputdir results \
      --variable BOT_ID:laundry \
      --variable VERIFY_TOKEN:test-verify-token \
      integration-tests/tests/suites/

# Single suite
robot --outputdir results \
      integration-tests/tests/suites/01_whatsapp_webhook_tests.robot

# By tag
robot --outputdir results --include smoke integration-tests/tests/suites/
```

### 6. View results

Open `results/report.html` in a browser.

### 7. Cleanup

```bash
docker stop wiremock-meta wiremock-payment wiremock-machine
docker rm wiremock-meta wiremock-payment wiremock-machine
```

---

## Tags Reference

| Tag | Meaning |
|-----|---------|
| `smoke` | Core happy-path — always run |
| `whatsapp` | WhatsApp webhook tests |
| `conversation` | Flow engine / conversation tests |
| `payment` | Payment gateway / webhook forwarding |
| `machine` | Machine proxy tests |
| `proxy` | Tests that verify microservice proxying |
| `negative` | Expected-failure scenarios |
| `verification` | WhatsApp webhook challenge tests |

---

## How WireMock Works Here

The service is started with environment variables that point its external HTTP clients
to the WireMock instances instead of real services:

```
WHATSAPP_API_BASE       → http://localhost:9090  (Meta WireMock)
PAYMENT_SERVICE_URL     → http://localhost:9091  (PaymentManagementService WireMock)
MACHINE_STATE_SERVICE_URL → http://localhost:9092 (MachineStateService WireMock)
```

When the bot receives a WhatsApp inbound message and needs to send a reply, it POSTs
to `http://localhost:9090/v20.0/{phoneNumberId}/messages` — which WireMock intercepts
and returns a canned 200 response. The test verifies the bot returned 200 without
needing a real WhatsApp account.

---

## CI Integration

The integration tests run automatically on every pull request as the **`integration-test`** job, which:

1. Waits for **`sonar`** to pass first
2. Starts three WireMock containers in Docker
3. Builds the multi-module JAR
4. Starts spring-bot-manager-only pointed at WireMock
5. Runs all Robot Framework suites
6. Uploads `report.html`, `log.html`, and JUnit XML to GitHub Actions artifacts

See `.github/workflows/pull-request.yml` for the full configuration.
