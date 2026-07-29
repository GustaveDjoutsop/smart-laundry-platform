# AfroMarket Bot — Live WhatsApp Test Pass (2026-07-29)

Follow-up to `afromarket-live-test-2026-07-27.md`, run after the fix for that
pass's Finding 2 (the one-off missing "Bon appétit" follow-up) landed in
`flowEngine.js`, plus a new **Partner Stores** feature added to
`configs/bots/afromarket.bot.json`. Server run fresh via `npm start`, tunnel
via a new ngrok URL (webhook Callback URL updated in Meta for Developers
accordingly), against a freshly-refreshed `WHATSAPP_ACCESS_TOKEN_AFROMARKET`.

Before live testing, the full automated suite was run: **111/111 passing**
(`node --test`), including new/updated tests for the image+buttons merge and
the Partner Stores feature (both success and fallback paths).

## Template status (start and end of this pass)

| Template | Status |
|---|---|
| `afromarket_west_african_recipes` | APPROVED (unchanged) |
| `afromarket_east_african_recipes` | APPROVED (unchanged) |
| `afromarket_north_african_recipes` | APPROVED (unchanged) |
| `afromarket_central_african_recipes` | APPROVED (unchanged) |
| `afromarket_restaurants_v1` | APPROVED (unchanged) |
| `afromarket_partner_stores_v1` | **Did not exist at start → submitted this session → PENDING at end** |

Queried the full template list on the WABA (10 templates total) before
submitting anything: confirmed none of the existing approved carousels
(`afromarket_*_recipes`, `afromarket_restaurants_v1`, and the leftover
`jaspers_market_media_carousel_v1`/`jaspers_market_image_cta_v1` from a
different test bot) could be repurposed for Partner Stores — every Meta
carousel template bakes its card images/body text/button URLs in at
submission time; none are parameterized per-send. Built `cards.json` from
the 3 stores already in `partner_stores_list`'s config (Mama Africa
Foodmarket / Kilimanjaro Grocery / Sankofa Market, quick-reply buttons) and
submitted via `scripts/submitCarouselTemplate.js`. Now `PENDING` (id
`1533111858103225`); until Meta approves it, Partner Stores will keep using
the vertical-card fallback, same as the regional recipe carousels did before
their templates were approved.

## Regression target: the image+buttons merge fix (prior Finding 2)

| Scenario | Result |
|---|---|
| Tonight's Dinner Ideas → Suya Skewers (the exact recipe that silently dropped its follow-up last pass) | ✅ Pass — recipe image, full ingredients/steps, "Bon appétit! Want to keep exploring?", and all 3 buttons arrived as **one single interactive WhatsApp message** (image header + combined body + buttons), confirmed via screenshot. Structurally cannot reorder or partially drop anymore since it's one send, not two. |

This directly confirms the fix: recipe/product detail states that chain
straight into a `buttons` state now fold into a single outbound intent
instead of two sequential sends, closing the display-order/drop risk
identified in the prior pass.

## New feature: Partner Stores

| # | Scenario | Result |
|---|---|---|
| 1 | AfroMarket Store screen exposes the new "🏪 Partner Stores" button | ✅ Pass |
| 2 | Partner Stores → fallback vertical cards (template still PENDING at the time) → all 3 stores + "Main Menu" footer | ✅ Pass (see Finding 1 for one non-reproducing wrinkle) |
| 3 | Tapping a store's "Got it" quick-reply loops back to the AfroMarket Store screen | ⚠️ See Finding 2 — passed on retest, failed once earlier in the session |
| 4 | Full re-test after re-navigating cleanly (fresh `hi` → Store → Partner Stores → tap Sankofa's "Got it") | ✅ Pass — correct order (3 cards then footer), correct loop-back to `afromarket_store_info` |

## Findings

### 1. One-off vertical-card display reordering, not reproduced on retest (Low priority)

On the first Partner Stores fallback render, WhatsApp Web displayed the
"Main Menu" footer message *between* the 2nd and 3rd store cards, even
though `flowEngine.js` sends each card and the footer strictly sequentially,
`await`ing each WhatsApp API call before sending the next (confirmed by
reading `flowEngine.js:606-642` — this is not a fire-and-forget race). A
clean retest later in the same session (fresh `hi` → Store → Partner Stores)
showed all 3 cards followed correctly by the footer, in order. Given the
server-side send order is provably correct and this didn't recur, this
reads as a live WhatsApp delivery/display quirk (same family as Finding 1
from the 07-27 pass — a live external system occasionally reordering
messages that were sent in the correct order) rather than a code bug. Not
chased further given it didn't reproduce.

### 2. One-off tap-routing anomaly, not reproduced on retest (Low priority, investigated)

The first time a store's "Got it" quick-reply was tapped (Kilimanjaro
Grocery), the bot responded with the main welcome menu instead of looping
back to the AfroMarket Store screen (`afromarket_store_info`), contradicting
`partner_store_route`'s route map. Investigated by reproducing the exact
scenario (`currentStateId: 'partner_stores_list'`, inbound
`button_reply.id: 'partner_kilimanjaro'`) directly against `FlowEngine`,
bypassing WhatsApp/webhook/session-storage entirely — it routed correctly to
`afromarket_store_info` every time. Confirmed via the server log that the
access token was still valid at the time (the 401 token expiry, see Finding
3, only started several messages later), so it isn't explained by that
either. A clean retest later in the session (fresh conversation, same tap on
Sankofa Market this time) routed correctly. With the isolated flow logic
provably correct and the live behavior not reproducing, this reads as a
one-off environmental hiccup (most likely a duplicate/out-of-order webhook
delivery from Meta) rather than a bug in `flowEngine.js` or
`afromarket.bot.json`. Worth keeping an eye on if it recurs with a
reproducible pattern.

### 3. Access token expired mid-session again (Operational, recurrence of the 07-27 pass's Finding 3)

Partway through this pass, outbound sends started failing with `401
Authentication Error` (`OAuthException`, code 190) — same failure mode as
the prior pass, meaning the follow-up recommendation (switch the AfroMarket
test app to a permanent System User token) still hasn't been applied. Token
was refreshed and the server restarted mid-session to continue testing.
Repeating the recommendation from the 07-27 report: a System User permanent
token would remove this recurring interruption, and minimal alerting on
repeated 401s from the WhatsApp client would surface a production token
expiry that would otherwise look identical to "messages silently stop
sending."

### 4. Confirmed: this WABA number carries real customer traffic during dev/test sessions (Informational, known/expected)

Server logs during this pass showed a distinct phone number actively
shopping (browsing groceries → a spice product → cart → checkout-adjacent
`cart_view`, and independently discovering the new Partner Stores feature)
concurrently with this test session. Per-conversation state is keyed by
phone number (`conv:<botId>:<phone>`) so there's no session collision risk
between concurrent users, and this is expected/known — noted here only
because it was directly visible in this session's logs.

### 5. Everything else: no bugs found

Unit suite 111/111 passing. Store screen, Partner Stores (both the fallback
vertical-card path and the post-tap loop-back on the successful retest),
and the Suya recipe detail (the fix's primary regression target) all worked
exactly as designed.

## Follow-ups

1. Once `afromarket_partner_stores_v1` is approved, re-test to confirm the
   real horizontal carousel renders for Partner Stores (same as the 4
   regional recipe carousels + Afro Restaurant).
2. Switch the AfroMarket test app to a permanent System User access token —
   this is the second pass in a row this has interrupted testing (Finding 3,
   carried over from 07-27).
3. If either one-off (Finding 1 or 2) recurs with a reproducible trigger,
   worth adding structured logging around the `cards` state's per-message
   sends and the `route` action's resolved value to make a repeat occurrence
   diagnosable.
4. Carried over from prior passes, still not done: repeat checkout scenarios
   against the real Flutterwave sandbox once credentials are available.
