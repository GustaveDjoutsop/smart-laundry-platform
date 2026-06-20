# MachineStateService

Spring Boot microservice for the **SmartLaundromatControlSystem** ecosystem.  
Handles machine lifecycle, ESP32 MQTT telemetry, cycle monitoring, and command dispatch.

> Part of a 3-service architecture. See also:
> - [PaymentManagementService](https://github.com/GustaveDjoutsop/PaymentManagementService) — RFID cards & mobile money
> - [spring-bot-manager-only](https://github.com/GustaveDjoutsop/spring-bot-manager-only) — WhatsApp bot chat layer

---

## Features

- **Machine lifecycle management** — tracks IDLE → RUNNING → FINISHED → IDLE transitions
- **MQTT integration** — subscribes to ESP32 telemetry topics; publishes START/STOP/STATUS commands
- **HTTP telemetry fallback** — ESP32 can POST telemetry over HTTP if MQTT is unavailable
- **Cycle monitoring** — detects completed cycles (unlocks door), resets machines to IDLE after 5 min
- **Offline detection** — marks machines OFFLINE when heartbeat times out (default 120 s)
- **Event history** — logs every status change and command per machine
- **H2 in-memory DB** (dev) / **PostgreSQL** (production)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Java 17, Spring Boot 3.3.5 |
| Persistence | Spring Data JPA, H2 (dev), PostgreSQL (prod) |
| MQTT | Eclipse Paho MQTTv3 |
| Build | Maven |
| Utilities | Lombok, Jackson |

---

## Project Structure

```
src/main/java/com/smartlaundromat/machine/
├── config/
│   ├── MachineConfig.java          # Machine IDs, heartbeat timeout
│   └── MqttConfig.java             # Broker URL, topic prefix, QoS
├── controller/
│   ├── MachineController.java      # Machine state REST API
│   └── Esp32Controller.java        # HTTP telemetry + MQTT status
├── dto/                            # Request/response DTOs
├── exception/                      # Global error handling
├── model/
│   ├── Machine.java                # Machine entity (state + telemetry)
│   ├── MachineCycle.java           # Cycle records (start/end/status)
│   ├── MachineEvent.java           # Audit log per machine
│   └── enums/
│       ├── MachineStatus.java      # IDLE, RUNNING, FINISHED, ERROR, ...
│       ├── MachineType.java        # WASHER, DRYER
│       ├── CycleType.java          # NORMAL, COTTON_60, HEAVY, ...
│       └── CycleStatus.java        # NOT_STARTED, IN_PROGRESS, COMPLETED
├── mqtt/
│   └── MqttService.java            # Paho client, subscribe/publish
├── repository/                     # JPA repositories
└── service/
    ├── MachineService.java         # Telemetry processing, cycle start, status
    └── CycleMonitorService.java    # Scheduled monitors (cycle end, offline, reset)
```

---

## API Reference

### Machines — `/api/machines`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/machines` | All machines with summary counts |
| `GET` | `/api/machines/{machineId}` | Single machine status + remaining time |
| `GET` | `/api/machines/{machineId}/events` | Last 50 events (status changes, commands) |
| `GET` | `/api/machines/{machineId}/cycles` | Cycle history |
| `POST` | `/api/machines/start-cycle` | Start a wash/dry cycle (sends MQTT pulse) |
| `POST` | `/api/machines/{machineId}/command/{action}` | Send raw command: `stop`, `reset`, `status` |

#### `POST /api/machines/start-cycle` body

```json
{
  "machineId": "washer_01",
  "cycleType": "COTTON_60",
  "durationMinutes": 60,
  "pulseCount": 2,
  "rfidCardUid": "UID-4F2A",
  "transactionReference": "txn-abc123"
}
```

### ESP32 — `/api/esp32`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/esp32/telemetry` | HTTP telemetry (alternative to MQTT) |
| `GET` | `/api/esp32/mqtt/status` | MQTT broker connection health |

#### `POST /api/esp32/telemetry` body

```json
{
  "machineId": "washer_01",
  "status": "RUNNING",
  "cycleType": "COTTON_60",
  "cycleProgress": 45,
  "temperature": 60.0,
  "doorLocked": true,
  "spinSpeed": 1200
}
```

---

## Machine Lifecycle

```
 IDLE ──► RUNNING ──► FINISHED ──► IDLE (auto, after 5 min)
           │
           └──► ERROR      (ESP32 telemetry with errorCode)
           └──► OFFLINE    (heartbeat timeout > 120 s)
           └──► MAINTENANCE (manual command)
```

## Full Cycle Flow (RFID Path)

```
1. PaymentManagementService debits RFID card → returns pulseCount + cycleDuration
2. ESP32 (or bot) → POST /api/machines/start-cycle
3. MachineStateService:
   a. Validates machine is IDLE and available
   b. Creates MachineCycle record (IN_PROGRESS)
   c. Sets machine status → RUNNING, doorLocked → true
   d. Publishes MQTT command: { action: "pulse", count: 2 }
4. ESP32 receives MQTT pulse → starts motor → locks panel (REQ-01)
5. ESP32 sends telemetry every N seconds → MQTT topic or HTTP
6. CycleMonitorService (every 60 s) detects cycleEndsAt ≤ now
   a. MachineCycle → COMPLETED
   b. Machine status → FINISHED, doorLocked → false
7. Auto-reset: 5 min after FINISHED → IDLE
8. Customer retrieves laundry
```

---

## MQTT Topics

| Direction | Topic pattern | Description |
|-----------|--------------|-------------|
| Subscribe | `laundry/cameroon/+/telemetry` | Incoming telemetry from all ESP32s |
| Publish | `laundry/cameroon/{machineId}/command` | Commands to specific machine |

### Command payload format

```json
{ "action": "pulse", "count": 2 }
{ "action": "stop" }
{ "action": "status" }
{ "action": "reset" }
```

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MQTT_BROKER_URL` | MQTT broker address | `tcp://localhost:1883` |
| `MQTT_USERNAME` | Broker username | — |
| `MQTT_PASSWORD` | Broker password | — |

### application.yml (key settings)

```yaml
server:
  port: 8082

mqtt:
  broker-url: tcp://localhost:1883
  topic-prefix: laundry/cameroon
  qos: 1

machine:
  available-ids:
    - washer_01
    - washer_02
    - washer_03
    - washer_04
    - washer_05
    - washer_06
    - dryer_01
    - dryer_02
    - dryer_03
    - dryer_04
  heartbeat-timeout-seconds: 120
```

---

## Quick Start

### Prerequisites

- Java 17+
- Maven 3.8+
- MQTT broker (optional — service starts without it)

### Run (dev — H2 in-memory DB)

```bash
git clone https://github.com/GustaveDjoutsop/MachineStateService.git
cd MachineStateService
mvn spring-boot:run
```

Service starts on **http://localhost:8082**  
H2 console: **http://localhost:8082/h2-console**

All 10 machines (`washer_01–06`, `dryer_01–04`) are seeded automatically at startup.

### Run with a real MQTT broker

```bash
export MQTT_BROKER_URL=tcp://your-broker:1883
export MQTT_USERNAME=youruser
export MQTT_PASSWORD=yourpassword
mvn spring-boot:run
```

### Build JAR

```bash
mvn clean package -DskipTests
java -jar target/machine-state-service-1.0.0.jar
```

---

## Related Projects

- [PaymentManagementService](https://github.com/GustaveDjoutsop/PaymentManagementService)
- [spring-bot-manager-only](https://github.com/GustaveDjoutsop/spring-bot-manager-only)
- [SmartLaundromatControlSystem](https://github.com/GustaveDjoutsop/SmartLaundromatControlSystem)

## License

MIT
