# Integration Tests — PaymentManagementService

End-to-end integration tests written with **Python Robot Framework**.  
External payment provider APIs (CamPay, MTN MoMo, Orange Money) are mocked using **WireMock** so no real money moves during test runs.

---

## What Is Tested

| Suite | File | Covers |
|-------|------|--------|
| RFID Card Management | `01_rfid_card_tests.robot` | Register, balance check (sufficient/insufficient), debit, top-up via cash, deactivate/activate, 404 on unknown card |
| Mobile Money Payments | `02_payment_tests.robot` | Initiate CamPay / MTN / Orange payments (all routed through WireMock), provider status endpoint, retrieve transaction |
| Webhook Processing | `03_webhook_tests.robot` | CamPay SUCCESSFUL / FAILED callbacks, MTN & Orange callbacks, idempotency on duplicate webhooks, top-up confirmed via webhook |

### Mocked External Services (WireMock on port 9090)

| Stub file | Mocks |
|-----------|-------|
| `wiremock/mappings/campay_stubs.json` | `POST /api/token/`, `POST /api/collect/`, `GET /api/transaction/…` |
| `wiremock/mappings/mtn_stubs.json` | `POST /collection/token/`, `POST /collection/v1_0/requesttopay` |
| `wiremock/mappings/orange_stubs.json` | `POST /oauth/v3/token`, `POST /orange-money-webpay/dev/v1/webpayment` |

---

## Project Structure

```
integration-tests/
├── README.md
├── requirements.txt              # Python / Robot Framework dependencies
├── wiremock/
│   └── mappings/
│       ├── campay_stubs.json
│       ├── mtn_stubs.json
│       └── orange_stubs.json
└── tests/
    ├── resources/
    │   └── variables.robot       # Base URL, test card UIDs, amounts, etc.
    ├── keywords/
    │   └── common.robot          # Reusable keywords (Register Card, Debit, etc.)
    └── suites/
        ├── 01_rfid_card_tests.robot
        ├── 02_payment_tests.robot
        └── 03_webhook_tests.robot
```

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Python | 3.10+ | [python.org](https://python.org) |
| Docker | 20+ | [docker.com](https://docker.com) — needed for WireMock |
| Java | 17+ | [adoptium.net](https://adoptium.net) |
| Maven | 3.8+ | [maven.apache.org](https://maven.apache.org) |

---

## Running Locally (step-by-step)

### 1. Install Python dependencies

```bash
cd integration-tests
pip install -r requirements.txt
```

### 2. Start WireMock

```bash
docker run -d \
  --name wiremock \
  -p 9090:8080 \
  -v $(pwd)/wiremock:/home/wiremock \
  wiremock/wiremock:3.10.0 --verbose
```

Verify it loaded the stubs:

```bash
curl http://localhost:9090/__admin/mappings
```

### 3. Build and start PaymentManagementService

From the project root:

```bash
mvn clean package -DskipTests

java -jar target/payment-management-service-*.jar \
  --server.port=8081 \
  --payment.campay.base-url=http://localhost:9090 \
  --payment.campay.app-key=test-key \
  --payment.campay.app-secret=test-secret \
  --payment.campay.webhook-secret=test-webhook-secret \
  --payment.mtn.api-url=http://localhost:9090 \
  --payment.mtn.subscription-key=test-sub-key \
  --payment.mtn.api-user-id=test-user \
  --payment.mtn.api-key=test-api-key \
  --payment.orange.api-url=http://localhost:9090 \
  --payment.orange.client-id=test-client \
  --payment.orange.client-secret=test-secret \
  --payment.orange.merchant-key=test-merchant
```

Wait until you see: `Started PaymentManagementServiceApplication`

### 4. Run the tests

```bash
# All suites
robot --outputdir results integration-tests/tests/suites/

# Single suite
robot --outputdir results integration-tests/tests/suites/01_rfid_card_tests.robot

# Filter by tag
robot --outputdir results --include smoke integration-tests/tests/suites/
```

### 5. View results

Open `results/report.html` in a browser.

### 6. Cleanup

```bash
docker stop wiremock && docker rm wiremock
```

---

## Tags Reference

| Tag | Meaning |
|-----|---------|
| `smoke` | Core happy-path tests — run these first |
| `rfid` | RFID card tests |
| `payment` | Mobile money payment tests |
| `webhook` | Provider callback tests |
| `campay` | CamPay-specific |
| `mtn` | MTN MoMo-specific |
| `orange` | Orange Money-specific |
| `negative` | Expected-failure scenarios |
| `idempotency` | Tests for duplicate-safe behavior |

---

## CI Integration

The integration tests run automatically on every pull request as the **`integration-test`** job, which:

1. Waits for **`sonar`** to pass first
2. Starts WireMock in Docker
3. Builds the JAR and starts the service
4. Runs all Robot Framework suites
5. Uploads `report.html`, `log.html`, and JUnit XML to GitHub Actions artifacts

See `.github/workflows/pull-request.yml` for the full configuration.
