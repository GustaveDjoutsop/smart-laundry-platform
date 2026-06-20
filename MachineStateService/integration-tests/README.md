# Integration Tests — MachineStateService

End-to-end integration tests written with **Python Robot Framework**.  
A real **Mosquitto MQTT broker** runs in Docker so MQTT command dispatch is verified end-to-end. No WireMock is needed here because MachineStateService does not call external HTTP APIs.

---

## What Is Tested

| Suite | File | Covers |
|-------|------|--------|
| Machine Status | `01_machine_status_tests.robot` | Auto-seeded machines at startup, listing all washers/dryers, single machine status, 404 for unknown machine |
| Cycle Management | `02_cycle_tests.robot` | Start cycle → machine becomes RUNNING, door locked, MQTT command sent; conflict on busy machine (409); unknown machine (404); stop/status commands |
| Telemetry Ingestion | `03_telemetry_tests.robot` | HTTP telemetry updates machine state; RUNNING/IDLE/ERROR transitions; events logged on status change; MQTT status endpoint |

### Infrastructure Used

| Component | Role |
|-----------|------|
| **Mosquitto MQTT** (Docker, port 1883) | Real broker so MQTT `pulse` commands are actually published |
| **H2 in-memory DB** | Auto-configured by Spring Boot in test — no PostgreSQL needed |

---

## Project Structure

```
integration-tests/
├── README.md
├── requirements.txt              # Python / Robot Framework dependencies
└── tests/
    ├── resources/
    │   └── variables.robot       # Base URL, machine IDs, cycle params
    ├── keywords/
    │   └── common.robot          # Reusable keywords (Start Cycle, Post Telemetry, etc.)
    └── suites/
        ├── 01_machine_status_tests.robot
        ├── 02_cycle_tests.robot
        └── 03_telemetry_tests.robot
```

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Python | 3.10+ | [python.org](https://python.org) |
| Docker | 20+ | [docker.com](https://docker.com) — needed for Mosquitto |
| Java | 17+ | [adoptium.net](https://adoptium.net) |
| Maven | 3.8+ | [maven.apache.org](https://maven.apache.org) |

---

## Running Locally (step-by-step)

### 1. Install Python dependencies

```bash
cd integration-tests
pip install -r requirements.txt
```

### 2. Start Mosquitto MQTT broker

```bash
docker run -d \
  --name mosquitto \
  -p 1883:1883 \
  eclipse-mosquitto:2.0 \
  mosquitto -c /mosquitto-no-auth.conf
```

### 3. Build and start MachineStateService

From the project root:

```bash
mvn clean package -DskipTests

java -jar target/machine-state-service-*.jar \
  --server.port=8082 \
  --mqtt.broker-url=tcp://localhost:1883
```

Wait until you see: `Started MachineStateServiceApplication` and all 10 machines seeded.

Verify:

```bash
curl http://localhost:8082/api/machines | python3 -m json.tool
# Expect: {"total": 10, ...}
```

### 4. Run the tests

```bash
# All suites
robot --outputdir results integration-tests/tests/suites/

# Only smoke tests
robot --outputdir results --include smoke integration-tests/tests/suites/

# Single suite
robot --outputdir results integration-tests/tests/suites/02_cycle_tests.robot
```

### 5. View results

Open `results/report.html` in a browser.

### 6. Cleanup

```bash
docker stop mosquitto && docker rm mosquitto
```

---

## Tags Reference

| Tag | Meaning |
|-----|---------|
| `smoke` | Core happy-path — always run these |
| `machine` | Machine status / listing tests |
| `cycle` | Cycle start / stop / conflict tests |
| `telemetry` | ESP32 telemetry ingestion tests |
| `esp32` | ESP32-specific endpoint tests |
| `mqtt` | MQTT-related tests |
| `events` | Machine event log tests |
| `negative` | Expected-failure scenarios |

---

## Machine IDs Seeded at Startup

The service auto-seeds the following machine IDs on first start:

| Type | IDs |
|------|-----|
| Washer | `washer_01` … `washer_06` |
| Dryer | `dryer_01` … `dryer_04` |

The tests rely on these IDs being present. If you change `machine.available-ids` in `application.yml`, update `variables.robot` accordingly.

---

## CI Integration

The integration tests run automatically on every pull request as the **`integration-test`** job, which:

1. Waits for **`sonar`** to pass first
2. Starts Mosquitto in Docker
3. Builds the JAR and starts the service
4. Runs all Robot Framework suites
5. Uploads `report.html`, `log.html`, and JUnit XML to GitHub Actions artifacts

See `.github/workflows/pull-request.yml` for the full configuration.
