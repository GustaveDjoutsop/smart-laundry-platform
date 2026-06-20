# Hypothetical MongoDB Schema — `payments` & `machines`

> **Status: exploratory / not implemented.** The three services
> (`spring-bot-manager-only`, `MachineStateService`, `PaymentManagementService`)
> currently run on **PostgreSQL** (via JPA/Hibernate) plus **Redis** for
> short-lived caches — there is no MongoDB in this stack. This document is a
> forward-looking design exercise: if `PaymentRecord`/`Transaction` and
> `MachineRecord`/`Machine` were migrated to MongoDB, this is how they'd be
> modeled, and which embedding opportunities the current relational layout
> already points at.

## Source entities surveyed

| Repo | Entities |
|---|---|
| `PaymentManagementService` | `Transaction`, `RfidCard`, `TopUpTransaction` (Postgres `paymentdb`) |
| `MachineStateService` | `Machine`, `MachineCycle`, `MachineEvent`, `Reservation` (Postgres `machinedb`) |
| `spring-bot-manager-only` | `PaymentRecord` (Redis cache + `PaymentEntity` in `payments` table), `MachineRecord` (Redis cache only) |

---

## `payments` collection (source of truth — PaymentManagementService)

```js
{
  _id: ObjectId,
  externalReference: "uuid-...",
  providerReference: "campay-ref-123",
  amount: Decimal128("1000.00"),
  currency: "XAF",
  phoneNumber: "+237699xxxxxx",
  status: "COMPLETED",
  paymentProvider: "CAMPAY",
  failureReason: null,
  timeoutAt: ISODate("..."),
  createdAt: ISODate("..."), updatedAt: ISODate("..."),

  // EMBED — 1:1, always read/written with the payment, bounded
  cycle: { machineId: "washer_01", cycleType: "NORMAL", pulseCount: 2, durationMinutes: 30 },
  metadata: { isReservation: false },
  providerPayload: { /* raw webhook/init response */ },

  // REFERENCE — different owner (MachineStateService), independent lifecycle
  rfidCardUid: "ABC123",
  reservationCode: "RES-AB12CD"   // null for normal washes
}
```

**Embed:** `cycle`, `metadata`, `providerPayload` — all 1:1, small, always
fetched together with the payment. This mirrors what `Transaction`'s flat
columns and the bot's `metadata`/`raw` map already do today; Mongo just nests
them as subdocuments instead of separate `jsonb` columns.

**Reference, don't embed:** reservation and RFID card — separate
ownership/lifecycle, optional, and queried independently of any single
payment.

---

## `machines` collection (source of truth — MachineStateService)

```js
{
  _id: "washer_01",          // machineId as _id, drops a separate unique index
  type: "WASHER", brand: "LG", model: "Commercial Pro",
  zone: "main", position: 1, commProtocol: "MQTT",

  status: "RUNNING", isOnline: true, doorLocked: false, lastHeartbeat: ISODate("..."),

  // EMBED — 1:1, exists only while running, read with every availability check
  currentCycle: {
    type: "NORMAL", startedAt: ISODate("..."), endsAt: ISODate("..."),
    durationMinutes: 30, progress: 45, transactionReference: "uuid-..."
  },

  // EMBED — 1:1, small, overwritten wholesale on each reading
  telemetry: {
    temperature: 41.2, humidity: 60, waterLevel: 80,
    spinSpeed: 1200, vibration: 0.4, powerConsumption: 1100,
    updatedAt: ISODate("...")
  },

  error: { code: null, message: null },
  maintenance: { totalCycles: 482, cyclesSinceService: 12, lastServiceDate: ISODate("...") },

  // EMBED (bounded 0..1) — only the active reservation
  activeReservation: {
    reservationCode: "RES-AB12CD", customerPhone: "+237...",
    slotStart: ISODate("..."), slotEnd: ISODate("..."), status: "ACTIVE"
  },

  updatedAt: ISODate("...")
}
```

**Embed everything above:** every field is read together on
`GET /api/machines` (the bot's availability poll via `MachineService`) —
"data accessed together, stored together." All fields are 1:1 with the
machine and bounded in size, so there's no risk of approaching the 16MB
document limit. This collapses today's ~30 flat columns on `machines` into a
cohesive document — simpler than the current relational layout, not more
complex.

---

## What NOT to embed

| Entity | Why not embedded |
|---|---|
| `machine_cycles` (history) | Unbounded 1:many over the machine's lifetime — would eventually blow past 16MB and bloat the hot availability document. Keep as a separate collection referenced by `machineId`; only the current/last cycle is embedded as `currentCycle` above. |
| `machine_events` | High-frequency MQTT heartbeat/status-transition log — candidate for a **MongoDB time-series collection**, bucketed by `machineId`. |
| `reservations` (full history) | Only the *active* reservation is embedded; full history is queried independently by code/phone/status and grows unbounded. |
| `rfid_cards` / `topup_transactions` | Looked up independently of any machine/payment; top-up history per card is unbounded. |

---

## Cross-repo duplication (the real anti-pattern today)

`PaymentRecord` (bot, Redis cache) + `PaymentEntity` (bot, Postgres
`payments` table) + `Transaction` (PMS, Postgres `transactions` table) are
**the same payment persisted three times**. In Mongo terms:

- PMS `payments` (above) is the source of truth.
- The bot's persisted copy should use the **Extended Reference pattern**:
  embed only the small subset it needs for chat history (`status`, `amount`,
  `transactionId`, `externalRef`) plus a reference back to PMS —
  not a full duplicate of `providerPayload`/`metadata`.
- The bot's `MachineRecord` is already a good example of this pattern in
  practice — a thin cached subset of MSS's `Machine` (`botId`, `machineId`,
  `type`, `name`, `status`, `program`, `remainingSeconds`, `currentUser`,
  `lastHeartbeatAt`). Worth preserving that shape if this is ever migrated.

---

## Reference: design patterns applied

- **Embed vs Reference** — used throughout to decide subdocument vs.
  separate collection per relationship.
- **Extended Reference Pattern** — for the bot's cached payment/machine
  views of PMS/MSS-owned data.
- **Outlier / Computed summary** — `currentCycle` on `machines` is the
  computed "hot" summary of the unbounded `machine_cycles` history.
- **Time-Series Collections** — recommended for `machine_events`.
