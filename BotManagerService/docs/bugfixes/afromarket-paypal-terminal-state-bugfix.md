# AfroMarket: a PayPal payment link stayed usable after the order was dead

**Date of incident:** 2026-11-11, reproduced twice on 2026-11-12
**Orders:** `AM-E0XSRIE6A` / PayPal `7XV99525X2951891Y` (€39.94);
`AM-EZ1QNKF5D` / `3NE949564D201204P` (€37.94);
`AM-0BYOCLH44` / `56E06612TV096315K` (€63.92)
**Policy decided:** block the completion, flag and queue for manual
reconciliation — no auto-refund, no auto-confirm.

## What the customer saw

| Local (UTC+1) | What happened |
|---|---|
| 22:48 | Order created, "Pay Now" link sent |
| 22:58 | `❌ Paiement échoué (TIMEOUT).` — "Tape *menu* pour recommencer." |
| 23:18 | Customer pays through the **same link** anyway |
| 23:18 | `✅ Payment received! We just need your delivery address to ship this` |

The bot told the customer the payment had failed and then, twenty minutes
later, accepted the same payment and started asking for a delivery address for
an order it had already written off.

## The exact sequence from the logs

From `logs.1794435723811.log` (Railway, UTC):

```
21:48:49  AfroMarketBot[afromarket] handled message ... (flow=main_menu, state=order_confirmed)
          -> order AM-E0XSRIE6A / PayPal order 7XV99525X2951891Y created, link sent
~21:58    PaymentStatusWorker 10-minute timeout fires -> FAILED / failureReason=TIMEOUT
          -> "❌ Paiement échoué (TIMEOUT)" sent to the customer
22:18:45  GET /payment-return?token=7XV99525X2951891Y&PayerID=... (x2)
22:18:45  [WARN] PayPal CHECKOUT.ORDER.APPROVED received for already-failed payment;
                 skipping capture {"orderId":"7XV99525X2951891Y","failureReason":"TIMEOUT"}
22:18:45  POST /api/payments/webhooks/paypal/afromarket 200 46 - 787.341 ms
22:18:55  POST /api/payments/webhooks/paypal/afromarket 200 11 - 369.262 ms
22:18:55  [INFO] Payment completed but no machineId in payment metadata
                 {"botId":"afromarket","transactionId":"7XV99525X2951891Y"}
```

Two separate webhook deliveries, ten seconds apart. The first
(`CHECKOUT.ORDER.APPROVED`) was correctly refused. The second was not, and the
`Payment completed but no machineId` line is `machineService._onPaymentCompleted`
— proof that `payment.completed` was emitted, which is what made the bot send
"✅ Payment received!".

It reproduced twice the next day, 2026-11-12, both with the capture confirmed
on PayPal's side:

- `AM-EZ1QNKF5D` (€37.94) — timeout at 14:53, customer paid at 15:17 through
  the still-live link; `PAYMENT.CAPTURE.COMPLETED` for order
  `3NE949564D201204P` / capture `33B44722BH2579250`; WhatsApp showed "Payment
  received" then "Order confirmed".
- `AM-0BYOCLH44` (€63.92) — same shape; order `56E06612TV096315K` / capture
  `4WJ857228T585350T`; PayPal sandbox shows delivery at 15:17:47, HTTP 200.

So the money does move. This is not a theoretical window.

For comparison, the healthy order `32V17699T05397320` earlier the same evening
shows the same two-delivery shape: a 1392 ms approval webhook (the capture call
runs inline, hence the duration) followed by a 238 ms
`PAYMENT.CAPTURE.COMPLETED`. That shape is what identifies the 369 ms delivery
in the incident as `PAYMENT.CAPTURE.COMPLETED`.

## Which paths were unguarded

PR #293 had already added three guards after an earlier near-miss. Auditing
every path that can mark a payment successful:

| Path | Guard before this fix |
|---|---|
| `CHECKOUT.ORDER.APPROVED` webhook (`routes/payments.js`) | ✅ refused capture when `status === 'FAILED'` |
| `PaymentGateway.checkStatus` (poll + PayPal self-heal capture) | ✅ refused a COMPLETED write when FAILED/TIMEOUT |
| `PaymentStatusWorker._onStatus` | ⚠️ present but **ineffective** — see below |
| **`PAYMENT.CAPTURE.*` webhook (`routes/payments.js`)** | ❌ **none** |
| CamPay webhook | ❌ none |
| Stripe webhook | ❌ none |

### Why the belt-and-suspenders guard did not save us

This is the part worth remembering, because the guard existed, read correctly,
and still did nothing.

`PaymentStatusWorker._onStatus` tested:

```js
status === COMPLETED && payment.status === FAILED && payment.failureReason === 'TIMEOUT'
```

…where `payment` is read back from the store. But every emitter calls
`store.appendEvent({status: 'COMPLETED'})` **before** emitting `payment.status`,
and `appendEvent` rebuilt the snapshot as
`{...existing, status: status || existing.status}`. So by the time `_onStatus`
ran, the stored status was already `COMPLETED`. The test was false, the guard
fell through, `previousStatus` was `'FAILED'` so the "same status" suppression
did not apply either, `_claimTerminalEmission` was unclaimed, and
`payment.completed` fired.

**The guard sat downstream of the write it was meant to prevent.** A per-caller
guard only ever covers that caller, and this one was reading state the caller
had already corrupted.

## What changed

The rule now lives at the single write boundary: **`PaymentStore.appendEvent`**.
Every success path in the system funnels through it — all three provider
webhook routes, PayPal's capture-response recording, the status poll, and the
timeout. A payment in a terminal state can no longer transition to successful,
regardless of which path reports it.

- `paymentTypes.js` — `isTerminalStatus()` / `TERMINAL_STATUSES`
  (`COMPLETED`, `FAILED`). Lives here because it has no dependencies, so
  importing it does not drag Redis into the gateway.
- `paymentStore.js` — `appendEvent` reads the snapshot **before** any write and
  refuses `status === COMPLETED` when the stored status is already terminal.
  **The rule is keyed on a durable terminal marker, not on the payment
  record.** Two review findings showed the record cannot carry it:

  - `mapCaptureStatus` folds `REFUNDED` / `REVERSED` / `PARTIALLY_REFUNDED`
    into `PENDING` (deliberately — no refund concept exists anywhere else in
    the payment system). Keyed on the snapshot, a reversal therefore demoted a
    `COMPLETED` payment back *out* of terminal, and a late `COMPLETED`
    resurrected it with no incident flag and no queue entry.
  - The payment record's own TTL is 24 hours, while PayPal retries a failed
    delivery with backoff over roughly three days. Once it expired,
    `previousStatus` was `null`, `isTerminalStatus(null)` was false, and the
    retry was processed as a fresh completion — a second order confirmation
    for a payment made once. The emission claim in `_claimTerminalEmission`
    has the same 24h TTL, so it expired in lockstep and was no backstop.

  `payment_terminal:{botId}:{transactionId}` is written with `setnx` the first
  time a payment reaches a terminal status, never demoted, with the same
  30-day TTL as the event-dedup markers. The first terminal status wins: a
  `FAILED` arriving after a `COMPLETED` (a denial or reversal) does not make a
  paid payment completable again.

  The refusal is one-directional on purpose: `COMPLETED → FAILED` still passes,
  because `PAYMENT.CAPTURE.DENIED`, reversals and chargebacks travel that way
  and blocking them would hide a real loss of funds. A refused write touches
  nothing but its own `capturedAfterTerminal*` fields, so a partial or
  differently-denominated late capture cannot restate the order's amount,
  currency or metadata.

  **Two cases are deliberately separated**, and conflating them was itself a
  bug caught in review before this shipped:
  - `previousStatus === COMPLETED` — the ordinary PayPal flow, which reports a
    completion more than once (the capture response, the separate
    `PAYMENT.CAPTURE.COMPLETED` delivery, and the backstop poll). Blocked,
    recorded as `payment_completed_duplicate_signal`, logged at info, **not**
    an incident. The first draft filed every successful order in the
    manual-review queue and logged it at error, which would have buried the
    real cases in 100% noise. One exception: if the repeat carries a
    **different amount** from the order, it is a second capture rather than a
    second signal about the first, and is treated as an incident.
  - `previousStatus === FAILED` — money moved for a payment the customer was
    told had failed. Recorded as `payment_completed_blocked_after_terminal`,
    flagged on the record (including the capture's own amount and the payer
    details a refund needs, under their own keys), queued for manual review,
    logged at error. `appendEvent` returns `capturedAfterDeath: true`.
- `routes/payments.js` — all three webhook routes honour `blocked` and emit
  nothing; they respond 200 (so the provider stops retrying) with
  `blocked: 'payment_already_failed'` or `'payment_already_completed'`. The
  `CHECKOUT.ORDER.APPROVED` guard widened from "already FAILED" to "already
  terminal", so an already-paid order is not captured a second time either.
  New ops endpoint: `GET /api/payments/:botId/captured-after-terminal`.
- `paymentGateway.js` — **`checkStatus` now returns before calling the provider
  at all** for an already-failed payment. This is the one place the system
  could itself move money after death: `PayPalProvider.checkStatus` self-heals
  an `APPROVED` order by *capturing* it, so merely polling a dead payment
  triggered a real capture that the post-hoc guard could refuse to record but
  could not undo. The post-hoc guard remains (widened to any terminal status,
  and it now returns the real terminal status rather than hardcoding FAILED),
  and the poll path honours `blocked` instead of reporting a COMPLETED the
  store rejected.
- `paymentStatusWorker.js` — the belt-and-suspenders guard now uses the
  emitter's `previousStatus` (the pre-write status) **and** the stored status,
  because each catches what the other misses: `previousStatus` catches
  "appendEvent already stamped COMPLETED onto the record", and a stored
  `FAILED` catches an emitter that passes a stale `previousStatus`. A stored
  `COMPLETED` is deliberately not terminal on its own — on the legitimate first
  completion the emitter has already written it, and testing that would block
  the very payment it should let through. It is also deliberately **not** keyed
  on the record's `capturedAfterTerminal` flag: a concurrent blocked delivery
  can stamp that flag while the legitimate completion's own `_onStatus` is
  still awaiting its store read, which would suppress the very completion it
  should let through (another review catch). When the worker *does* drop a
  COMPLETED against a FAILED record it now queues it for review too — that
  drop is reachable without `appendEvent` ever seeing a blockable write,
  because `_handleTimeout`'s read-then-write is not atomic. Both filers claim
  the same atomic Redis key first, so one incident produces exactly one
  queue entry — review showed the two paths otherwise racing to file two rows
  that disagreed on the amount (the order total vs the capture amount), which
  in a worklist for moving real money is worse than no entry at all.
- `app.js` / `routes/payments.js` — the payment operator routes
  (`captured-after-terminal`, `transactions/:transactionId`,
  `external/:externalRef`) are now behind the same admin token and rate limiter
  as the billing admin routes, and fail closed when no middleware is supplied.
  This rides along because the new endpoint hands out a list of live
  transaction ids, and the per-transaction route — labelled "safe: no PII",
  which was simply wrong — returns `customerPhone`,
  `metadata.paypalPayerName`, `paypalPayerContact` and `paypalShippingAddress`.
  Until now the only thing protecting it was transaction-id unguessability.

### The three required terminal states

1. **After a TIMEOUT message** — `FAILED` with `failureReason: 'TIMEOUT'`. Covered.
2. **After the link was already used** — `COMPLETED`. Covered: the second
   completion is refused, so no duplicate order; and the approval webhook no
   longer re-calls capture, so no second charge.
3. **After the order was cancelled** — covered, with a caveat worth stating
   plainly: **there is no distinct cancelled state in this system.**
   `PaymentStatus` is `PENDING / PROCESSING / COMPLETED / FAILED`, and
   `normalizeStatus` folds `CANCELLED`/`CANCELED` into `FAILED`. Nothing in the
   bot cancels an order today. A cancellation is therefore a `FAILED` payment
   carrying that `failureReason`, and the guard treats it identically. If a
   first-class cancelled state is wanted later, it should be added to
   `PaymentStatus` and to `TERMINAL_STATUSES` together.

## Killing the link at the source — not possible

The brief asked for the PayPal order itself to be voided at timeout, so the
link dies at source rather than only being refused on the way back in.

**PayPal Orders v2 has no cancel or void endpoint.** From PayPal's own v1→v2
migration documentation: `DELETE /v1/checkout/orders/{id}` has no v2
equivalent, `DELETE /v2/checkout/orders/{id}` returns `404 Not Found`, and the
`CANCELED` order status does not exist in v2 at all. PayPal's documented
strategy is literally "cancel in your system only, decline to call capture, and
let the order expire by itself".

`POST /v2/payments/authorizations/{id}/void` exists, but only applies to an
**authorization**, which a `CAPTURE`-intent order never creates. AfroMarket
creates orders with `intent: 'CAPTURE'` (`paypalProvider.initiatePayment`).

So no call was invented. The only way to get a real kill switch would be to
switch checkout to `intent: 'AUTHORIZE'` and void the authorization on timeout
— a genuine change to the payment flow (authorizations are valid 29 days,
capture becomes a separate step, and the money moves at a different moment).
That is a separate decision, not a bugfix.

## Accepted risk that remains

- **The PayPal link stays live until PayPal expires it.** Unavoidable, per the
  section above. The customer can still reach PayPal and pay. What is now
  guaranteed is only that the bot will not confirm an order for it.
- **Money can still be captured against a dead order.** The guard controls what
  *this service* does, not what PayPal does. That is precisely why blocked
  captures are flagged on the record and pushed to the review queue instead of
  being dropped.
- **The guard's memory is 30 days.** Beyond the terminal marker's TTL, a
  payment is indistinguishable from one that never existed, and a very late
  delivery would be processed as a fresh completion. PayPal's own retry window
  is ~3 days, so this is comfortable — but it is a window, not a proof.
- **The review queue is Redis, with a 180-day TTL.** It outlives the payment
  record (24 h), the terminal marker and the event ledger (30 days each), but
  it is not permanent storage and does not survive a Redis wipe. PR #295's
  `orders` table has since merged, so this now has a natural home in Postgres.
- **The operator routes now need the admin token.** They were effectively
  public before. If anything scripted was hitting them, it needs
  `Authorization: Bearer $BILLING_ADMIN_TOKEN`, and the service returns 503 on
  them when that token is unset. The queue entries still deliberately carry no
  PII, so the list itself stays safe to read.
- **The 10-minute timeout is unchanged.** It is the real trigger here: a
  customer who takes longer than ten minutes to finish a PayPal checkout gets
  told their payment failed, and both 2026-11-12 reproductions were customers
  paying ~24 minutes in. The guard makes the consequence safe; it does not make
  the timeout right.
- **An eCheck or risk-reviewed capture now ends as a blocked payment.**
  `mapCaptureStatus` returns PENDING for a PayPal capture that has not cleared,
  so the record stays non-terminal, `_handleTimeout` fires at 10 minutes and
  writes FAILED, and the eventual `PAYMENT.CAPTURE.COMPLETED` days later is
  correctly refused. Before this change the customer got a late confirmation;
  now they get a failure message and the payment lands in the review queue.
  Deterministic for any PENDING capture, and not fixed here — a payment with a
  recorded capture should not be timeout-able at all.
- **The review queue inherits `redisManager`'s fallback behaviour.** On a Redis
  error the manager falls back to in-process lists and stays disconnected, so
  entries written during an outage are not visible once Redis returns, and with
  `REDIS_URL` unset the queue is process-local and lost on restart. The
  fallback path also clamps the 180-day TTL to ~24.8 days. For the one
  structure whose job is "real money must not go quiet", that is a real
  limitation — it belongs in Postgres alongside the now-merged `orders` table.
- **No `LTRIM`, no dismiss.** The queue has no way to mark an entry handled and
  no cap; retention is per-key and sliding, so one unresolved entry is deleted
  together with the whole key when the key finally expires.

## How the money moved, and the duplicate webhook registration

The 2026-11-11 logs left this genuinely unexplained: the approval handler
**skipped** the capture call (the WARN proves it), and the poller had stopped
tracking twenty minutes earlier (`_stopTrackingKey` on timeout; the map is
in-memory), so `checkStatus`'s self-heal capture could not have run either —
yet `PAYMENT.CAPTURE.COMPLETED` arrived, which cannot happen without a capture.

Gustave's investigation on 2026-11-12 found the likely answer: **the PayPal
webhook is registered against two URLs at once**, and both received every
event and both returned HTTP 200:

- `botmanagerservice-dev-7fcf.up.railway.app/api/payments/webhooks/paypal/afromarket`
- `bot.botmanagementservice.eu/api/payments/webhooks/paypal/afromarket`

Those are different deployments. A second deployment running code without
PR #293's guard would have captured the order on approval while the guarded one
correctly refused — which matches the logs exactly, and matches a capture
appearing ten seconds after a skip.

**Action for the PayPal dashboard (not code):** remove the duplicate
registration so each event is delivered once. Until then every webhook is
processed twice and the weaker deployment decides the outcome. This fix makes
both deployments safe once they are both running this code, but it cannot make
a stale deployment safe.

## The money already captured: policy and open items

**Decided (per `paypal-post-timeout-capture-bug-fix-plan.md`, §9 option 2):**
block the completion, log it prominently, and reconcile by hand. No
auto-refund, no auto-confirm. That is what is implemented.

The rejected alternatives, for the record:

- **Auto-refund** via `POST /v2/payments/captures/{captureId}/refund` (the
  webhook payload carries the refund link directly). Cleanest in theory, but
  refunds are irreversible and a customer who genuinely wants the order gets
  their money pushed back instead of the goods. Revisit if blocked captures
  start happening more than about once a month.
- **Honour the order.** Rejected: it reintroduces the bug under another name.
  The customer was told twenty minutes earlier that the payment failed and may
  well have reordered.

Still outstanding, by hand: the three payments already captured
(`AM-E0XSRIE6A` €39.94, `AM-EZ1QNKF5D` €37.94, `AM-0BYOCLH44` €63.92) predate
this fix and are not in the review queue. Each needs refunding or shipping.

## Follow-ups not in this change

From Gustave's plan, in his priority order:

1. **Remove the duplicate PayPal webhook URL** (dashboard, ~2 min). Likely the
   actual reason money moved at all on 2026-11-11.
2. **Proxy the checkout link** — send
   `https://bot.botmanagementservice.eu/pay/{orderId}` to WhatsApp instead of
   the raw PayPal URL, and have that endpoint serve a "payment expired" page
   when the payment is terminal, otherwise redirect to the real PayPal
   checkout. PayPal gives us no way to void the order, but we control the link
   we send — **this is the only real way to kill it at source**, and it would
   prevent the customer ever reaching PayPal rather than refusing the result
   afterwards. Medium effort: a new endpoint plus storing the real
   `checkoutUrl` in metadata and returning the proxy URL from
   `initiatePayment`.
3. **Make `/payment-return` dynamic** — it currently says "✅ Payment received"
   unconditionally, including for a payment that just got refused. Cosmetic but
   actively misleading.
4. **Stop timing out a payment that already has a recorded capture** (the
   eCheck case above).
5. **Fix "Hi null,"** in the order confirmation — payer name not extracted on
   one of these paths.

## Tests

- `test/paymentTerminalStateGuard.test.js` — store-level: all three terminal
  states refused (parameterized, with `isIncident` separating a real
  captured-after-death from an ordinary repeat signal), a refused write proved
  not to restate amount/currency/metadata, `COMPLETED → FAILED` still allowed,
  normal `PENDING → COMPLETED` untouched, the duplicate-webhook race (two
  deliveries, different event ids, different amounts), event-id redelivery
  still deduped ahead of the guard, review-queue and PII expectations, a
  **positive control** that a legitimate completion still emits
  `payment.completed` even when a blocked repeat flags the record first, and
  the worker's drop path reaching the review queue.
- `test/paypalWebhookRoute.test.js` — end-to-end reproduction of this incident:
  `PAYMENT.CAPTURE.COMPLETED` after a TIMEOUT returns 200 with
  `blocked: 'payment_already_failed'`, emits no `payment.completed`, leaves the
  payment FAILED, and lands in the review queue.
- Two pre-existing tests were updated deliberately, not to make them pass:
  the approval-skip reason is now `payment_already_terminal`, and
  `paymentGateway.test.js` now asserts the provider is **not** polled at all
  for a failed payment (it previously documented "the capture itself is not
  preventable", which is no longer true).

Full suite: 501 passing.

Two further regression tests exist specifically for the holes review found in
the first draft of this fix, because neither is reachable through the paths the
incident itself exercised: a reversal must not demote a completed payment out
of terminal, and the guard must still hold after the payment record's own 24h
TTL has expired. Plus `test/paymentAdminRoutes.test.js` pinning the admin
gating (503 unconfigured, 401 missing/wrong token, 200 with the token, and
webhook routes never gated).
