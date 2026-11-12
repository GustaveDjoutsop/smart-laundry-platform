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

  Winning that `setnx` is also how the terminal state is claimed. Reading the
  marker and then writing the snapshot is check-then-act across processes: a
  completion could read "not terminal", pause, and overwrite a timeout that
  had written FAILED and already messaged the customer. `setnx` has no such
  gap, so a completion that loses the claim is refused rather than silently
  winning the write. A payment that was already terminal before this shipped
  has its marker backfilled from the snapshot on the next event, which closes
  the deploy window.

  The marker carries the amount and currency as well as the status, so the
  "second capture or the same one reported twice" comparison still works after
  the snapshot's 24h TTL. Amounts are compared in minor units, never as raw
  floats — the AfroMarket cart total can carry more decimals than PayPal's
  two-decimal capture amount, and a strict comparison reported every ordinary
  repeat as a second capture.

  Both pre-capture guards (`CHECKOUT.ORDER.APPROVED` and
  `PaymentGateway.checkStatus`) consult the marker too, not just the snapshot.
  Those two are what stop a capture *happening*, rather than merely refusing
  to record one, so they must not be the weaker check.

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

## Confirmed 2026-11-12: the duplicate webhook registration IS how the money moves

The guard shipped and was exercised the same evening, twice
(`977492012G475341S` €35.95 / order `AM-B1VA013V5`, and `6M6353120A058410B`
€43.94). It behaved correctly both times: `CHECKOUT.ORDER.APPROVED` was
refused, no order was confirmed, no "Payment received" reached the customer,
and both landed in the manual-review queue:

```
18:46:25 [WARN]  PayPal CHECKOUT.ORDER.APPROVED received for already-terminal payment;
                 skipping capture {"orderId":"977492012G475341S","status":"FAILED","failureReason":"TIMEOUT"}
18:46:45 [ERROR] Webhook reported a completed payment that had already failed; queued for
                 manual review {"transactionId":"977492012G475341S","terminalStatus":"FAILED","amount":35.95}
```

**And the money still moved.** PayPal captured €35.95 (capture
`28D9845161149043F`, `create_time` 18:46:24Z) although this service demonstrably
never called capture.

The webhook event's own `transmissions` block settles why, and it is not
PayPal auto-capturing. Both registered URLs returned HTTP 200, with
**different response bodies**:

| Endpoint | `Content-Length` | Body |
|---|---|---|
| `bot.botmanagementservice.eu` | 46 | `{"ok":true,"blocked":"payment_already_failed"}` |
| `botmanagerservice-dev-7fcf.up.railway.app` | 49 | `{"ok":true,"blocked":"payment_already_completed"}` |

The two deployments disagreed about the same payment. For the second to call it
*already completed*, it must already have recorded a completion.

That alone would only be an inference — recording a completion is not the same
as sending the capture request. The **dev deployment's own runtime logs**
close the gap:

```
18:46:32  POST /api/payments/webhooks/paypal/afromarket 200 11 - 3276.098 ms
18:46:32  [INFO] Payment completed but no machineId in payment metadata
                 {"botId":"afromarket","transactionId":"977492012G475341S"}
18:46:37  [INFO] Ignoring a repeat completion signal for an already-paid payment
                 {"transactionId":"977492012G475341S"}
18:46:37  POST /api/payments/webhooks/paypal/afromarket 200 49 - 1164.607 ms
```

Three things there are decisive, and the same pattern repeats exactly for
`6M6353120A058410B` at 18:49:59:

1. **3276 ms** on the `CHECKOUT.ORDER.APPROVED` delivery, against **667 ms**
   for the same event on production, where the guard fired and returned
   without calling PayPal. The extra ~2.6 s is the outbound capture call.
2. The 11-byte `{"ok":true}` is the branch that runs **after**
   `recordPaypalCapture` succeeds. Neither the terminal-skip (48 bytes) nor
   the blocked (46/49 bytes) branch can produce it.
3. `payment.completed` fired on dev, which only happens from a capture
   response it recorded itself.

So: **the dev deployment performed the capture**, confirmed from its own logs
rather than inferred from the other instance's recorded state.

It could, because it had no record of the payment at all. The order was created
by the other instance, so every terminal guard on the capturing instance was
keyed on state it did not have: `existingPayment` null, marker null, so
`terminalStatus` null, and the code fell straight through to `captureOrder`.
A guard that reads "is this payment terminal?" cannot stop an instance that has
never heard of the payment.

This also retrospectively explains 2026-11-11, where a capture appeared ten
seconds after a skip that our own logs prove did not capture. It was never
PayPal auto-capturing a CAPTURE-intent order; the comment in
`routes/payments.js` asserting PayPal never does so stands.

### Fix: capture fails closed on an unknown payment

`CHECKOUT.ORDER.APPROVED` now refuses to capture when the instance has neither
a payment record nor a terminal marker, returning
`skipped: 'payment_unknown_to_this_instance'`. A legitimate approval always has
a record — it is written at `initiatePayment` with a 24h TTL and a PayPal order
expires in about three hours — so "no record" means a foreign or long-dead
order, and capturing it is never right.

This makes the duplicate registration harmless rather than merely undesirable.
**Removing the duplicate URL is still the first thing to do**, because it is a
two-minute dashboard change that removes the whole class, and because a
deployment running older code would still capture.

## The original 2026-11-11 analysis, superseded by the above

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

## The proxy payment link

PayPal gives us no way to kill the order. We do control the link we send, and
that turns out to be the only place a dead payment can be stopped *before* the
money moves rather than refused afterwards.

The bot now sends `https://<PAYMENT_LINK_BASE_URL>/pay/{botId}/{transactionId}`
in WhatsApp instead of the PayPal checkout URL. `routes/paymentLink.js` looks
the payment up when the customer clicks:

| State at click time | Response |
|---|---|
| Live (not terminal) | `302` to the stored `providerCheckoutUrl` |
| Timed out / cancelled | `410`, "Payment expired — type **menu** to begin" |
| Already paid | `410`, "Already paid" |
| Unknown id, or no stored provider URL | `404`, "Link not valid" |

`PaymentGateway.initiatePayment` returns the proxy URL as `checkoutUrl` (what
the customer is sent) and keeps the real one as `providerCheckoutUrl`. With
`PAYMENT_LINK_BASE_URL` unset it returns the provider URL unchanged, so an
environment that has not configured one behaves exactly as before.

`no-store` is set on every response including the 302 — a cached redirect would
send the next click straight to PayPal without the check running at all, which
would defeat the endpoint entirely.

Three things came out of review and are worth recording, because each one
would have shipped quietly:

- **The proxy must not paper over a provider that returned no checkout URL.**
  The first draft built a proxy link from the transaction id alone, so
  `checkoutUrl` was always truthy. That silenced `afromarketFlowPlugin`'s
  `!payment.checkoutUrl` throw — the check that turns a broken provider
  response into a loud failure which *preserves the customer's cart*. The cart
  would have been cleared and the customer handed a link that could only ever
  say "no longer valid".
- **Unset config must be loud.** `parseTrimmedUrl` treats "not set" as valid,
  so an unset `PAYMENT_LINK_BASE_URL` logged nothing at all: the protection
  would be absent and the logs identical to a working deployment. It now logs
  at error when a redirect-based provider is registered without it, matching
  the `returnUrlMissing` / `stripeSuccessUrlMissing` pattern already in that
  file. The value itself must be a bare https origin — `postgres://`,
  `javascript:`, plaintext http and a base URL carrying a path all parse fine
  and all produce a dead or unclickable link.
- **The redirect target is validated, not trusted.** `providerCheckoutUrl`
  comes from the provider's own API over TLS and is not attacker-reachable —
  every writer was traced. But this endpoint deliberately teaches customers
  that `https://<our domain>/pay/...` is where they go to pay, which makes an
  open redirect on that path a high-value phishing primitive, one careless
  field spread away. The target must now be https and on a host belonging to
  the payment's own provider.

Not addressed here, and worth knowing: `app.set('trust proxy', true)` means
every rate limiter in this service keys on a client-supplied
`X-Forwarded-For`, so the limit on this new public endpoint is bypassable.
Pre-existing and touches every route, so it belongs in its own change.

**What this does not cover, stated plainly:** the check happens when the link
is *clicked*. A customer who opens the PayPal page while the payment is still
live and completes it twenty minutes later has already been redirected, and
PayPal will capture. That is exactly the shape of the 2026-11-12 cases
(`AM-B1VA013V5`: created 19:35, timed out 19:45, approved 19:46). The
terminal-state guard still refuses to confirm the order and it still lands in
the manual-review queue — so the proxy narrows the window rather than closing
it.

Closing it properly means not declaring failure at ten minutes in the first
place: that timeout is a mobile-money number, while a PayPal order stays
payable for about three hours. A PayPal-specific timeout would have let both
2026-11-12 customers simply be confirmed normally, which is what they expected.
That remains open — see the follow-ups below.

## Follow-ups not in this change

From Gustave's plan, in his priority order:

1. **Remove the duplicate PayPal webhook URL** (dashboard, ~2 min). Likely the
   actual reason money moved at all on 2026-11-11.
2. ~~**Proxy the checkout link**~~ — **done, see below.**

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

Full suite: 520 passing.

Two further regression tests exist specifically for the holes review found in
the first draft of this fix, because neither is reachable through the paths the
incident itself exercised: a reversal must not demote a completed payment out
of terminal, and the guard must still hold after the payment record's own 24h
TTL has expired. Plus `test/paymentAdminRoutes.test.js` pinning the admin
gating (503 unconfigured, 401 missing/wrong token, 200 with the token, and
webhook routes never gated).
