# PaymentManagementService — Communication Flow

Port **8081** · OAuth2 Resource Server (Auth0 JWT) · H2 (dev) / PostgreSQL (prod)

PaymentManagementService owns **money movement and RFID balances**. It initiates mobile-money
collections (CamPay / MTN MoMo / Orange Money), tracks transaction state, receives provider
webhooks, and — on success — notifies **MachineStateService** to start the machine.

---

## 1. System context

```mermaid
graph LR
    Bot[spring-bot-manager<br/>:8090] -->|POST /api/payments/initiate| Pay[PaymentManagementService<br/>:8081]
    Auth0[(Auth0 JWKS)] -. validates JWT .-> Pay
    Pay -->|collect request| Prov[Mobile-money provider<br/>CamPay / MTN / Orange]
    Prov -->|async webhook| Pay
    Pay -->|POST /api/machines/start-cycle| MSS[MachineStateService<br/>:8082]
    Pay --- DB[(transactions /<br/>rfid_cards)]
```

The provider is chosen at runtime (`PaymentProviderService`). RFID top-ups credit a stored
balance instead of starting a machine.

---

## 2. Pay-then-start sequence

```mermaid
sequenceDiagram
    autonumber
    participant Bot as Bot
    participant PC as PaymentController
    participant PS as PaymentService
    participant Prov as Provider (CamPay…)
    participant WH as WebhookController
    participant MS as MachineStartService
    participant MSS as MachineStateService

    Bot->>PC: POST /api/payments/initiate {amount, phone, machineId, ref}
    PC->>PS: initiatePayment(request)
    PS->>DB: insert Transaction (PENDING)
    PS->>Prov: collect(amount, phone, ref)
    Prov-->>PS: accepted (provider txId)
    PS-->>Bot: 200 {reference, PENDING}

    Note over Prov: customer approves on phone (USSD/app)
    Prov->>WH: webhook {ref, status=SUCCESSFUL}
    WH->>PS: handleWebhook(payload)
    PS->>DB: Transaction → SUCCESSFUL

    opt eqlink.auto-start-machine-after-payment = true
        PS->>MS: notifyMachineStart(transaction)
        MS->>MSS: POST /api/machines/start-cycle (fire-and-forget)
        MSS-->>MS: 200 (or swallowed error)
    end
```

`MachineStartService.notifyMachineStart` is **fire-and-forget**: a failure to reach
MachineStateService does *not* roll back the payment record — the bot/ESP32 fallback or an
operator handles it.

---

## 3. Transaction state diagram

```mermaid
stateDiagram-v2
    [*] --> PENDING : initiate
    PENDING --> SUCCESSFUL : webhook success
    PENDING --> FAILED : webhook failure / provider reject
    PENDING --> TIMEOUT : PaymentTimeoutService (no webhook in window)
    SUCCESSFUL --> [*]
    FAILED --> [*]
    TIMEOUT --> [*]
```

`PaymentTimeoutService` (scheduled) closes transactions stuck in PENDING past the timeout.

---

## 4. RFID top-up

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant TC as TopUpController
    participant TS as TopUpService
    participant Prov as Provider
    participant RS as RfidCardService

    Client->>TC: POST /api/topups {cardUid, amount, phone}
    TC->>TS: initiateTopUp(...)
    TS->>Prov: collect(amount, phone)
    Prov-->>TS: webhook success
    TS->>RS: credit card balance
    RS-->>Client: new balance
```

A subsequent wash can be paid from the RFID balance instead of a fresh mobile-money collection.

---

## 5. Provider abstraction

```mermaid
graph TD
    PPS[PaymentProviderService] --> CB{configured provider}
    CB -->|campay| CS[CampayService]
    CB -->|mtn| MS[MtnMomoService]
    CB -->|orange| OS[OrangeMoneyService]
```

All providers implement the same collect/verify contract, so `PaymentService` and the webhook
handler stay provider-agnostic.
