# Modbus RTU Gateway — Local Simulator (WireMock)

A **WireMock** instance that simulates the **serial↔HTTP Modbus gateway bridge** so the
6 Modbus-only machines can run on localhost without real RS485 hardware.

Protocol source: `SX174003A communication protocol-20260113.xlsx`.

---

## What is simulated

`MachineStateService` builds a Modbus **RTU frame** (function `0x10` write / `0x03` read),
computes its **CRC16**, and POSTs it as hex to the gateway:

```
POST http://localhost:9090/modbus/rtu
{ "unitId": 1, "function": 16, "frameHex": "01 10 04 79 00 01 02 00 01 29 F9" }
```

The mock matches on the `function` field (and, for reads, on the register address inside
`frameHex`) and returns a CRC-valid reply:

| Request | Match | Reply |
|---------|-------|-------|
| Write `0x10` (start / coins / program / stop) | `function == 16` | write-acknowledgement, `success=true` |
| Read `0x03` monitor block (`0x048C`, 20 regs) | `function == 3` | IDLE monitor block (status=1, door=2) |
| Read `0x03` alarm/IO block (`0x04B4`, 7 regs)  | `function == 3` + frame contains `04 B4` | all-clear block |

---

## Modbus-only machines

| Internal ID | Slave address | Type |
|-------------|---------------|------|
| `washer_07` | 1 | Washer |
| `washer_08` | 2 | Washer |
| `washer_09` | 3 | Washer |
| `dryer_05`  | 4 | Dryer  |
| `dryer_06`  | 5 | Dryer  |
| `dryer_07`  | 6 | Dryer  |

Mapping lives in `ci/dev.yaml` under `modbus.unit-id-mapping`.

---

## Register map (SX174003A)

**Write (function `0x10`)** — `4Xnnnn` PLC address → wire address `PLC − 1`:

| PLC | Wire | Purpose |
|-----|------|---------|
| 4X1145 | 0x0478 | Reset alarm & silence |
| 4X1146 | 0x0479 | Start the machine |
| 4X1147 | 0x047A | Next step while running |
| 4X1148 | 0x047B | Forced stop |
| 4X1149 | 0x047C | Input number of coins |
| 4X1150 | 0x047D | Select program (0–3) |
| 4X1151 | 0x047E | Save parameters |
| 4X1152 | 0x047F | Save program data |
| 4X1153 | 0x0480 | Read auto-program number |

**Read (function `0x03`)**:

| PLC | Wire | Length | Purpose |
|-----|------|--------|---------|
| 5X1165 | 0x048C | 20 | Monitor data block |
| 5X1205 | 0x04B4 | 7  | Alarms/warnings + IO status |

**Start sequence:** select-program (`0x047D`) → input-coins (`0x047C`) → start (`0x0479`).

---

## Quick start

```bash
# 1. Start the gateway simulator
docker compose -f modbus-mock/docker-compose.yml up -d

# 2. Health check
curl http://localhost:9090/__admin/health

# 3. Manually exercise a start write (slave 1)
curl -s http://localhost:9090/modbus/rtu \
  -H "Content-Type: application/json" \
  -d '{"unitId":1,"function":16,"frameHex":"01 10 04 79 00 01 02 00 01 29 F9"}'

# 4. Read the monitor block (slave 1)
curl -s http://localhost:9090/modbus/rtu \
  -H "Content-Type: application/json" \
  -d '{"unitId":1,"function":3,"frameHex":"01 03 04 8C 00 14 85 1E"}'
```

`ci/dev.yaml` already points `modbus.gateway-url` at `http://localhost:9090`, so once
the container is up, starting a cycle on `washer_07`–`dryer_07` flows through this mock.

---

## File structure

```
modbus-mock/
├── README.md
├── docker-compose.yml                ← WireMock gateway on port 9090
└── mappings/
    ├── 10_write_register_ack.json    ← function 0x10 write acknowledgement
    ├── 20_read_alarm_io.json         ← function 0x03 alarm/IO block (0x04B4)
    └── 30_read_monitor_idle.json     ← function 0x03 monitor block (0x048C), IDLE
```
