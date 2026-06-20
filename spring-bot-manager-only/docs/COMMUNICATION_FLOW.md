# spring-bot-manager — Communication Flow

Port **8090** · branch `develop` · multi-module Maven (bot-core, bot-laundry, bot-payment,
bot-pharmacy, bot-app)

The bot is the **WhatsApp conversational front end**. It drives a state-machine flow
(`laundry.bot.json`), reads machine availability from MachineStateService, and initiates
payments through PaymentManagementService. Two feature flags gate behaviour.

---

## 1. System context

```mermaid
graph LR
    WA[WhatsApp Cloud API] <--> Bot[spring-bot-manager<br/>:8090]
    Bot -->|read machines| MSS[MachineStateService<br/>:8082]
    Bot -->|initiate payment| Pay[PaymentManagementService<br/>:8081]
    Bot --- Cfg[(laundry.bot.json<br/>flows + feature flags)]
```

### Feature flags (`configs/bots/laundry.bot.json` → `features`)

| Flag | Default | Effect when **false** |
|------|---------|-----------------------|
| `washFlowEnabled` | `false` | Users can only check availability/info. Machine-select → cycle-select → payment is blocked. |
| `reservationEnabled` | `false` | Reservation entry point hidden. |

The wash-flow flag is enforced **in the bot** (`LaundryFlowPlugin`); the reservation
mechanism itself lives in MachineStateService.

---

## 2. Conversation state machine

```mermaid
stateDiagram-v2
    [*] --> language_selection
    language_selection --> main_menu : language chosen
    main_menu --> show_services : action_services
    main_menu --> show_availability : action_availability
    main_menu --> show_user_status : action_my_status
    main_menu --> WashGate : action_wash

    state WashGate <<choice>>
    WashGate --> wash_flow_disabled : washFlowEnabled = false
    WashGate --> machine_method_selection : washFlowEnabled = true

    wash_flow_disabled --> main_menu : availability / services / menu

    machine_method_selection --> cycle_selection : machine chosen
    cycle_selection --> initiate_payment : cycle chosen
    initiate_payment --> main_menu : payment initiated
```

When `washFlowEnabled` is false, `handleStartWashFlow` short-circuits to
`handleWashFlowDisabled` — an info message (`wash_flow_disabled`, EN/FR) offering only
availability, services, and the main menu. No machine, cycle, or payment path is reachable.

---

## 3. Happy-path wash sequence (flag ON)

```mermaid
sequenceDiagram
    autonumber
    participant User as User (WhatsApp)
    participant Bot as LaundryFlowPlugin
    participant MSS as MachineStateService
    participant Pay as PaymentManagementService

    User->>Bot: "Start a Wash"
    Bot->>Bot: washFlowEnabled? → yes
    Bot->>MSS: GET available machines
    MSS-->>Bot: machine list
    Bot-->>User: choose method → choose machine
    User->>Bot: select machine + cycle (short/long)
    Bot->>Pay: POST /api/payments/initiate {amount, phone, machineId, ref}
    Pay-->>Bot: PENDING
    Bot-->>User: "Payment initiated — approve on your phone"
    Note over Pay,MSS: on webhook success, Pay calls MSS start-cycle
```

When `washFlowEnabled` is **false** the same "Start a Wash" tap is intercepted at the gate
and never reaches MachineStateService or PaymentManagementService for a start.

---

## 4. Reservation (flag ON, mechanism in MachineStateService)

```mermaid
sequenceDiagram
    autonumber
    participant User
    participant Bot
    participant MSS as MachineStateService
    participant Pay as PaymentManagementService

    User->>Bot: Reserve machine + 1-hour slot
    Bot->>MSS: POST /api/reservations
    MSS-->>Bot: RES-XXXXXX + fee + slot
    Bot->>Pay: initiate reservation-fee payment
    Pay-->>MSS: (webhook) activate reservation → ACTIVE
    Bot-->>User: WhatsApp: reservation code + machine details
    Note over User: later — send the code to start the machine
    User->>Bot: send RES code when selecting that machine
    Bot->>MSS: start-cycle {reservationCode}
    MSS->>MSS: validateAndConsume(code, machine) → USED
```

Authorization is by **code + machine, not by user** — anyone holding the code for that
machine can start it within the slot.

---

## 5. Configuration sync

- Highest wash cycle = `longCycle.price` (2000 XAF) → this is the reservation fee in
  MachineStateService (`reservation.fee-amount`). Keep the two in sync.
- Slot length is fixed at **exactly 1 hour** (not configurable).
- Translations (`wash_flow_disabled`, etc.) live in `bot-core` `TranslationService`
  (EN/FR via `addTranslation`).
