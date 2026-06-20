# MachineStateService — Communication Flow

Port **8082** · OAuth2 Resource Server (Auth0 JWT) · H2 (dev) / PostgreSQL (prod)

MachineStateService is the **machine-control hub**. It receives a `start-cycle` request
(usually from PaymentManagementService after a successful payment) and decides *how* to
physically start the machine: **Modbus RTU**, **EQLink Open API v2**, or **MQTT** — always
firing an MQTT pulse as a safety net. It also owns the **reservation** mechanism.

---

## 1. System context

```mermaid
graph LR
    Bot[spring-bot-manager<br/>:8090] -->|initiate payment| Pay[PaymentManagementService<br/>:8081]
    Pay -->|POST /api/machines/start-cycle| MSS[MachineStateService<br/>:8082]
    Auth0[(Auth0<br/>JWKS)] -. validates JWT .-> MSS

    MSS -->|Modbus RTU frame<br/>func 0x10 / 0x03| GW[Serial⇄HTTP Gateway<br/>WireMock :9090]
    GW --- RS485[/RS485 machines<br/>washer_07..dryer_07/]

    MSS -->|EQLink v2<br/>MD5-signed POST| EQ[EQLink Cloud<br/>WireMock :9099]
    EQ --- EQM[/EQLink machines/]

    MSS -->|MQTT publish<br/>laundry/cameroon/...| Broker[(MQTT Broker<br/>:1883)]
    Broker --- ESP[/ESP32 relay boards/]
```

| Channel | Machines | Transport | Auth |
|---------|----------|-----------|------|
| **Modbus RTU** | `washer_07–09`, `dryer_05–07` | HTTP→serial gateway, function 0x10 write / 0x03 read, CRC16 | none (CRC16 per frame) |
| **EQLink v2** | mapped via `eqlink.device-name-mapping` | HTTPS POST, MD5 signature | `sign = MD5(sorted_params + "&secret_key=…")` |
| **MQTT** | all (safety net) | Eclipse Paho, topic `laundry/cameroon/…` | broker user/pass |

Feature flags (`application.yml`): `modbus.enabled`, `features.reservation-enabled`,
`eqlink.enabled` — all default **false** (MQTT-only fallback).

---

## 2. Start-cycle sequence (protocol selection)

```mermaid
sequenceDiagram
    autonumber
    participant Pay as PaymentManagementService
    participant API as MachineController
    participant Svc as MachineService
    participant Res as ReservationService
    participant Mod as ModbusClient
    participant Eq as EqLinkClient
    participant Mq as MqttService

    Pay->>API: POST /api/machines/start-cycle<br/>(Bearer JWT, scope sls-machine-start)
    API->>Svc: startCycle(request)
    Svc->>Svc: validate machine exists & not IN_PROGRESS

    opt reservation feature enabled & machine reserved now
        Svc->>Res: activeReservationCovering(machineId)
        Res-->>Svc: reservation present
        alt no/blank reservationCode
            Svc-->>API: 409 "reservation code required"
        else code provided
            Svc->>Res: validateAndConsume(code, machineId)
            Res-->>Svc: reservation → USED
        end
    end

    Svc->>Svc: dispatchStartCommand(machine, request, cycleType)

    alt commProtocol == MODBUS && modbus.enabled
        Svc->>Mod: startMachine(id, coins, program)
        Mod->>Mod: SELECT_PROGRAM → INPUT_COINS → START (func 0x10, CRC16)
        Mod-->>Svc: ack / no-ack
        Svc->>Mq: pulse (safety net)
    else commProtocol == EQLINK && eqlink.enabled
        Svc->>Eq: checkDeviceStatus(devicename) → vend_price
        Svc->>Eq: startDeviceIot(devicename, pulseCount, vendPrice)
        Eq-->>Svc: success / 406 timeout
        Svc->>Mq: pulse (relay fallback)
    else MQTT only
        Svc->>Mq: pulse (sole trigger)
    end

    Svc-->>API: StartCycleResponse (IN_PROGRESS)
    API-->>Pay: 200 OK
```

**Key rule:** the MQTT pulse is *always* sent — it is the primary trigger when no other
protocol is enabled, and a local-relay fallback when Modbus/EQLink is the primary.

---

## 3. Machine state diagram

```mermaid
stateDiagram-v2
    [*] --> AVAILABLE
    AVAILABLE --> IN_PROGRESS : start-cycle dispatched
    IN_PROGRESS --> AVAILABLE : cycle complete / heartbeat ends
    IN_PROGRESS --> OFFLINE : heartbeat timeout (120s)
    AVAILABLE --> OFFLINE : heartbeat timeout
    OFFLINE --> AVAILABLE : telemetry / heartbeat resumes
    IN_PROGRESS --> ERROR : Modbus alarm / device fault
    ERROR --> AVAILABLE : reset command / alarm cleared
```

A scheduled job (`machine.cycle-check-interval-ms`) reconciles cycle completion;
`machine.heartbeat-timeout-seconds` marks silent machines OFFLINE.

---

## 4. Reservation lifecycle

A reservation holds a machine for **exactly one hour**. The fee equals the price of the
highest wash cycle (kept in sync with the bot's long cycle). It is charged *in addition* to
the normal wash price. Authorization is by **code + machine — never by user** (a customer
may reserve on someone else's behalf).

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant RC as ReservationController
    participant RS as ReservationService
    participant DB as reservations table

    Client->>RC: POST /api/reservations {machineId, customerPhone, slotStart}
    RC->>RS: createReservation(...)
    RS->>DB: overlap check (machine, slotStart..slotStart+60m)
    RS->>RS: generate RES-XXXXXX + transactionReference
    RS->>DB: insert (status=PENDING_PAYMENT, fee=highest cycle)
    RS-->>Client: code + slot + fee

    Note over Client,RS: fee paid via PaymentManagementService
    Client->>RC: POST /api/reservations/activate {transactionReference}
    RC->>RS: activateByReference(ref)
    RS->>DB: PENDING_PAYMENT → ACTIVE (sets activatedAt)

    Note over Client: customer sends RES code when starting the machine
    Client->>RC: POST /api/reservations/validate {code, machineId}
    RC->>RS: validate(code, machineId)  %% read-only cross-check
    RS-->>Client: valid / reason (USED, EXPIRED, OUT_OF_SLOT…)
```

```mermaid
stateDiagram-v2
    [*] --> PENDING_PAYMENT : create (1-hour slot)
    PENDING_PAYMENT --> ACTIVE : fee payment confirmed
    PENDING_PAYMENT --> EXPIRED : scheduled expiry (unpaid, slot passed)
    ACTIVE --> USED : code consumed at start-cycle
    ACTIVE --> EXPIRED : slot ended unused
    PENDING_PAYMENT --> CANCELLED : cancelled
    ACTIVE --> CANCELLED : cancelled
    USED --> [*]
    EXPIRED --> [*]
    CANCELLED --> [*]
```

A `@Scheduled` job (`reservation.expiry-check-ms`) moves overdue rows to EXPIRED.

---

## 5. Modbus RTU framing

Register map: **SX174003A communication protocol**. PLC address → wire address is `PLC − 1`.

| Operation | Register (PLC) | Function |
|-----------|----------------|----------|
| Select program | 4X1150 (`0x047D`) | 0x10 write |
| Input coins | 4X1149 (`0x047C`) | 0x10 write |
| Start | 4X1146 (`0x0479`) | 0x10 write |
| Forced stop | `0x047B` | 0x10 write |
| Reset alarm | `0x0478` | 0x10 write |
| Read monitor (20 regs) | `0x048C` | 0x03 read |
| Read alarm I/O (7 regs) | `0x04B4` | 0x03 read |

Start sequence: **select-program → input-coins → start**. Each frame is protected by
CRC16 (poly `0xA001`, init `0xFFFF`, appended low-byte-first). In dev the serial bus is
emulated by WireMock (`modbus-mock/`, port 9090) — see `modbus-mock/README.md`.

---

## 6. Endpoint → scope map

| Method | Path | Scope |
|--------|------|-------|
| GET | `/api/machines/**` | `sls-machine-read` |
| POST | `/api/machines/start-cycle` | `sls-machine-start` |
| POST | `/api/machines/{id}/command/**` | `sls-machine-command` |
| POST | `/api/esp32/telemetry` | `sls-telemetry-write` |
| POST | `/api/reservations`, `/activate` | `sls-reservation-write` |
| POST | `/api/reservations/validate`, GET `/api/reservations/**` | `sls-reservation-read` |

Public: `/swagger-ui/**`, `/v3/api-docs/**`, `/h2-console/**`, `/actuator/health`.
