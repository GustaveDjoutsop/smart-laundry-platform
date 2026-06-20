# MachineStateService

## What This Is
Owns **machine lifecycle, ESP32 MQTT telemetry, and cycle monitoring** for the
SmartLaundromatControlSystem. Java 17 / Spring Boot 3.3.5, port 8082. H2 (dev)
/ PostgreSQL (prod). Eclipse Paho MQTTv3 client.

**Sibling services:**
- `PaymentManagementService` (:8081) — calls `POST /api/machines/start-cycle`
  here after successful payment (fire-and-forget from their side — treat
  this endpoint as needing to be idempotent and fast/reliable, since it's
  the only signal they get)
- `spring-bot-manager-only` (:8090) — reads machine availability via proxied
  `/api/machines/*` endpoints; creates reservations via `POST /api/reservations`

## Hardware Integration — Modbus (independent of migration plan)
This service exposes **Modbus RTU via a feature-flagged serial↔HTTP
gateway** and **EQLink Open API v2 (MD5-signed)**, in addition to MQTT.
This is very likely where `ModbusWasherClient.java` for the Alice hardware
(register map SX174003A, write registers 4X1145–4X1152, read register
5X1165) belongs — check this gateway's interface before building a separate
client. This work can proceed in parallel with the P0–P7 migration; it's
orthogonal.

## 🔴 Open from architecture review (2026-06-13)
- **Migration plan** — see root `CLAUDE.md` and
  `architecture-review/03-MIGRATION-TODO.md`. This service's `start-cycle`
  endpoint correctly requires `SCOPE_sls-machine-start`; PaymentManagementService
  calls it with no Authorization header (P0 — fix on PMS side, don't weaken
  this endpoint's scope requirement to compensate).
- Uses `ddl-auto: update`, not Flyway — `machinedb` schema drift risk.
  **P3 fixes this**: Flyway baseline migrations + `ddl-auto: validate`,
  retarget at the Supabase `machine` schema.
- Review flags this service as **overloaded** (W12: device control +
  lifecycle + reservations, low cohesion). ADR-001/P7 lists an *optional*
  future split into a `DeviceGatewayService` (MQTT/Modbus/EQLink adapter),
  leaving this service as lifecycle/domain owner — optional, scale-triggered,
  not part of the core P0–P6 path. Don't preemptively split unless asked.
- **Target (ADR-001 as revised, A4)**: `machinedb` → `machine` schema on the
  shared Supabase project (P3) — `machines`, `cycles`, `reservations` carry
  over via `pg_dump`/`pg_restore` largely unchanged (JPA entities stay).
  `machine_events`/`telemetry` convert to **range-partitioned tables** (by
  timestamp) with a `pg_cron` retention job — Postgres-native equivalent of
  the originally-proposed Mongo time-series collections. This service
  becomes the **consumer side of P4's outbox pattern**: subscribes to
  `PaymentSucceeded` via Supabase Realtime/`pg_notify`, consumes idempotently
  via an `idempotency_keys` table (keyed on `transactionReference`,
  `expires_at` + `pg_cron` cleanup), then publishes `CycleCompleted` for the
  Reporting BFF (P5).
- Of the three services, this one's telemetry data was the strongest
  argument *for* the original Mongo proposal — but range-partitioned
  Postgres tables (or TimescaleDB hypertables if the Supabase tier supports
  the extension) cover the same access pattern (high-volume time-series
  writes, TTL/retention, range queries) without a second database engine.
  `machines`/`cycles`/`reservations` are more naturally relational
  (reservation → machine FK) and were always a better Postgres fit.

## Project Structure
```
config/   MachineConfig (machine IDs, heartbeat timeout), MqttConfig (broker, topic prefix, QoS)
controller/ MachineController (state API), Esp32Controller (HTTP telemetry + MQTT status)
model/    Machine (state+telemetry), MachineCycle, MachineEvent (audit log), enums
          MachineStatus: IDLE, RUNNING, FINISHED, ERROR, OFFLINE, MAINTENANCE
          MachineType: WASHER, DRYER
          CycleType: NORMAL, COTTON_60, HEAVY, ...
          CycleStatus: NOT_STARTED, IN_PROGRESS, COMPLETED
mqtt/     MqttService — Paho client, subscribe/publish
service/  MachineService (telemetry processing, cycle start, status)
          CycleMonitorService (scheduled: cycle end, offline detection, auto-reset)
```

## Machine Lifecycle
```
IDLE → RUNNING → FINISHED → IDLE (auto, 5 min after FINISHED)
RUNNING → ERROR     (ESP32 telemetry reports errorCode)
ANY → OFFLINE       (heartbeat timeout > 120s, configurable)
ANY → MAINTENANCE   (manual command)
```

## MQTT
| Direction | Topic | Description |
|---|---|---|
| Subscribe | `laundry/cameroon/+/telemetry` | All ESP32 telemetry |
| Publish | `laundry/cameroon/{machineId}/command` | Commands to one machine |

Commands: `{"action":"pulse","count":N}`, `stop`, `status`, `reset`.
HTTP telemetry (`POST /api/esp32/telemetry`) is the fallback when MQTT is
unavailable — **the service must handle both paths producing the same state
transitions**. If you change telemetry processing, change it in
`MachineService` once, called from both `MqttService` and `Esp32Controller`,
not duplicated.

## Full Cycle Flow (mobile money / WhatsApp path)
```
1. PaymentManagementService → POST /api/machines/start-cycle
   {machineId, cycleType, durationMinutes, pulseCount, rfidCardUid?, transactionReference}
2. Validate machine IDLE + available
3. Create MachineCycle (IN_PROGRESS), Machine → RUNNING, doorLocked → true
4. Publish MQTT {"action":"pulse","count":N}
5. ESP32: pulse → starts motor → locks panel
6. ESP32 sends telemetry periodically
7. CycleMonitorService (every 60s): cycleEndsAt ≤ now →
   MachineCycle → COMPLETED, Machine → FINISHED, doorLocked → false
8. Auto-reset 5 min after FINISHED → IDLE
```

### ⚠️ Idempotency requirement on `start-cycle`
PaymentManagementService calls this fire-and-forget and doesn't track
whether it succeeded. If retried (by PMS or an operator) for the same
`transactionReference`, **this endpoint must not double-pulse a running
machine**. Check: does it currently reject/no-op if `transactionReference`
already has an `IN_PROGRESS` `MachineCycle`? If not, that's a real bug —
a retry could pulse the motor twice mid-cycle.

## Reservation Flow
- `POST /api/reservations` → returns `RES-XXXXXX`, fee (= `reservation.fee-amount`,
  must match bot's `longCycle.price` = 2000 XAF), 1-hour slot (fixed length)
- PENDING → ACTIVE on payment webhook (via PaymentManagementService)
- `start-cycle {reservationCode}` → `validateAndConsume(code, machine)` → USED
- **Authorization is code+machine, not user-bound** — anyone with the code
  for that specific machine can start it within the slot. This is
  intentional (WhatsApp-shareable codes) but means: don't log codes in
  plaintext anywhere, and `validateAndConsume` must be atomic (no
  double-spend of the same code on concurrent requests).

## API Reference
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/machines` | All machines + summary counts |
| GET | `/api/machines/{id}` | Status + remaining time |
| GET | `/api/machines/{id}/events` | Last 50 events |
| GET | `/api/machines/{id}/cycles` | Cycle history |
| POST | `/api/machines/start-cycle` | Start cycle (MQTT pulse) |
| POST | `/api/machines/{id}/command/{action}` | stop / reset / status |
| POST | `/api/esp32/telemetry` | HTTP telemetry fallback |
| GET | `/api/esp32/mqtt/status` | MQTT broker health |
| POST | `/api/reservations` | Create reservation |

## Tech Stack
- Java 17, Spring Boot 3.3.5, Spring Data JPA, Lombok, Jackson
- H2 (dev, seeded with washer_01–06, dryer_01–04) / PostgreSQL (prod)
- Eclipse Paho MQTTv3

## Critical Rules
- `start-cycle` is the single most important endpoint for cross-service
  correctness — see idempotency note above. Any change here needs a test for
  the duplicate-call case.
- MQTT broker URL defaults to `tcp://localhost:1883` (no TLS) — fine for
  local dev, **must be `ssl://` + 8883 with auth in production** per the
  workspace-wide MQTT security rule.
- Heartbeat timeout (120s default) and auto-reset (5 min) are business-tunable
  — if changed, confirm with the operational reality (does 5 min give
  customers enough time to clear the machine before next booking?).
- `available-ids` list in `application.yml` is the source of truth for which
  machines exist — adding a physical machine means updating this list AND
  the DB seed, not just one.

## Local Dev
```bash
mvn spring-boot:run   # H2, port 8082, console at /h2-console, machines auto-seeded
# With real broker:
export MQTT_BROKER_URL=tcp://your-broker:1883
export MQTT_USERNAME=... MQTT_PASSWORD=...
```
