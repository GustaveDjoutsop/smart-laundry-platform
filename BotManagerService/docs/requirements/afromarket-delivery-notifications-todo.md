# AfroMarket: Delivery Notifications

**Status: partially implemented.** The persistent `orders` table and the
`CONFIRMED` write inside `_recordOrder` are built
(`migrations/005_orders_table.sql`, `src/core/orders/orderStatusStore.js`).
Everything else below — the admin `shipped`/`delivered` intercept, the
customer notification, and the 24h-window/template handling — is still TODO
and unapproved. Until the intercept exists, status is changed by hand in the
Supabase Table Editor.

## Related observation found during research (corrected after review)

While researching this feature (tracing `_handleErasureIntercept` as a model
for a new admin-only intercept, see finding #4 below), the existing GDPR
data-erasure trigger (`src/bots/afromarket/AfroMarketBot.js:66-133`) was
initially flagged as having "no sender restriction" in a way that read like a
security gap. **A follow-up review corrected this**: erasure
(`_executeErasure` → `DeletionRequestService.execute`) only ever deletes the
*sender's own* profile/conversation, keyed by their own `from` ID — there is
no cross-customer deletion path and nothing an allowlist would need to
guard. Self-service GDPR erasure correctly requires no restriction, since the
sender's identity *is* the data subject.

What still matters for this feature: erasure and the planned
delivery-notification intercept have **opposite trust models**. Erasure
intentionally trusts any sender to act on their own data. The new admin
intercept must intentionally *not* trust any sender, since it acts on
someone else's (the customer's) data on the admin's behalf. So
`_handleErasureIntercept` is the wrong shape to copy wholesale — not because
it's broken, but because it solves a different problem — see finding #4.

## Problem

After payment, `AfroMarketBot` sends an order confirmation ("we deliver
within 3 days") and then goes silent — nothing tells the customer when their
order actually ships or arrives.

## Hard constraint: WhatsApp's 24-hour messaging window

Meta only allows free-form business-initiated messages within 24 hours of the
customer's last inbound message. If a customer confirms an order and it ships
2 days later, a plain-text "your order has shipped" message will likely fail
to send — outside that window, only a pre-approved **message template** can
go out. This isn't optional or configurable; it's a platform rule.

**Confirmed via research: nothing in the codebase handles this today.**
Searched every *free-form* outbound send path in
`src/core/whatsapp/whatsappClient.js` (`sendText`, `sendButtons`,
`sendList`, `sendImage`, `sendCtaUrl`) and all of `src/core/payments/` —
none check window eligibility or fall back to a template. (The file's one
template-based path, `sendCarouselTemplate`, always sends a `type:
'template'` payload regardless of window — but nothing today decides
*which* path to use based on whether the customer's 24h window is still
open, which is the actual gap.) This is genuinely new work regardless of
which option below is chosen, and it's the one piece that blocks Option A
from working reliably past the first day if orders regularly take more than
24h to ship (likely, for a delivery business).

**Action:** check the actual typical order-to-ship gap. If it's regularly
under 24h, this can be deferred. If not, a WhatsApp message template needs to
be submitted to Meta for approval before this feature works reliably in
production — not before the code is *written*, but before it works past day
one. Template review takes 1-2 days, so submitting it can run in parallel
with building the rest of the feature rather than blocking it.

## Options

### Option A — Manual trigger via WhatsApp admin command (recommended)

The business owner texts the bot (or a dedicated admin number) something like
`shipped AM-00123` or `delivered AM-00123`. The bot looks up that order and
messages the customer automatically.

**Advantages**
- Minimal engineering, fits how the business is actually run today (one
  person packs and ships every order themselves)
- No dependency on a carrier API or tracking integration
- Ships fast — reuses existing patterns in the codebase (see Technical
  Findings below)

**Disadvantages**
- Manual — relies on the owner remembering to send a message after every
  shipment
- No real-time granularity ("10 minutes away") — just discrete status
  updates
- A typo in the order number could (without safeguards) notify the wrong
  customer — addressed by the hardening additions below

### Option B — Time-based automatic reminder on day 3 (not recommended)

A scheduled job automatically messages every customer whose order was
confirmed exactly N days ago: "Your order should be arriving today!" No
manual step required.

**Advantages**
- Fully automatic, zero ongoing owner effort

**Disadvantages**
- Doesn't reflect reality. If a shipment is delayed, already delivered
  early, or never shipped at all, the message is simply wrong — it's a
  guess dressed up as a status update, not a real one
- Actively risks eroding customer trust if it's wrong more than
  occasionally
- **Explicitly not recommended.** Skip this option entirely rather than
  build it as a stopgap.

### Option C — Real carrier tracking integration (right eventual move, not now)

Once orders are shipped through a real carrier (DHL, DPD, Hermes, Deutsche
Post, etc.) with tracking numbers, integrate their tracking webhook/polling
API to relay real status changes ("out for delivery", "delivered")
automatically via WhatsApp.

**Advantages**
- Fully automatic *and* accurate — the only option that's both
- Scales without ongoing manual effort as order volume grows

**Disadvantages**
- Requires committing to a specific carrier with API/webhook support
- Requires capturing tracking numbers into the order flow
- Meaningfully more engineering than Option A
- Doesn't fit today's fulfillment reality if orders aren't currently
  shipped via a trackable carrier — worth confirming this before scoping
  it further

**Revisit when:** a real carrier with tracking is actually in use.

## Recommended approach

**Option A, plus four hardening additions.** None of these meaningfully
change the timeline — they're small design decisions that are much easier to
get right now than to retrofit after real customers depend on this.

1. **Persistent `orders` table, not Redis-only.** Order number → phone →
   status is exactly the kind of data that shouldn't live only in Redis: it's
   what lets the business answer a customer dispute, reconcile against tax
   records, or recover state after a restart. See the ADR-003 finding below
   for the (corrected) reasoning.
2. **Sender-restricted admin intercept.** The new intercept must check the
   sender against a designated admin number — see the erasure-intercept
   trust-model distinction flagged above for why this can't be copied from
   the existing pattern and must be built in from the start.
3. **Order-number echo-back.** After every admin trigger, the bot confirms
   back ("✅ Notified [Name] that AM-00123 shipped.") so a typo is visible
   immediately, not discovered later — see the flow sketch below for the
   matching failure-path (order not found).
4. **Idempotency + status-regression handling.** Re-sending the same status
   twice should not double-notify the customer; going *backward* in status
   (e.g. `shipped` after `delivered`) needs a deliberate decision, not an
   accident — see the flow sketch below.

## Technical findings (from codebase research)

1. **The order-confirmation code path already has everything a new `orders`
   write needs — this is one connected piece of work, not two.**
   `AfroMarketBot._onPaymentCompleted()`
   (`src/bots/afromarket/AfroMarketBot.js:135-174`) already has
   `customerPhone`, `metadata.orderNumber`, and `transactionId` in scope, and
   its `_recordOrder()` helper (lines 179-216) already performs two durable
   Postgres writes — `invoiceRecordStore.insert(...)` and
   `customerProfileStore.upsert(...)`, both via the shared
   `pgClient.getPool()` connection (Postgres/Supabase, confirmed not Redis).
   A new `orders` table insert slots in as a third write in that same
   method, using data already in scope — no new plumbing needed to reach it.
   (The only Redis touch in this path is the `redisManager.setnx` dedup lock
   for the webhook itself, which is correctly ephemeral by design — not a
   durability gap.)

2. **The 24-hour WhatsApp messaging window has zero handling anywhere in the
   codebase today.** See the "Hard constraint" section above — this is
   genuinely new work.

3. **Message template submission is a small variant of an existing script.**
   `scripts/submitCarouselTemplate.js` already POSTs to
   `https://graph.facebook.com/v20.0/${WABA_ID}/message_templates` using
   `WHATSAPP_ACCESS_TOKEN_AFROMARKET`. A plain-text order-status template
   needs none of that script's image-upload machinery — just a `BODY`
   component with one variable, submitted as category `UTILITY`. (The
   script's own comment about Meta rejecting `UTILITY` for carousels is
   specific to the `CAROUSEL` component and doesn't apply here — `UTILITY`
   is in fact the correct category for a shipping notice, not a workaround.)

4. **No admin/owner phone number concept exists anywhere** — searched env
   vars, bot config, and all of `src/`. The existing `_handleErasureIntercept`
   (`AfroMarketBot.js:66-133`) that the new admin intercept would be modeled
   on has no sender restriction, but — per the callout at the top of this
   doc — that's correct for erasure's trust model (self-service, sender acts
   only on their own data), not a bug to fix. The delivery-notification
   intercept has the opposite trust model (admin acts on someone else's
   data) and must explicitly not copy that unrestricted shape; it needs its
   own sender check against a new `AFROMARKET_ADMIN_NUMBER`-style env var.

5. **Pushing an arbitrary outbound message outside an active chat session
   already exists as a pattern.** `_onPaymentCompleted` is itself an
   event-driven listener (`paymentEvents.on('payment.completed', ...)`,
   registered in the constructor) that calls
   `this.whatsapp.sendButtons(...)` directly, bypassing the flow engine
   entirely. The admin-triggered shipped/delivered notification reuses this
   exact shape.

6. **DB migration convention:** `migrations/001_data_retention_erasure.sql`,
   `002_enable_rls.sql` — numbered, `CREATE TABLE IF NOT EXISTS`, no formal
   tool (Flyway etc.), applied by hand against Supabase. The orders table
   therefore landed as `005_orders_table.sql`, **not `003`** as this doc
   originally said: `003_add_customer_profile_email.sql` and
   `004_add_customer_identity_link.sql` were both written and applied in
   between.

7. **On the "ADR-003" reference:** `architecture/ADR-003-state-management.md`
   exists and does discuss Redis volatility, but its actual wording is
   softer than "explicitly the wrong place" — it lists "Redis restart clears
   state" as a Negative consequence and "Critical data also in MongoDB" as
   the stated Mitigation (line 113). Worth noting honestly: the ADR's own
   mitigation text is stale — the code doesn't use MongoDB at all today, it
   uses Postgres/Supabase for exactly this kind of critical data
   (`invoiceRecordStore`, `customerProfileStore`). The underlying principle
   (don't let Redis be the only copy of anything you can't afford to lose)
   still fully applies and is already how this codebase operates in
   practice — just not written into the ADR that specifically.

## Data model (as built — `migrations/005_orders_table.sql`)

```sql
create table if not exists orders (
  order_number  text primary key
                references invoice_record (invoice_number) on delete cascade,
  status        text not null default 'CONFIRMED'
                check (status in ('CONFIRMED','SHIPPED','DELIVERED')),
  confirmed_at  timestamptz not null default now(),
  shipped_at    timestamptz,
  delivered_at  timestamptz
);
alter table orders enable row level security;
```

Three deliberate differences from the sketch this doc originally carried:

- **No `customer_phone` column.** Under ADR-008, personal data lives in
  `customer_profile`, which the erasure flow can delete. A phone number
  copied in here would be touched by neither the erasure service (it only
  knows `customer_profile`) nor the retention worker (it only knows
  `invoice_record`) — a GDPR gap with no owner. The customer's phone is
  reachable by joining `invoice_record` on `invoice_number`.
- **`order_number` is an FK onto `invoice_record.invoice_number`, with
  `on delete cascade`.** The cascade is load-bearing: the retention worker's
  10-year invoice delete would otherwise be blocked by the reference.
- **Two CHECKs tie each status to its timestamp** (`SHIPPED` requires
  `shipped_at`, `DELIVERED` requires `delivered_at`). A hand edit in the
  Supabase Table Editor must therefore set both fields in the same row edit
  or it is rejected — deliberate, since a `DELIVERED` row with a null
  `delivered_at` would quietly break any later "delivered in the last N
  days" query. Verified against the live schema: the constraint does reject
  a status-only edit.
- **RLS on with zero policies**, the same deliberate shape as migration 002 —
  the bot connects as `postgres` (bypasses RLS) and the public Supabase API
  path is unused.

Note on the order number the admin will actually type: `invoice_number` is
``<BOT_ID>-<transactionId>``, e.g. `AFROMARKET-32V17699T05397320`, not the
`AM-00123` this doc assumed. `metadata.orderNumber` (the `AM-…` value) is
display-only, is not unique and is not persisted as a key, so it can't be the
lookup identifier. The intercept will need either a short-code column added
to `orders` or a prefix/suffix match — decide before building step 3 of the
flow sketch below.

Forward-compatible with Option C: adding a `tracking_number` column later is
a small migration, not a redesign.

### The board must read `invoice_record`, not `orders`

The `orders` write is best-effort by design (it must never cost a customer
their order confirmation), so three realistic paths leave an invoice with no
status row: migration 005 not applied in that environment, a transient error
hitting only the second insert, or the process dying between the two
un-transacted inserts. Whatever renders the fulfilment board — Table Editor
view, later dashboard — must therefore be a `LEFT JOIN` from
`invoice_record` with `coalesce(orders.status, 'CONFIRMED')`, so a missing
row degrades to "confirmed, not yet shipped" instead of "this order does not
exist" (an order invisible on the board is an order that never ships).
Re-running migration 005's backfill is the repair path; it is
`ON CONFLICT DO NOTHING`, so it is safe to re-run at any time.

### Accepted gap

A PayPal payment that returns no shipping address defers the whole
`_recordOrder` call until the customer replies with one, so such an order has
no `orders` row — and appears on no fulfilment board — until then. This is
not new behaviour: the invoice is deferred for exactly the same reason
(`invoice_record` is append-only, so an incomplete invoice must not be
written). Accepted as-is.

## Proposed flow sketch (not final — for discussion)

1. ~~`_recordOrder` gains a third write (status = `CONFIRMED`).~~ **Done**
   — `OrderStatusStore.insertConfirmed`, keyed on the `invoice_number`
   returned by the invoice insert, in its own try/catch so a failure can
   never block the payment confirmation, and skipped entirely when the
   invoice write failed (the FK would reject it anyway).
   `ON CONFLICT DO NOTHING`, not an upsert, so a redelivered webhook cannot
   reset an already-`SHIPPED` order to `CONFIRMED`.
2. New admin intercept runs ahead of normal dispatch (mirroring where
   `_handleErasureIntercept` runs), gated by a sender check against
   `AFROMARKET_ADMIN_NUMBER` — unlike the erasure intercept, this one is
   restricted from the start.
3. Parse `shipped <order_number>` / `delivered <order_number>`, look up the
   order.
4. **Order not found → reply to admin, touch nothing else.** A fat-fingered
   order number must fail loudly to the admin, not silently or with a
   crash — this is the failure-path counterpart to the echo-back
   (echo-back confirms success; this branch is what happens on failure).
5. **Status-regression check.** Idempotency (below) covers repeating the
   *same* status twice; it doesn't cover going *backward* — e.g. `shipped
   AM-00123` arriving after the order is already `DELIVERED`. Needs one of:
   block outright, warn-and-ask-to-confirm, or allow unconditionally — not
   left to be discovered by accident later. Proposed default (still open
   for discussion): warn-and-ask, same shape as the idempotency
   confirmation — a genuine correction ("it shipped again after a return")
   isn't blocked outright, but an accidental regression doesn't silently
   overwrite state either.
6. **Idempotency check** (same status re-sent) → reply to admin, don't
   re-notify the customer.
7. Update status + timestamp, send the customer notification (plain text
   within the 24h window, template outside it), echo confirmation back to
   the admin ("✅ Notified [Name] that AM-00123 shipped.").

## Open items still needing a decision before implementation

- Actual typical order-to-ship gap — needs a real answer, not a guess, to
  know if template approval is a hard prerequisite for launch.
- Exact customer-facing wording for shipped/delivered messages — Meta
  template wording is picky post-approval, should be settled before
  submitting.
- Where `AFROMARKET_ADMIN_NUMBER` lives — env var vs. bot config JSON.
- Confirm both "shipped" *and* "delivered" are wanted as separate customer
  touchpoints (not just one).
- **Should out-of-order status transitions be blocked, warned, or
  allowed?** (e.g. `shipped` arriving after `delivered`) — same category as
  the other open items here, should be a deliberate decision, not an
  accident of whatever the first implementation happens to do.

## Verification plan for when this is eventually implemented

The `orders` write inside `_recordOrder` is covered in
`test/afromarketOrderRecording.test.js` (normal path, post-payment-address
path, a failing `orders` insert not breaking the payment flow, and no
`orders` row when the invoice write failed), and the store itself in
`test/orderStatusStore.test.js` (emitted SQL/params, the
`ON CONFLICT DO NOTHING` idempotency, the 42P01 migration hint, pass-through
of unrelated errors). Still needed: unit tests for the admin
intercept's sender restriction, the order-not-found branch, the
status-regression branch, the idempotency branch, and the 24h-window
fallback-to-template branch — following the existing test style already used
in `test/afromarketPaymentCheckout.test.js` and
`test/afromarketOrderRecording.test.js` (mocked stores, `node:test`,
AAA-style assertions).
