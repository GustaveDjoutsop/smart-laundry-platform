# EQLink WireMock — Local Machine Simulator

A **WireMock** instance that simulates the [EQLink Open API v2](https://tokyo.anlun.vip/pages/v3/admin/#/open/tools/index) so the full SmartLaundromat stack can run on localhost without real hardware.

---

## What is simulated

All 10 machines are stubbed with **stateful scenarios**. Each machine independently transitions between two states:

| State | Meaning |
|-------|---------|
| `Started` (default) | Machine is **IDLE** — `available=1`, `cycle_start=0` |
| `Running` | Machine is **RUNNING** — `available=0`, `cycle_start=1`, `remain_time=1200` |

All 6 EQLink API v2 endpoints are stubbed:

| Endpoint | Behaviour |
|----------|-----------|
| `POST /api/open/v2/Device/get_device_list` | Returns all 10 mock machines, all ONLINE |
| `POST /api/open/v2/Device/iot_check_dev_status` | Returns IDLE or RUNNING per machine (scenario-aware) |
| `POST /api/open/v2/Device/iot_start_device` | IDLE → 200 success + transitions to RUNNING; already RUNNING → 406 timeout |
| `POST /api/open/v2/Device/bt_start_device` | Returns a mock BT command string |
| `POST /api/open/v2/Device/bt_get_coinbox_cmd` | Returns mock coinbox BT command |
| `POST /api/open/v2/Device/bt_get_network_cmd` | Returns mock network config BT command |

---

## Mock machine device names

| Internal ID | EQLink `devicename` | Type |
|-------------|---------------------|------|
| `washer_01` | `MOCK-W01` | Washer |
| `washer_02` | `MOCK-W02` | Washer |
| `washer_03` | `MOCK-W03` | Washer |
| `washer_04` | `MOCK-W04` | Washer |
| `washer_05` | `MOCK-W05` | Washer |
| `washer_06` | `MOCK-W06` | Washer |
| `dryer_01`  | `MOCK-D01` | Dryer  |
| `dryer_02`  | `MOCK-D02` | Dryer  |
| `dryer_03`  | `MOCK-D03` | Dryer  |
| `dryer_04`  | `MOCK-D04` | Dryer  |

`vend_price = 10` for all machines. `total_amt = pulse_count × 10`.

---

## Prerequisites

- Docker (for WireMock)
- Java 17+ and Maven (for MachineStateService)

---

## Quick start

### 1. Start the WireMock simulator

```bash
docker compose -f eqlink-mock/docker-compose.yml up -d
```

Verify it's running (should show all 10 machines):

```bash
curl -s http://localhost:9099/api/open/v2/Device/get_device_list \
  -H "Content-Type: application/json" \
  -d '{"vendor_id":"MOCK","app_id":"MOCK","sign":"MOCK"}' | python3 -m json.tool
```

### 2. Start MachineStateService with the dev config

The `ci/dev.yaml` is pre-configured to point to the WireMock on port 9099:

```bash
java -jar target/machine-state-service-*.jar \
  --spring.config.additional-location=file:./ci/dev.yaml \
  --server.port=8082
```

Or with Maven:

```bash
mvn spring-boot:run \
  -Dspring-boot.run.arguments="--spring.config.additional-location=file:./ci/dev.yaml"
```

### 3. Verify machines appear in MachineStateService

```bash
curl http://localhost:8082/api/machines | python3 -m json.tool
```

You should see all 10 machines as `IDLE`.

---

## Starting a machine (full flow simulation)

### Via MachineStateService REST API

```bash
curl -s -X POST http://localhost:8082/api/machines/start-cycle \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-auth0-token>" \
  -d '{
    "machineId": "washer_01",
    "cycleType": "NORMAL",
    "durationMinutes": 30,
    "pulseCount": 1,
    "rfidCardUid": "UID-TEST-001",
    "transactionReference": "txn-test-001"
  }'
```

**What happens:**
1. MachineStateService calls `iot_check_dev_status` → WireMock returns IDLE (vend_price=10)
2. MachineStateService calls `iot_start_device` with `total_amt=10` → WireMock returns 200 success
3. WireMock transitions washer_01's scenario from `Started` → `Running`
4. MachineStateService also sends an MQTT pulse to the local broker (if running)
5. Database: `washer_01` status = `RUNNING`

### Check the machine is now RUNNING

```bash
curl http://localhost:8082/api/machines/washer_01 | python3 -m json.tool
# status: "RUNNING"

# Verify WireMock scenario state:
curl http://localhost:9099/__admin/scenarios | python3 -m json.tool
```

---

## Resetting machine states

### Reset all machines to IDLE

```bash
bash eqlink-mock/scripts/reset-all-machines.sh
```

### Reset a single machine to IDLE

```bash
bash eqlink-mock/scripts/reset-machine.sh washer_01
```

### Show current state of all machines

```bash
bash eqlink-mock/scripts/show-machine-states.sh
```

### Reset via WireMock admin API directly

```bash
# Reset all scenarios at once
curl -X POST http://localhost:9099/__admin/scenarios/reset

# Reset a specific machine scenario
curl -X PUT \
  -H "Content-Type: application/json" \
  -d '{"state":"Started"}' \
  http://localhost:9099/__admin/scenarios/machine-washer_01/state
```

---

## Authentication (MD5 signature)

The mock **does not verify the signature** — it accepts any `vendor_id`, `app_id`, and `sign`. This lets you focus on testing the business logic.

The `ci/dev.yaml` sets dummy credentials:
```yaml
eqlink:
  vendor-id: "MOCK-VENDOR-001"
  app-id:    "MOCK-APP-ID-001"
  secret-key: "MOCK-SECRET-KEY-001"
```

`EqLinkSignatureUtil` still runs its full MD5 computation — you'll see the computed sign in the DEBUG logs, confirming the algorithm is wired correctly.

---

## Switching to a real EQLink server

When real hardware is available, replace these values in `ci/dev.yaml` (or use env vars on staging/prod):

```yaml
eqlink:
  base-url: https://tokyo.anlun.vip    # real EQLink server
  vendor-id: "100068"                   # from EQLink admin
  app-id: "eql7129..."                  # from EQLink admin
  secret-key: "YOUR_REAL_SECRET_KEY"    # from EQLink admin
  wifi-ssid: "YourWiFiSSID"             # your laundromat's WiFi name
  device-name-mapping:
    washer_01: "NYJ312007A100130896"    # real serial from get_device_list
    washer_02: "NYJ312007A100130849"
    # ...
```

Contact EQLink support to get your credentials:
- 📞 +86 186 5325 0609
- 📧 admin@eqlink.top

---

## WireMock admin endpoints

| URL | Purpose |
|-----|---------|
| `GET  http://localhost:9099/__admin/health` | Health check |
| `GET  http://localhost:9099/__admin/scenarios` | List all machine scenarios + their states |
| `POST http://localhost:9099/__admin/scenarios/reset` | Reset ALL scenarios to IDLE |
| `GET  http://localhost:9099/__admin/mappings` | List all 44 stub mappings |

---

## File structure

```
eqlink-mock/
├── README.md                         ← this file
├── docker-compose.yml                ← WireMock on port 9099
├── scripts/
│   ├── reset-all-machines.sh         ← reset all 10 to IDLE
│   ├── reset-machine.sh              ← reset one machine to IDLE
│   └── show-machine-states.sh        ← display current IDLE/RUNNING states
└── mappings/
    ├── 00_get_device_list.json       ← returns all 10 mock devices
    ├── {machine}_check_idle.json     ← 10 × check-status IDLE response
    ├── {machine}_check_running.json  ← 10 × check-status RUNNING response
    ├── {machine}_start_idle.json     ← 10 × start success (IDLE→RUNNING)
    ├── {machine}_start_busy.json     ← 10 × start timeout 406 (already RUNNING)
    ├── 98_invalid_signature.json     ← 400 error for missing credentials
    ├── 99_bt_start_device.json       ← BT command mock (any machine)
    ├── 99_bt_get_coinbox_cmd.json    ← coinbox BT command mock
    └── 99_bt_get_network_cmd.json    ← network config BT command mock
```
