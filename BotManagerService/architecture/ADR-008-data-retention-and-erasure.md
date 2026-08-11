# ADR-008: Data Retention & Right-to-Erasure Architecture

## Status
**Implemented** — August 2026. Verified against the actual codebase: `CustomerProfileStore`,
`InvoiceRecordStore` (append-only, no `update()`/`delete()` exposed), `DeletionRequestService`,
the `customer_profile`/`invoice_record` Postgres split (migrations 001–003), and a
`RetentionWorker` (`src/core/retention/retentionWorker.js`, wired up in `server.js`) all exist
and match this design — the worker sweeps daily rather than the "monthly is fine" minimum,
purging `invoice_record` rows past `retain_until` and `customer_profile` rows inactive 3+
years. `redisManager.del(key)` exists and is what `DeletionRequestService` actually uses;
`delByPattern` was never needed in practice since erasure only ever targets the single
deterministic `conv:<botId>:<whatsappId>` key, not a pattern sweep.

## Context

An audit of the AfroMarket bot code against the published Datenschutzerklärung /
Löschanleitung surfaced two related gaps:

1. **No erasure mechanism exists.** No `LÖSCHEN`/`DELETE` handler in
   `AfroMarketBot.js` or the flow config. `redisManager.js` doesn't even expose
   a `del()` primitive. A customer invoking their Art. 17 DSGVO right today
   gets no response mechanism at all.

2. **No persistent order/invoice store exists.** All state lives in Redis with
   short TTLs (`conv:*` = 30 min, `payment:*` = 24h). The privacy policy
   promises invoice retention "up to 10 years per § 147 AO / § 257 HGB" — but
   there is no store that survives 24 hours, let alone 10 years. That promise
   is currently unbacked by any actual data store. This is a bookkeeping/tax-law
   exposure independent of GDPR — § 147 AO retention is not optional once a
   taxable sale occurs.

These two gaps can't be fixed independently. A delete handler wired directly
into the current Redis-only model would either (a) delete records that must
be retained for 10 years, which is a tax-law violation, or (b) refuse to
delete anything tied to an order, which is a GDPR violation. **The storage
model has to separate what must survive from what must be erasable before any
delete handler is built.**

## Decision

Split data into two stores with different lifecycles, and build the erasure
flow against that split — not against a single mutable customer record.

### 1. Data model: Personal store vs. Fiscal store

| Store | Contents | Lifecycle | Deletable on request? |
|---|---|---|---|
| **`customer_profile`** (new, Postgres) | WhatsApp ID, name, delivery address, chat/order preferences | Until erasure request, or 3 years of inactivity (default) | **Yes** — hard delete on request |
| **`invoice_record`** (new, Postgres, append-only) | Invoice number, date, line items, amount, tax status, buyer name + address *as printed on the invoice*, payment reference | 10 years fixed (§ 147 AO / § 257 HGB) | **No** — legally exempt from Art. 17 via Art. 17(3)(b) DSGVO |
| **Redis (`conv:*`, `payment:*`)** | Ephemeral conversation/payment-in-flight state | 30 min / 24h TTL (unchanged) | Self-expiring; explicit delete also wired in for immediacy |

**Key design point:** `invoice_record` does **not** foreign-key to
`customer_profile`. At the moment an order is confirmed, the invoice is
generated as a **snapshot** — name, address, amount are copied *into* the
invoice record, not referenced live. This is what makes the split work: once
you delete `customer_profile`, the invoice is untouched and legally intact,
because it never depended on the profile still existing. This is the same
principle as the payment-gateway ADR's ledger pattern (append-only, no
retroactive mutation) — just applied to commercial records instead of payment
events.

### 2. Erasure flow

```
User sends "LÖSCHEN" / "DELETE" (any state, any flow)
        │
        ▼
Global intercept in message router (before flow dispatch)
        │
        ▼
Confirmation step: "Möchten Sie wirklich alle Ihre Daten löschen? JA / NEIN"
        │ (JA)
        ▼
DeletionRequestService.execute(whatsappId)
   ├── 1. Log the request itself: deletion_request_log
   │      { whatsappId, requestedAt, completedAt, status }
   │      (Art. 5(2) accountability — you must be able to prove you handled it)
   ├── 2. Delete customer_profile row (hard delete)
   ├── 3. redisManager.del() on all conv:*, payment:* keys for this ID
   │      (new primitive — currently missing)
   ├── 4. Invoice records: NOT touched. Explicitly left alone by design.
   └── 5. Send WhatsApp confirmation: "Ihre persönlichen Daten wurden
          gelöscht. Rechnungsdaten bleiben aus gesetzlichen Gründen bis
          [date + 10y] gespeichert (§ 147 AO)."
```

The confirmation step matters for two reasons: it prevents accidental deletion
from a mistyped message, and — more importantly — it's the natural place to
tell the customer honestly what will and won't be deleted, which is exactly
what the current `datenloeschung.html` already promises in prose. The bot
should now actually say that, not just the website.

**Correction (fact-checked against the shipped code):** an earlier draft of
this ADR flagged the intercept's lack of a sender restriction as a live gap.
It isn't one. `_executeErasure({ from })` → `DeletionRequestService.execute({
whatsappId: from })` — `from` is the WhatsApp Cloud API's authenticated
sender field, not spoofable through the Business API, so a user can only
ever trigger erasure of their own data. Self-service GDPR erasure correctly
requires no allowlist, since the sender's identity *is* the data subject.
No code change was needed here, and none was made.

### 3. Required code changes

| Component | Change |
|---|---|
| `redisManager.js` | Add `del(key)` and `delByPattern(prefix)` — currently missing entirely |
| `AfroMarketBot.js` / flow router | Add a **global intercept** for `LÖSCHEN`/`DELETE`/`SUPPRIMER` (French, given Cameroon user base per other bots) ahead of normal flow dispatch, not inside a specific flow — a user mid-checkout should still be able to trigger it |
| New: `CustomerProfileStore` (Postgres) | CRUD for `customer_profile`; the only store the erasure flow touches for personal data |
| New: `InvoiceRecordStore` (Postgres, append-only) | Insert-only on order confirmation; no update/delete methods exposed at all — enforce this at the code level, not just by convention, so a future refactor can't accidentally add a `.update()` |
| New: `DeletionRequestService` | Orchestrates the 5 steps above; single place this logic lives |
| Config | `PRESSING_LAUNDRY_BOT_ID`-style env var pattern already exists elsewhere in the codebase — follow the same convention for any per-bot retention overrides |

### 4. Retention enforcement (the other half of "10 years")

A promise to delete after 10 years needs enforcement too, or it's just as
unbacked as the current promise to retain. Add a scheduled job (monthly is
fine — this isn't time-critical) that hard-deletes `invoice_record` rows past
their retention deadline. Store the deadline as a computed column
(`retain_until = created_at + interval '10 years'`) so the job is a simple
`DELETE WHERE retain_until < now()`, not an app-level date calculation.

## Consequences

### Positive
- Deletion requests can actually be honored without breaking tax compliance
- Tax compliance no longer rests on data that dies in Redis after 24h
- The privacy policy and delete-instructions page stop being aspirational — the code now backs what they promise
- Snapshot invoices (no live FK) mean future schema changes to
  `customer_profile` can never retroactively corrupt historical invoices

### Negative / accepted trade-offs
- Introduces Postgres as a new persistent dependency (the project has used
  Redis-only + Redis fallback so far — this is the first "must not lose
  this" data store, distinct from Redis's explicitly ephemeral role per
  ADR-003)
- Snapshotting customer data into invoices means corrections to a customer's
  name/address after an order **won't** retroactively fix past invoices —
  this is actually correct behavior (invoices are historical fact), but worth
  documenting so it isn't reported as a bug later
- Erasure is not instant across all systems: if a Meta/WhatsApp-side copy of
  chat content exists on Meta's infrastructure, this design only controls
  *your* stores — the privacy policy's §5.1 (Meta as processor) already notes
  this, no new gap, but worth re-confirming Meta's own retention/deletion
  behavior isn't assumed to be covered by this ADR

## Open questions for Sunday to confirm before implementation

1. Should the 3-year inactivity auto-delete on `customer_profile` be
   automatic, or opt-in only (some businesses prefer to ask before
   auto-purging a dormant customer)?
2. Confirm whether Orange Money/CamPay transaction IDs need to appear on the
   invoice snapshot for reconciliation purposes — affects what fields get
   copied at order-confirmation time.
3. Postgres hosting: reuse whatever's already planned for the Smart Laundry
   platform (per ADR-001's modular monolith), or provision separately for
   AfroMarket since it's a distinct bot/business line?
4. **Carried over from the BSUID readiness plan:** once username-adopting
   customers can arrive with only a BSUID and no phone number, the erasure
   intercept needs to resolve and delete `customer_profile` rows by BSUID too,
   not just by phone number / WhatsApp ID. Not yet designed — flagged here as
   the place this ADR needs to be extended.

## References
- ADR-003 (Redis for conversation state) — this ADR doesn't change ADR-003,
  it adds a second, durable store alongside it
- ADR-004 (Payment abstraction) — the append-only invoice pattern mirrors the
  payment-events ledger pattern from the payment gateway system design
- `datenschutz.html` §6 (Speicherdauer), `datenloeschung.html` — this ADR is
  what makes those pages factually true
