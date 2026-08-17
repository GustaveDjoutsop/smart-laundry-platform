# AfroMarket WhatsApp Bot

## v2.27 (2026-08-17): "Show catalog" only worked on a customer's literal
## first message; a subagent review also caught 3 issues in the same-day
## v2.26 work before it shipped

Business owner live-tested the "Show catalog" Ice Breaker (set live in
v2.26/v2.21) past a customer's first message and got the catalog stacked
with an unrelated flow-engine response - the exact duplicate-message
pattern v2.24 already fixed once, but for a case v2.24 didn't cover: v2.24
only made the customer's *literal first-ever message* catalog-only. Any
later message - including "Show catalog" tapped again, or typed by hand -
still fell through to the normal flow engine, which doesn't recognize that
phrase as anything meaningful (same unpredictable-routing issue already
flagged as a separate open item in v2.24 for "Hello again").

**Fixed**: `catalogWelcome.body`/`footer`/`thumbnailProductRetailerId` in
`afromarket.bot.json` gets a new sibling, `triggers: ["Show catalog"]` - an
array of exact-match (case/whitespace-insensitive) phrases that ConfigBot
now checks on every message, not just the first. A match always sends
catalog-only, regardless of whether this is the customer's 1st message or
50th - unlike the claim-based first-contact path, there's no "once"
semantics here by design, matching what the business owner actually asked
for ("always and only").

**A real design flaw surfaced while building this**: the existing
`hasPreStagedWork` safeguard (added in v2.24 specifically to stop a
native-order checkout from being silently stranded) reads
`Boolean(conversationState.currentFlowId)` - true not just for that narrow
case, but for practically *every* returning customer, since the flow
engine sets `currentFlowId` on every ordinary turn. Applying that same
guard to the new explicit-trigger path would have made "Show catalog"
correctly catalog-only for a customer's first message, then silently
broken (catalog + stray flow-engine response again) for every message
after - caught by the test suite itself before shipping, not by a second
live incident. Fixed by scoping `hasPreStagedWork` to gate *only* the
claim-based first-contact path, where it's actually a precise signal
(true there only when another caller staged real work this exact turn,
since no earlier turn could have written `conv:` state otherwise). The
explicit-trigger path always skips the flow engine on a successful send -
correctly safe to do, since a customer's existing state isn't lost by
skipping, just paused, and resumes normally on their next ordinary
message. Four new tests cover this directly (returning customer, case/
whitespace insensitivity, fires every time not just once, plain text
containing "catalog" as a substring does *not* false-positive).

**Same-day subagent review also caught 3 issues in v2.26's own diff before
it was committed** (that work was still unshipped when this fix started):
- `submitCatalogBatch.js`'s `salePriceEur` validation only checked
  `salePrice < priceEur`, so a negative value (e.g. a stray "-" typo) was
  accepted - `-1 < 4.99` is true, and Meta would have received
  `sale_price: "-1.00 EUR"` with no local validation catching it. Now also
  rejects `salePrice <= 0`.
- `sendPromoTemplate.js`'s percent-off argument silently truncated
  decimals (`Math.trunc(20.9)` → `20`) instead of rejecting them, despite
  the usage text saying "must be a whole number" - a fat-fingered decimal
  would have quietly sent a different discount than typed. Now rejects
  non-integers outright.
- `sendPromoTemplate.js` called `dotenv.config()` unconditionally at
  module load, unlike its sibling `submitCatalogBatch.js`, which guards it
  behind `require.main === module` specifically so requiring the file as a
  module doesn't trigger the side effect. Matched the existing pattern.

**A second, more severe issue surfaced on a follow-up review of the
"Show catalog" fix itself, before *that* shipped either**: making the
explicit-trigger path "always send" also made it always send *unprotected*
against Meta's documented at-least-once webhook redelivery - the exact
duplicate-send failure mode this whole feature exists to prevent, just
reintroduced via a different path. The claim-based first-contact path was
already race-safe (an atomic `setnx` on a 90-day key), but the new
explicit-trigger branch forced `shouldSend = true` unconditionally, with no
Redis guard at all - two deliveries of the same "Show catalog" tap
(concurrent or redelivered) would each independently decide to send,
double-carding the customer. Fixed with a second, purpose-scoped dedup key,
`catalog_trigger_msg:{botId}:{messageId}`, `setnx`'d on a 24-hour TTL
(deliberately much shorter than the 90-day first-contact claim - it's
guarding one event, not a customer relationship, and a genuinely new tap
minutes later must still go through). Degrades to allow-send if
`message.id` is ever absent, rather than silently blocking a real customer's
request. Two new tests cover this directly (same message id delivered
twice → one send; two distinct message ids → two sends). Also fixed in the
same pass: `_sendCatalogWelcome`'s log line unconditionally said
"(first message)" even when the send came from an explicit trigger on a
returning customer - now takes a `reason` param from the caller.

348/348 tests passing.

## v2.26 (2026-08-16): manual promo-send trigger; native sale_price wired
## into the catalog sync

**Manual promo trigger, built and live-verified**: `scripts/
sendPromoTemplate.js <phone-number-id> <to-e164> <product-id> <percent-off>`
sends the approved `afromarket_promo_v1` template (Variant A, the one with
a working receiving side) to a single customer. Takes phone-number-id as
an explicit argument, same safety discipline as
`setConversationalAutomation.js` - this is an outward-facing send, and
sandbox-vs-production is not a "just retry" mistake to get wrong. Tested
end to end on the sandbox number: template arrived with correct image/
body/button, tapping "Shop Now" correctly added Bouillie Jaune at 20% off
(€3.99) to the cart via the existing `payloadTriggers`/
`products.addDiscounted` wiring - no new receiving-side code needed, it
already worked. Deliberately does not support `afromarket_promo_code_v1`
(Variant B) - that one ships with a dead-end placeholder link instead of
routing back into the bot (see v2.17), so sending it for real would hand a
customer a broken button.

**Investigated whether a promotion can show up inside the catalog
browsing view itself**, not just as a one-off message - prompted by a
reference screenshot of a rich "Categories + Top Deals" storefront layout.
Checked directly rather than assumed: that exact layout isn't a real,
creatable AfroMarket template (checked WhatsApp Manager's actual Template
Library - Utility/Authentication only - and the existing `catalog_prod_v1`
template, which is a plain "View catalog" button, no rich preview). The
reference screenshot showed "Jasper Market's" as the business name, which
turned out to be Meta's own real, verified demo WhatsApp Business account
(see below) - not a template feature AfroMarket can configure.

What IS real, confirmed directly in Commerce Manager: every product has a
native `sale_price` field (strikethrough discount pricing wherever the
catalog is browsed) - present but "Missing" on all 5 AfroMarket products
before this. **Wired into `submitCatalogBatch.js`**: an optional
`salePriceEur` field per product in `bot.json`, mapped to Meta's
`sale_price`, validated to be strictly less than `priceEur` (throws before
sending anything otherwise - a silent Meta-side rejection would be much
harder to debug). Set on Bouillie Jaune (€4.99 → €3.99, matching the promo
tested above) and synced to the production catalog - **confirmed live in
Commerce Manager**: the product now shows "€3.99 ~~€4.99~~" with real
strikethrough pricing. Not yet independently confirmed how this renders on
the customer-facing "View Catalog" screen specifically (hit repeated
browser-navigation issues reaching it in the same session) - the
Commerce-Manager-level confirmation is solid; the exact customer-facing
render is still open.

Commerce Manager's "Sets" feature (Meta's real name for catalog
"Collections") currently has only one set, "All Products" - no
category-based sets exist yet, so there's no "Categories" row in
AfroMarket's native catalog browsing screen today either. Out of scope for
this entry - a business-content decision (which categories, which products
go in "Top Deals"), not a code change, same pattern as the empty Cooking
Powder category noted back in v2.10.

**"Jasper's Market" - real business, not a mockup.** While investigating
the reference screenshot, ended up sending "Get started" to a genuine,
Meta-verified WhatsApp Business account by that name - very likely Meta's
own official demo/showcase business for the WhatsApp Business Platform,
which would explain the resemblance. The send was unintentional (a stray
click while searching WhatsApp Web, not deliberate). Flagged to the
business owner rather than quietly continuing. 340/340 tests passing.

## v2.25 (2026-08-16): all 4 pending templates now APPROVED on both WABAs

Checked via `scripts/checkTemplateStatus.js` against both WABAs (not
assumed from the last-known `PENDING` status recorded when each was
submitted):

- `afromarket_restaurants_v2` - APPROVED (sandbox id `1256941286482149`,
  production id `2188265671958576`) - already confirmed in v2.14, still
  approved.
- `afromarket_partner_stores_v2` - **now APPROVED** (sandbox id
  `1075297564846605`, production id `1931253917551627`) - was `PENDING` as
  of v2.11's submission.
- `afromarket_promo_v1` (Variant A, no code) - **now APPROVED** (sandbox id
  `1532686888903765`, production id `1368662388709270`) - was `PENDING` as
  of v2.17's submission.
- `afromarket_promo_code_v1` (Variant B, with code) - **now APPROVED**
  (sandbox id `2319403952198773`, production id `1733157687904263`) - was
  `PENDING` as of v2.17's submission.

**What "approved" actually unlocks, checked per template** (approval alone
doesn't mean a template is in active use - see v2.14's own caveat about
this):

- Both carousels (`afromarket_restaurants_v2`, `afromarket_partner_stores_v2`)
  are referenced directly in `configs/bots/afromarket.bot.json` (lines 546,
  711) and already wired into the live flow - now that they're approved,
  they should just work end-to-end for real customers without further
  changes.
- `afromarket_promo_v1`: the *receiving* side is wired (tapping its
  quick-reply button correctly routes to the discounted cart via
  `FlowEngine.matchPayloadTrigger`/`payloadTriggers`), but nothing in the
  codebase currently **sends** this template to a customer - grepped
  `src/`/`configs/` for the template name and found no call site. Promo
  blasts are business-initiated marketing sends, not something the bot
  triggers automatically in response to a message, so this is expected -
  worth noting as a real gap only if/when an automated promo-sending
  trigger (scheduled, admin-command, etc.) is actually wanted.
- `afromarket_promo_code_v1`: approved but not wired into anything, per
  v2.17's own note (built "per explicit instruction, not wired into live
  sending").

## v2.24 (2026-08-16): first contact showed catalog + normal flow stacked
## together; QR code now prefills a message; Ice Breakers re-enabled

Business owner live-tested v2.23's fix on production and reported the
customer's first "Hi" produced **two** messages back to back: the catalog
welcome card, immediately followed by the normal flow engine's own
`welcome` list response ("Welcome to AfroMarket! ... What can we help you
with today?"). Working as coded, not as intended - `ConfigBot.handleMessage`
sent the catalog and then *still* ran the same message through
`flowEngine.step()`, which produces its own greeting regardless.

**Fixed**: a customer's genuine first contact now gets the catalog welcome
*only* - `handleMessage` returns immediately after a successful catalog
send, skipping the flow engine (and conversation-state persistence) for
that turn. Mirrors the old `request_welcome` design's own intent more
closely than v2.23 did (it never touched flow state either - wasn't a real
conversation turn). The flow engine's own welcome/menu only appears from
the customer's *next* interaction onward. A failed catalog send still falls
through to the flow engine as a fallback (`_sendCatalogWelcome` now returns
a success boolean) - a missed catalog card beats silence, but a
*successful* one no longer gets a redundant second message stacked on top.

**Second bug caught by a subagent review before this shipped**: the naive
"skip the flow engine on a successful catalog send" rule breaks
`AfroMarketBot._handleNativeOrder`, which stages real work (a submitted
cart, `checkout_start` state) in `conv:{botId}:{from}` *before* calling
`super.handleMessage()`. If that customer's native-cart submission also
happened to be their first-ever contact, the early return would have
silently stranded their order - no checkout continuation, no error, no
trace, just gone. Fixed by checking whether `conversationState` already had
a non-null `currentFlowId` (i.e. another code path staged real work) before
deciding to skip the flow engine - if so, the flow engine still runs this
turn regardless of whether the catalog also sent, so an order is never
lost even at the cost of one extra catalog card alongside it. New test
covers this exact scenario end-to-end (pre-staged checkout + first-contact
catalog claim; asserts both the catalog sends AND the checkout actually
advances past `checkout_start`, not just that a catalog message went out).
335/335 tests passing.

**Separately, chased down what's actually achievable for the "scan QR code
→ content appears automatically" ask** (the business owner initially
proposed doing this via an approved Message Template on the Messages
endpoint - confirmed via research this doesn't work: Templates solve a
different problem, re-engaging an *already-known* contact outside the 24h
window, not reaching someone whose phone number the business doesn't have
yet). Two things verified and shipped instead:

1. **QR code regenerated with a prefilled message**, via WhatsApp's own QR
   Code Management API (`POST /{phone-number-id}/message_qrdls`,
   `prefilled_message: "Show me the catalog"`). Live-verified via the
   resulting `wa.me/message/{code}` deep link: opens with the message
   already typed in the compose box - one tap to send instead of the
   customer having to type something themselves. Not truly zero-tap (WhatsApp
   never auto-sends without an explicit tap - confirmed, not assumed), but
   the closest the platform allows. Saved as
   `afromarket-whatsapp-qr-prefilled.png`, not yet swapped in for the
   existing printed/shared QR code pending business owner confirmation.
2. **Ice Breakers (`conversational_automation.prompts`) confirmed still
   live and functional** - unlike `enable_welcome_message`, Meta's Mar 27
   changelog entry never mentions removing these, and they don't depend on
   the dead `request_welcome` webhook at all (tapping one just sends that
   exact text as a completely normal, still-fully-supported message).
   Set live on production: "Show catalog", "Get recipe ideas", "Current
   promo", "AfroMarket Store". **Real platform limitation hit and worked
   around**: the requested emoji (🛒🍲🎉🏪) get silently corrupted to the
   Unicode replacement character by this specific Graph API field -
   confirmed via direct API round-trip (POST then GET), isolated to emoji
   specifically (plain symbols like `☆` persist fine, `❤` doesn't - not a
   simple BMP/astral-plane split). Shipped as plain text instead of
   guessing further.

**Open product question, not yet resolved**: with the current design, *any*
first message - including an Ice Breaker tap - triggers the catalog-only
response, regardless of what the customer actually tapped/typed. A
first-time customer tapping "Get recipe ideas" or "Current promo" would see
the generic catalog card, not recipe/promo content, and would need to
interact again to reach it. Whether that's acceptable or those three
Ice Breakers need to route to their specific content even on a genuine
first contact is a decision for the business owner, not something assumed
here.

## v2.23 (2026-08-16): root cause found - Meta removed request_welcome
## entirely; replaced with catalog-on-first-message, dead code removed

**Root cause, confirmed against Meta's own official changelog** (not
third-party docs, learning v2.16's own stated lesson the hard way):

> **Mar 27, 2026 - Cloud API, Conversational Components:** "Removed the
> `request_welcome` webhook and welcome message feature from conversational
> components. **This feature is no longer supported.** The
> `enable_welcome_message` parameter has been removed from the
> Conversational Automation API."

`ConfigBot._handleRequestWelcome` (v2.16, built 2026-08-13/14) targeted a
mechanism Meta had already killed **4.5 months earlier**. This fully
explains every symptom chased across v2.16-v2.22: `GET
.../conversational_automation` now 404s ("(#100) Tried accessing
nonexisting field"); zero webhook traffic ever reached `production` across
two live tests in this session; and v2.19's `enable_welcome_message: true`
confirmation was reading/writing a field that no longer does anything
functional. Meta's replacement, "Welcome Message Sequences" (added Aug 11,
2025), only covers Click-to-WhatsApp ads - not organic wa.me/QR-code/
business-profile entry, so it wouldn't have covered AfroMarket's actual
customer paths even if adopted.

**The business owner's own 2026-08-14 screenshot** (chat showing the
catalog message ~16:38, after a 15:29 test send) initially looked like
counter-evidence, live on `dev`. Resolved by reading `dev`'s raw Railway
logs for that exact window: two `POST /api/whatsapp/webhook 200` calls did
land at 16:38:38 (~13ms/~9ms, no errors) - but neither produced
`ConfigBot.handleMessage`'s unconditional log line (`handled message
from...` or `sent catalog welcome message...`), which appears nowhere in
`dev`'s logs across the full 7-day retention window covering the feature's
entire lifetime. Conclusion: those two webhook calls were outbound
delivery-status receipts (sent/delivered), not inbound `request_welcome` -
generated because *something* called `sendCatalogMessage()` directly against
the real API outside the app (a Claude Code session manually verifying the
send mechanism, matching `5e84695`'s own commit message: "Live-verified
against the real API"), not because Meta delivered the event.

**Fix**: there is no way left to react to a customer opening the chat
before they type anything - that door is closed platform-side, permanently.
The closest achievable substitute, and what's now shipped: send
`catalogWelcome` once on the customer's **genuine first message**, then let
that same message continue through the flow engine as normal. Reliable by
construction - it depends on nothing Meta can deprecate out from under it
again, and covers every entry path (wa.me, QR code, business profile, CTWA
ads) uniformly instead of only one Meta-blessed trigger. A failed catalog
send (e.g. a transient Graph API error) is caught and logged, never blocking
the customer's actual message from being answered.

**First draft of this fix used the flow engine's own `conv:{botId}:{from}`
Redis key to detect "new customer" - a subagent review before commit caught
two real problems with that**: (1) `AfroMarketBot._handleNativeOrder`
persists that exact key *before* calling `super.handleMessage()`, so a
customer whose first-ever contact is a native WhatsApp cart submission
(not plain text) would look like a returning customer and never get
welcomed; (2) two concurrent deliveries of the same new customer's first
message (Meta documents at-least-once webhook redelivery) could both read
"no state" and both send the catalog card. **Shipped instead**: a dedicated
`catalog_welcome_sent:{botId}:{from}` key, claimed atomically via
`redisManager.setnx` (already existed in the codebase, just unused here) -
independent of whatever the flow engine or other code paths do with
conversation state, and immune to the race since only one `setnx` call can
win the claim. TTL set to 90 days (deliberately longer than the
conversation-state TTL) so this behaves as "once, effectively permanently"
rather than re-welcoming a customer who's merely gone quiet for a while.
Both scenarios now have dedicated regression tests. Residual, accepted risk:
a genuine Redis outage could still cause an extra catalog send if a customer
messages again during it (setnx fails soft to a per-process fallback) -
judged acceptable rather than gating the send on `redisManager.connected`,
which would silently disable it for any local/dev setup without real Redis.

**Removed as dead code**: `ConfigBot._handleRequestWelcome`, the
`request_welcome` type-check in `handleMessage`, `scripts/
setConversationalAutomation.js` (POSTs to a Graph API field that no longer
exists), and `test/configBotRequestWelcome.test.js`. Replaced by
`ConfigBot._sendCatalogWelcome` and `test/configBotCatalogWelcome.test.js`.
`whatsappHandler.js`'s "message present but no usable identifier" guard
(v2.21) stays - it's a generic safety net, not specific to `request_welcome`
- comment updated to not perpetuate the now-resolved theory. 334/334 tests
passing.

## v2.22 (2026-08-16): production was silently 2 days stale - v2.21's fix was
## never live; redeployed and retested, no webhook traffic arrives at all

Before v2.21's `shapeOf()` logging could be observed against a real event,
checked whether it had actually reached production. It hadn't:
**`production`'s active Railway deployment was still PR #97 (merged
2026-08-14 14:28), four merges behind `master`** - including v2.21's own
logging commit (`91e6afb`, merged that same morning), the
`setConversationalAutomation.js` endpoint fix (`ba72969`), and the
production-catalog-support commit (`2716c5c`). Root cause: `production`'s
GitHub branch connection has **"Auto deploy" disabled** (Railway service
settings → Source), contrary to what `DEPLOYMENT.md` documented at the
time ("both environments auto-deploy on every push to `master`") - that
claim was simply wrong for `production`, corrected in the same session.
Nothing merged to `master` reaches real customers until someone manually
runs Railway's command-palette "Deploy latest commit" action; see
`DEPLOYMENT.md` §2a (new) for the exact steps.

**Deployed `master` HEAD (`91e6afb`) to production manually** and confirmed
via Railway's Deployments tab (`ACTIVE`, "Deployment successful", old PR #97
moved to `HISTORY`/`REMOVED`).

**Retested live twice** - once immediately before this deploy, once ~40s
after it went `ACTIVE` - both via WhatsApp Web
(`web.whatsapp.com/send?phone=4915905495011`) opening a chat with zero
prior message history, no "Hi" sent either time. **Both times: zero webhook
traffic reached `production` at all** - not just no catalog message, but
literally no `POST /api/whatsapp/webhook` line in Deploy Logs or Network
Logs for the entire window, confirmed by scrolling Railway's logs to their
actual tail (container start → healthcheck → nothing else, for the
post-deploy run). This rules out v2.21's "arrives but gets silently
swallowed by the empty-message guard" theory for *this specific trigger
path* - there was nothing to swallow, `shapeOf()` never had anything to log
because the request never arrived.

**Leading hypothesis now shifts**: either (a) Meta genuinely isn't
delivering `request_welcome` to this WABA's webhook at all (a subscription
or entitlement issue upstream of the app - still can't confirm via
`GET /{app-id}/subscriptions`, still blocked on `WHATSAPP_APP_SECRET` not
being set), or (b) opening a chat via WhatsApp Web's `/send?phone=` flow
from an already-registered WhatsApp Business account isn't a
`request_welcome`-qualifying entry point at all, and only genuine
first-open paths (wa.me on a fresh mobile client, business-profile
"Message" button, click-to-WhatsApp ad) trigger it - which would mean
neither of this session's two tests, nor the business owner's own earlier
wa.me-link test (v2.21), actually exercised the failure condition
correctly, and the real event has still never been observed.
**Not resolved either way** - next step is either fixing the
`WHATSAPP_APP_SECRET` gap to inspect subscriptions directly, or getting a
genuinely fresh mobile client (not WhatsApp Web, not this session's
account) to open the chat while watching Railway logs live.

## v2.21 (2026-08-16): request_welcome still silently produces nothing for a
## genuinely first-time customer - added diagnostic logging, root cause not
## yet confirmed

Business owner confirmed a **genuinely first-time** customer (never
messaged K-AfroMarket before) opened the chat via the wa.me link and got
nothing - no catalog welcome message, matching the exact symptom already
seen once before with a reused test number, but this time ruling out the
"prior conversation history" explanation entirely. Sending "Hi" afterward
worked completely correctly (routed through the normal `welcome` list
state as expected) - confirming the webhook pipeline itself is healthy for
ordinary messages; the bug is specific to `request_welcome`.

All server-side config re-verified correct: `enable_welcome_message: true`
on production (v2.19's fix), webhook correctly pointed at
`bot.botmanagementservice.eu`, only the AfroMarket-Bot app subscribed to
the WABA (no conflicting subscription). Could not inspect the app's actual
webhook field subscriptions via `GET /{app-id}/subscriptions` -
`WHATSAPP_APP_SECRET` isn't set, and that endpoint requires it.

**Leading hypothesis, not yet confirmed**: `ConfigBot._handleRequestWelcome`
(v2.16) was built assuming a `request_welcome` event arrives shaped like a
normal message (`value.messages[0].type === 'request_welcome'`, with
`from`/`contacts[].wa_id` populated the usual way) - that assumption was
never verified against a real payload, only against third-party
documentation that read like a paraphrase, not Meta's own raw schema (see
v2.16's own caveat about this). `whatsappHandler.js`'s existing
empty-message guard (`if (!phoneNumberId || !message || !from) return`)
would silently swallow exactly this event, with no log, no trace, no
error - if `from`/`contacts[]` come back empty for this specific event
type, which is plausible if Meta identifies the customer some other way
for this event.

**Fixed enough to actually find out**: `whatsappHandler.js` now logs the
webhook `value`'s *structure* - a new `shapeOf()` helper walking field
names/nesting/array lengths/primitive types, never actual values -
whenever a `message` is present but produces no usable identifier;
previously this branch logged nothing at all. Deliberately not the raw
value itself: `logger.js`'s redaction only strips `+`-prefixed phone
numbers and known secret patterns, and WhatsApp's webhook payloads carry
digit-only phone numbers (no `+`) plus the customer's real profile name -
logging the raw payload would put that PII in cleartext production logs.
Added regression test coverage. Not yet deployed-and-observed against a real
`request_welcome` event as of this entry - next step is triggering it once
more (needs a genuinely never-contacted number) and reading the resulting
log line in Railway, either directly or relayed by the business owner
(this session still has no live browser or Railway log access).

## v2.20 (2026-08-14): dev and production have two entirely separate Commerce
## Catalogs - submitCatalogBatch.js was only ever syncing dev

Business owner tested production after v2.19's fix and still saw "4
products," not 5, and `sendCatalogMessage()` against production still 400'd
("Products not found in FB Catalog") even with `enable_welcome_message`
correctly `true`.

Root cause, confirmed via `GET /{WABA_ID}/product_catalogs` on each WABA:
**dev and production are connected to two entirely different Commerce
Catalogs**, not one catalog shared across both:

- Sandbox WABA `4464369590494418` → `AfroMarket-Dev-Catalog`
  (`1678073176620294`) - what `AFROMARKET_CATALOG_ID` in `.env`/Railway has
  always pointed at.
- Production WABA `878603275008509` → `AfroMarket-Production-Catalog`
  (`1333066702319721`) - never touched by `submitCatalogBatch.js` before
  today, at all. Confirmed via a direct read: exactly the original 4
  products, no Bouillie Jaune.

Every `submitCatalogBatch.js` run in v2.16/v2.18 only ever wrote to the dev
catalog - this is a second, independent instance of the exact sandbox/
production split problem `submitCarouselTemplate.js` already solved for
templates via `AFROMARKET_WABA_ID`, just not previously known to apply to
catalogs too (the assumption through v2.16-v2.19 was one shared catalog).

**Fixed**: `submitCatalogBatch.js` now defaults to the dev catalog (same
default/override convention as `AFROMARKET_WABA_ID`), with the production
catalog ID documented in the file header and targetable via
`AFROMARKET_CATALOG_ID=1333066702319721`. The script now also prints which
catalog it's targeting on every run, unconditionally - the wrong-catalog
mistake above happened silently once already, this makes it visible from
now on. Synced Bouillie Jaune into the production catalog - confirmed live
via a direct read.

`sendCatalogMessage()` against production: confirmed working correctly
using an already-established product (`haricot_rouge_1kg`) as the
thumbnail - succeeded instantly. Using the just-synced `bouillie_jaune_500g`
still 400'd on the first two retries - the same messaging-index propagation
delay already seen for this exact product in v2.18, isolated and confirmed
as the only remaining cause (not a code or config problem) via the
successful established-product send above.

## v2.19 (2026-08-14): setConversationalAutomation.js was hitting the wrong
## endpoint - enable_welcome_message never actually took effect on either WABA

Business owner reported production showing a genuinely empty chat on first
entry (no Ice Breakers - cleared manually - and no catalog welcome message
either) and confirmed Bouillie Jaune "keeps showing 4 products," not 5.

Investigating the empty-chat report surfaced the real bug:
`scripts/setConversationalAutomation.js` was POSTing to
`/{phone-number-id}` with a nested `conversational_automation` body field -
Meta's API accepted this with `{success: true}` on every call, but a
follow-up `get` always showed the old value, indefinitely (checked 4+ times
across several minutes - not the catalog-sync-style propagation delay seen
in v2.18, a genuinely different symptom). Confirmed via Meta's actual
Conversational Automation API reference
(`developers.facebook.com/.../conversational-automation-api`): this is a
**dedicated sub-resource endpoint**,
`POST /{phone-number-id}/conversational_automation`, not a field on the
phone number's own POST endpoint. The misleading `{success: true}` response
on the wrong endpoint
is what let this ship in v2.16 without being caught - the script's own
smoke test (a `get` immediately after a `set`) *should* have caught it, but
wasn't run rigorously enough at the time to notice the value never changed.

This also throws out an earlier, wrong conclusion from v2.16/v2.17: the
sandbox Test Number was never incapable of supporting
`conversational_automation` - it was hitting the identical wrong endpoint
as production. Both numbers behave identically once the endpoint is
correct.

**Fixed**: `setConversationalAutomation.js` now posts to
`/{phone-number-id}/conversational_automation` with the fields directly in
the body (no wrapper). Re-ran `clear-ice-breakers` against both WABAs -
confirmed via `get` immediately after, on both: `enable_welcome_message:
true`, no `prompts`. `request_welcome` is now genuinely live on both
sandbox and production, not just intended to be.

Bouillie Jaune's "4 products" report is unrelated to this bug - re-confirmed
via a direct Graph API read that all 5 products (Bouillie Jaune included,
`in stock`) are present in the Commerce Catalog server-side. Likely a
client-side WhatsApp cache, consistent with the propagation delay already
seen in v2.18 for the same product - not yet independently re-confirmed
after a client-side refresh.

## v2.18 (2026-08-14): Bouillie Jaune's catalog_management blocker resolved -
## product live, catalog welcome message live-verified end to end

Closes out v2.16's one open blocker. The business owner granted
`catalog_management` on the AfroMarket-Bot system user and regenerated
`WHATSAPP_ACCESS_TOKEN_AFROMARKET` (updated in `.env` and both Railway dev/
prod environments) - confirmed via `/debug_token`, the new token carries a
much broader scope set including `catalog_management`.

`node scripts/submitCatalogBatch.js` now succeeds. Confirmed live via a
direct Graph API read against the Commerce Catalog: `bouillie_jaune_500g`
present with correct name/price (€4.99)/availability/image_url.

First `sendCatalogMessage()` call using `bouillie_jaune_500g` as
`thumbnailProductRetailerId` still 400'd (`Products not found in FB
Catalog`) immediately after the sync, despite the direct catalog read
confirming the item was there - Meta's catalog write and its
messaging-facing index don't appear to be immediately consistent. Not a
code bug: the identical call for an already-synced product
(`haricot_rouge_1kg`) worked instantly, and retrying the same
`bouillie_jaune_500g` call a short time later succeeded with no code
change. Worth knowing for any future "just-added product" send - expect a
short propagation delay before a brand-new catalog item is safe to
reference in a live send.

**Sandbox test number's `conversational_automation` doesn't appear to
support `enable_welcome_message`/Ice Breakers at all** - confirmed via
`verified_name: "Test Number"` on that phone number (Meta's free
test-number allocation, not a real purchased WhatsApp Business number).
`scripts/setConversationalAutomation.js clear-ice-breakers` against it
returns `{success: true}` but a follow-up `get` shows no
`conversational_automation` object at all (production, by contrast,
correctly reflects every change). This means `request_welcome` likely
can't be verified on sandbox at all - production is the only real
signal available, decided with the business owner to hold off enabling
`enable_welcome_message` there until a deliberate live-verification pass,
not bundled into this fix.

Ice Breaker prompts on production were cleared manually by the business
owner (confirmed via `setConversationalAutomation.js get` -
`enable_welcome_message` is still `false`, `prompts` is absent) - separate
from, and not blocking, the `request_welcome` activation decision above.

## v2.17 (2026-08-14): Promo/discount templates (Variant A + B) - submitted to
## both WABAs, only Variant A wired into live use

Second half of `afromarket-dynamic-templates-todo.md`. Both variants share
the same `{{1}}`=percentOff/`{{2}}`=productName body shape and image
header, submitted via the new `scripts/submitPromoTemplate.js`
(`no-code`/`lto` subcommands, same upload-then-submit pattern as
`submitCarouselTemplate.js`). Submitted and `PENDING` on both WABAs:

- Sandbox: `afromarket_promo_v1` id `1532686888903765`,
  `afromarket_promo_code_v1` id `2319403952198773`.
- Production (K-AfroMarket): `afromarket_promo_v1` id `1368662388709270`,
  `afromarket_promo_code_v1` id `1733157687904263`.

**Variant A (no code)**: `QUICK_REPLY` "Shop Now" button, payload set per
send as `promo_add:<productId>:<percentOff>`. New
`FlowEngine.matchPayloadTrigger()`/bot-config `payloadTriggers[]` - unlike
the existing exact-match flow triggers (which always land on a flow's
initial state), this matches by prefix and routes straight to a specific
state, needed because a promo tap is a cold start with no prior
conversation state. New `AfroMarketFlowPlugin._handleAddDiscounted`
(`products.addDiscounted` action) parses the payload, recomputes the
discount from the current `products[]` config (never trusts a price/percent
implied by the template alone - same discipline as
`_handleNativeOrder`'s webhook-price distrust), and adds the item to cart
via an extended `addProductToCart(cart, product, { unitPriceOverride })`.
New `WhatsAppCloudClient.sendPromoTemplate()` for the runtime send.

**Variant B (LTO/discount code)**: prepared and submitted, **not wired into
live sending** - `sendPromoTemplate()` intentionally does not support it.
Two things learned building it that the todo doc's design couldn't have
known:
- Meta requires an LTO template's second button to be `URL`, not
  `QUICK_REPLY` - confirmed live (`(#132018)`-style validation, not
  documented with an exact rule findable in advance). This rules out
  routing "Shop Now" back into the bot's own cart for this variant,
  unlike Variant A.
- **`wa.me` links are rejected as a template URL button target** ("Direct
  links to WhatsApp aren't allowed for buttons") - confirmed live. This
  broke the plan's original fallback (the same wa.me pattern
  `submitCatalogBatch.js` uses for products with no dedicated webpage
  doesn't work here). Shipped with `https://legal.botmanagementservice.eu/impressum.html`
  as an honest, real, working placeholder instead - swap for the actual
  discounted-checkout destination whenever this variant is activated.
- `limited_time_offer.text` is capped at 16 characters (confirmed live,
  not documented with an exact number).

Also confirmed live (per the earlier restaurant/partner-store lesson - a
`400` from a real send only shows up when you actually call the send
function, not from template `PENDING`/`APPROVED` status alone):
`QUICK_REPLY`/`URL` button *text* cannot contain emoji or newlines
("Buttons can't have any variables, newlines, emojis or formatting
characters") - both templates were resubmitted with plain-text button
labels after hitting this on the first attempt.

**Not yet done**: template approval status hasn't been checked yet (both
still `PENDING` as of submission) - run
`node scripts/checkTemplateStatus.js afromarket_promo_v1` /
`afromarket_promo_code_v1` (with `AFROMARKET_WABA_ID=878603275008509` for
production) before relying on either in production. `sendPromoTemplate()`
has not yet been triggered against a real customer send (only covered by
unit tests with a stubbed `fetchImpl`) - do that once a template is
actually `APPROVED`, following the same live-verification discipline as
v2.15's carousel fix.

## v2.16 (2026-08-14): Bouillie Jaune product + catalog welcome message
## (replaces Ice Breakers on request_welcome)

First half of `afromarket-dynamic-templates-todo.md`
(afromarket-dynamic-templates-todo.md, copied from the business owner's
Downloads folder into the workspace root, same untracked-sibling-doc
pattern as `afromarket-carousel-bugs-todo.md`). Before writing any code,
verified the doc's technical assumptions against Meta's real API/docs -
several didn't hold (recorded in full in the todo doc's own corrections
section, mirroring how the carousel bugs doc accumulated corrections):
the reference screenshots' "category row + Top Deals" layout isn't a
template component at all (it's Meta's native Commerce-Catalog storefront,
driven by Commerce Manager Collections - no code involved); the header
image is sourced from a catalog product's own photo
(`thumbnail_product_retailer_id`), never the WABA profile picture; "your
own checkout" doesn't exist as a web page (AfroMarket checkout is entirely
in-chat, ending in a per-order Stripe Checkout session URL, not a static
product link).

**New product**: Bouillie Jaune – Sèche 500g, €4.99, category
`snack_breakfast` - added to `configs/bots/afromarket.bot.json`'s
`products[]`, plus the full parallel legacy manual-category-browsing chain
(`snack_breakfast_products`/`product_detail_bouillie_jaune_500g`, mirroring
the existing `beans_nuts`/`leaves` chains) since that legacy flow is
currently the *active* shop path in dev (`AFROMARKET_NATIVE_CATALOG_ENABLED`
is unset), not just a dormant fallback - the product would otherwise be
unreachable in the flow actually being tested. Photo uploaded to
`GustaveDjoutsop/bms-legal`'s `products/` directory (the repo behind
`legal.botmanagementservice.eu`, confirmed via `gh api`), matching the
naming convention of the 4 existing product photos.

**Blocked**: `node scripts/submitCatalogBatch.js` (syncs the new product
into the live Meta Commerce Catalog) fails with `(#100) Missing
Permission` - `WHATSAPP_ACCESS_TOKEN_AFROMARKET`'s scopes
(`whatsapp_business_management, whatsapp_business_messaging,
manage_app_solution, whatsapp_business_manage_events, public_profile`,
confirmed via `/debug_token`) do not include `catalog_management`. Needs
granting on the Meta Business Settings side (System User → the
AfroMarket-Bot system user → add `catalog_management` on the Commerce
Catalog asset → regenerate the token) before the product is live in the
catalog. Everything else for this piece is done and tested.

**New catalog welcome message** (Template 1): a plain interactive
`catalog_message` (single "View Catalog" button, opens the whole connected
catalog as WhatsApp's native storefront), not a submitted Template - it
fires inside an already-open session, so template review isn't needed.
New `WhatsAppCloudClient.sendCatalogMessage()`; new bot-config
`catalogWelcome: {body, footer, thumbnailProductRetailerId}` block,
rendered via the existing `renderTemplate()`/`buildTemplateContext()`
mechanism.

Triggered by Meta's `request_welcome` webhook event - fires the instant a
customer opens the chat, before typing anything, once
`conversational_automation.enable_welcome_message` is turned on for the
phone number. New `scripts/setConversationalAutomation.js`
(`get`/`clear-ice-breakers` commands) manages that Graph API field; new
`ConfigBot._handleRequestWelcome()` intercepts `message.type ===
'request_welcome'` at the very top of `handleMessage()`, entirely
bypassing `FlowEngine.step()` and conversation-state persistence (not a
real flow turn). Config-driven per bot, so a bot with no `catalogWelcome`
configured just no-ops.

Read production's live `conversational_automation` via the new script
before touching anything - confirmed it exactly matches the three Ice
Breaker prompts already documented in
`afromarket-production-trust-onboarding-issues.md`'s Issue 3 ("Shop
groceries" / "Get recipe ideas" / "See this week's promo"), with
`enable_welcome_message: false`. **Cleared Ice Breakers and enabled
`enable_welcome_message` on the sandbox number only** - production is
deliberately untouched until the `request_welcome` webhook's exact raw
payload shape is confirmed against a real event (the research describing
it read like a third-party BSP's normalized terminology, not verified
verbatim against Meta's own raw webhook - same "don't trust documentation
over the real API" discipline as v2.15). Live-verified
`sendCatalogMessage()` itself against the real API (both with and without
a thumbnail product) - works correctly.

**Not yet done**: trigger a real `request_welcome` event on sandbox (needs
a genuinely fresh WhatsApp number opening the chat for the first time -
this session had no live browser access to do it directly) and confirm the
catalog message actually arrives before enabling on production.

## v2.15 (2026-08-13): Live carousel test caught a real bug v2.14's "APPROVED"
## status masked - hydrated card body character/line-break limits

Live-testing the two carousels on the sandbox number (per v2.14's own
recommendation to not treat template approval as proof of working
end-to-end wiring) immediately showed the restaurant carousel still
rendering as stacked vertical fallback messages, not a real carousel -
despite `afromarket_restaurants_v2` being `APPROVED`.

Reproduced directly against the real Graph API by calling
`whatsappClient.sendCarouselTemplate()` with the actual production card
data: Meta rejects the send with `400 (#132018)`, citing two limits on the
card's *hydrated* body (the `{{1}}` variable substituted into the approved
template's static per-card suffix, `\n\nTap the button below for more
details.`) that template approval says nothing about:

- **160 characters**, variable + static suffix combined.
- **2 line breaks total** - the static suffix alone already spends both, so
  `bodyText` must be single-line.

Two of four restaurant cards and one of three Partner Stores cards were
over the character limit; every card used a `\n` to separate name from
address/hours, which alone violates the line-break rule independent of
length. `flowEngine.js`'s catch-and-fall-back-to-vertical-cards path (added
in v2.10 specifically so a template outage never leaves the customer with
nothing) was doing exactly what it was designed to do - which is precisely
why this degraded silently instead of erroring visibly.

**Fix:**
- Shortened every card's `bodyText` to a single-line teaser (name -
  category, city). Restaurants keep full address/phone/hours on the
  `restaurant_link_<id>` detail state reached after tapping the card
  button, so no information is lost there. Partner Stores has no
  equivalent per-store detail state (its quick-reply routes to the generic
  `afromarket_store_info` state) - full per-store address/hours is
  currently only visible via the vertical fallback, not the real-carousel
  path; flagged, not fixed here (separate scope from this bug).
- New `src/core/whatsapp/carouselCardBodyLimits.js` - shared constants
  (`CARD_BODY_STATIC_SUFFIX`, `CARD_BODY_HYDRATED_LIMIT`,
  `CARD_BODY_VARIABLE_LIMIT`, `CARD_BODY_VARIABLE_MAX_LINE_BREAKS`) used by
  both `scripts/submitCarouselTemplate.js` (which bakes the suffix into the
  template at submission time) and `flowEngine.js`'s config validation
  (which now enforces both limits on every `carouselTemplate` card's
  `bodyText` at flow-load time), so this exact failure mode fails loudly
  and immediately on the next content edit instead of silently degrading
  to the fallback again.
- 3 new `flowEngine.test.js` cases covering the length limit (over/at
  boundary) and the line-break rejection.

**Verified live**, not just via unit tests: `sendCarouselTemplate()` now
returns a successful WhatsApp API response for both templates against the
real production card data, sent to the same test number used in
`docs/testing/afromarket-live-test-2026-07-22.md`.

## v2.14 (2026-08-13): Both carousel templates approved by Meta on both WABAs

`afromarket_restaurants_v2` (v2.10) and `afromarket_partner_stores_v2`
(v2.12) are now `APPROVED` - confirmed via
`node scripts/checkTemplateStatus.js <name>` against both WABAs:

- Sandbox WABA `4464369590494418`: `afromarket_restaurants_v2` id
  `1256941286482149` APPROVED, `afromarket_partner_stores_v2` id
  `1075297564846605` APPROVED.
- Production WABA `878603275008509`: `afromarket_restaurants_v2` id
  `2188265671958576` APPROVED, `afromarket_partner_stores_v2` id
  `1931253917551627` APPROVED.

Template approval confirms Meta accepted the template content; it does not
by itself confirm the bot's runtime wiring (`carouselTemplate` config,
quick-reply routing to `restaurant_link_<id>` / partner-store detail
states) actually renders and routes correctly end-to-end. Still worth a
live test message on both sandbox and production numbers before treating
Issue 1/Issue 2 from `afromarket-carousel-bugs-todo.md` as fully closed in
practice, not just approved on paper.

## v2.13 (2026-08-12): Correction to v2.11 - the messaging-volume-gate explanation was wrong; `AVAILABLE_WITHOUT_REVIEW` means ready now, not blocked

v2.11 below concluded the display-name-not-showing issue was gated behind
the same messaging-volume tier that blocks Official Business Account
status (v2.5), based on reading the general "Display names" doc page's
description of a separate, messaging-volume-triggered "display name
verification" process. **That conclusion was wrong**, surfaced by the
user producing a Meta Business Suite notification ("The display name for
your WhatsApp Business account is ready for use: K-AfroMarket", dated
~2026-08-05, one day after v2.4's fix) that directly contradicts it.

**Correct source, checked this time: Meta's WhatsApp Business Account
Phone Number API reference** (the actual field documentation for
`name_status`, not the general prose doc page) -
`AVAILABLE_WITHOUT_REVIEW`: *"The certificate for the phone is available
and display name is ready to use without review."* This is a terminal,
ready state - functionally equivalent to `APPROVED`, just reached via a
faster path that skips the separate messaging-volume-gated review process
entirely. It was never blocked on that gate in the first place. The
notification the user found independently confirms this reading.

**So Business Verification is done (per v2.11), the certificate is ready
(per this correction), and Meta confirmed it a week before this doc entry
was written - the business-side configuration is not the problem.**
Re-opened: why does a customer's fresh WhatsApp chat still show
`+49 1590 5495011` instead of "K-AfroMarket"?

**Confirmed (2026-08-12): the saved-contact theory was correct.** The test
customer had `+49 1590 5495011` already saved in their phone's Contacts
app from prior testing, so WhatsApp displayed their own saved contact
info instead of the registered "K-AfroMarket" business name - exactly the
documented behavior ("if a WhatsApp user edits your profile name in the
WhatsApp client, the name they set will appear instead"), not a
misconfiguration on any side. **Closed - not a bug, nothing to fix.**
Business-side setup (verified_name, Business Verification, certificate)
was correct throughout this entire investigation; the customer simply
already knew this number. A genuinely first-time contact (nothing saved)
should see "K-AfroMarket" correctly - not independently re-verified with
a truly fresh number, but no longer expected to be necessary given the
mechanism is now understood and explains every observed symptom.

## v2.12 (2026-08-12): Partner Stores carousel gets the same fix as Afro Restaurants - `afromarket_partner_stores_v1` retired, submitted to production for the first time

Fast-follow flagged in v2.10 below: `afromarket_partner_stores_v1` had the
identical static-body-text problem as the old restaurant template (card
BODY components were literal text, not `{{1}}` variables), and - more
urgently - **existed only on the Test/sandbox WABA; the real K-AfroMarket
production WABA had zero templates at all**, confirmed via the Graph API
while submitting the restaurant fix. Partner Stores' carousel had never
actually rendered for a real production customer - every real tap silently
fell back to vertical cards.

**New template `afromarket_partner_stores_v2`**: same fix as
`afromarket_restaurants_v2` - every card's body is now a `{{1}}` variable
(store name/address/hours), filled at send time via `cards[].bodyText` in
`partner_stores_list`'s `carouselTemplate` config. No button-mechanism
change needed here (unlike restaurants) - Partner Stores already used
QUICK_REPLY, routing back into the bot rather than external URLs, so it
never had the domain-limitation problem restaurants did.

Submitted and `PENDING` on both WABAs:
- Sandbox WABA `4464369590494418`: template id `1075297564846605`
- Production WABA `878603275008509`: template id `1931253917551627`

No script fixes needed this time - both bugs found while submitting the
restaurant template (wrong default upload `APP_ID`, all-variable body
failing Meta's ratio check) were already fixed in
`scripts/submitCarouselTemplate.js` and applied cleanly here.

## v2.11 (2026-08-12): production shows the phone number instead of "K-AfroMarket" - root cause is the same messaging-volume tier that already blocked Official Business Account status in v2.5, not Business Verification

**Corrected by v2.13 above: the messaging-volume-gate conclusion below is
wrong** - `AVAILABLE_WITHOUT_REVIEW` means the display name is already
ready to use, not blocked pending a volume-triggered review. The
Business-Verification correction in this entry still stands; only the
"what's actually gating it now" conclusion at the end doesn't.

A test customer's screenshot on the real production number (+49 1590 5495011,
phone_number_id `1214372845096561`) showed `+49 1590 5495011` in the WhatsApp chat
header instead of "K-AfroMarket", profile photo rendering correctly. Reproduced on a
genuinely fresh (never-contacted) chat thread, ruling out client-side caching of an
older chat.

**Investigated in `afromarket-production-trust-onboarding-issues.md`, which initially
attributed this (plus a WhatsApp-username-eligibility failure) to incomplete Meta
Business Verification, sourced from general research (a Meta help-center error string
plus an unspecified second source) rather than a direct account check.** Confirming
that hypothesis directly (per that doc's own Task 1) instead disproved it: three
independent live checks against the real account all say verification is done -
- WABA `878603275008509` `business_verification_status`: **verified**
- WABA `account_review_status`: **APPROVED**
- App review requirements (`1515363753048080`) `business_verification_passes`: **true**

**The actual mechanism, per Meta's "Display names" documentation**
(<https://developers.facebook.com/documentation/business-messaging/whatsapp/display-names>):
the display name only appears in chat headers once the phone number passes **display
name verification** - a separate, later check from Business Verification, which
"automatically undergoes" only "when you reach a higher messaging limit." The account's
`name_status` is `AVAILABLE_WITHOUT_REVIEW` (the name itself passed the basic content
check when set in v2.4 - no violation) rather than `APPROVED` (what display name
verification sets once it actually runs) - confirming display name verification has
simply never run yet, because the volume trigger for it hasn't been crossed.

**This is the identical gate v2.5 already found blocking Official Business Account
(blue checkmark) status** - entry tier caps at 250 business-initiated conversations/24h;
the next tier needs 1,000 unique customers messaged in a rolling 7 days, production is
at 3. Nobody had previously connected that this same threshold also gates the *basic*
display-name-in-chat-header behavior, not just the blue checkmark on top of it.

**Business-growth gate, not a technical one - nothing to build or fix in code.**
Resolves on its own once real weekly customer volume crosses that line; v2.4's fix
(setting `verified_name` to "K-AfroMarket") was necessary but not sufficient on its own
- it's correctly configured and waiting on volume, not broken or incomplete.

Also reframes the sibling username-eligibility issue in the same doc: since Business
Verification is confirmed complete and the username request still fails, verification
status doesn't explain that failure either - more likely gated by this same
volume/trust tier, though Meta hasn't published exact criteria for that specific
feature, so it stays a reasonable bet rather than a confirmed mechanism the way display
names now are.

## v2.10 (2026-08-12): Afro Restaurant carousel rebuilt as a reusable, variable-based template - `afromarket_restaurants_v1` retired

Fixes `afromarket-carousel-bugs-todo.md`'s Issue 1 (restaurant cards rendered
as stacked messages, not a real carousel) and applies its Correction: the
prior `afromarket_restaurants_v1` template (still referenced further down in
this doc, now historical) had restaurant name/address/hours/URL typed
directly into the approved template as literal text. That's why it went
stale the moment the restaurant list changed in v2.2 below - the template
kept showing three old Berlin restaurants (Bantabaa/Yajee/Afropot) next to
"Visit Website" buttons pointing at their sites, silently, with no error,
and the `carouselTemplate` block was dropped from `afro_restaurant_list`
entirely rather than reuse it with mismatched content.

**Root cause generalized: any carousel template built with literal content
instead of `{{n}}` variables goes stale on the next content change and
requires a fresh Meta submission/approval to fix.** `afromarket_partner_stores_v1`
has this exact same latent problem (confirmed - its cards' BODY text is also
static, just hasn't been hit yet since Partner Stores' 3 stores haven't
needed a swap) - not fixed in this pass, flagged as a fast-follow.

**New template `afromarket_restaurants_v2`** (MARKETING, 4 cards, matching
today's real restaurant count exactly): every card's BODY is now a `{{1}}`
variable (name/address/hours), filled at send time via `cards[].bodyText` in
`afro_restaurant_list`'s `carouselTemplate` config - swapping restaurants no
longer requires resubmission. `scripts/submitCarouselTemplate.js` now always
submits card bodies this way (no more literal-text option).

**Button type changed from URL to QUICK_REPLY**, which looks like a step
back from "click straight to the restaurant's site" but is a hard platform
constraint, not a design choice: WhatsApp only supports one dynamic
`{{1}}` *suffix* on a URL button, appended to a single base domain fixed at
template-approval time. Four restaurants on four unrelated domains
(afrofusion-restaurant.com, lavillageoise.de, kilimanjaroii.de,
ebony-stuttgart.de) can't be represented by one templated URL button -
there's no per-card arbitrary-domain variant. Mirrors how
`afromarket_partner_stores_v1` already sidesteps this (its buttons are
QUICK_REPLY, routed back into the bot, never a direct external URL).

Tapping a restaurant's quick-reply (`restaurant_<id>`) now routes through a
new `afro_restaurant_route` action state to one of four new
`restaurant_link_<id>` states, which sends the restaurant's real photo,
full details, and website URL as a plain clickable link (WhatsApp
auto-links URLs in message bodies), with "⬅️ More Restaurants"/"🏠 Main
Menu" buttons feeding back into the existing `main_route`. One extra tap
internally, functionally identical to a direct link tap for the customer -
the link arrives in the very next message.

The vertical `items[]` fallback (used only if the carousel template send
fails) is unchanged - still direct `cta_url` cards per restaurant, no
routing detour, since there's no URL-button domain limitation on a
freeform interactive message. `flowEngine.js`'s config validator gained an
`id`-based cross-check between `carouselTemplate.cards[]` and `items[]` to
catch drift between the two independent of button mechanism (quick_reply
vs cta_url) - falls back to the original same-mechanism check when no `id`
fields are present, so `afromarket_partner_stores_v1` (no `id`s) is
unaffected. Known limitation of the set-based comparison, inherited from
the original check: an item silently missing its `id` is excluded from the
set rather than flagged directly - still caught today via the resulting
size mismatch, but a compensating miscount elsewhere could mask it.

**Update (2026-08-12): actually submitted, on both WABAs, status PENDING.**
Also confirmed while doing so - **`afromarket_partner_stores_v1` exists only
on the Test/sandbox WABA (`4464369590494418`); the real K-AfroMarket
production WABA (`878603275008509`) had zero message templates before this
submission.** Partner Stores' carousel has never actually rendered for a
real production customer - only ever silently fallen back to vertical
cards, logging an `error`-level line on every attempt. Not fixed here
(tracked as the same fast-follow as the static-body-text issue above), but
worth knowing this affects *today's* real customers, not just future risk.

`afromarket_restaurants_v2` submitted to both:
- Sandbox WABA `4464369590494418`: template id `1256941286482149`
- Production WABA `878603275008509`: template id `2188265671958576`

Two real bugs found and fixed in `scripts/submitCarouselTemplate.js` while
actually running it against production (see that commit for detail): a
hardcoded upload `APP_ID` that only worked by coincidence for whichever
token had last used it (failed outright for the AfroMarket-Bot production
system user token - fixed by resolving `app_id` from the token itself via
`/debug_token`, mirroring `scripts/setWhatsAppProfilePhoto.js`'s existing
pattern instead of duplicating a different hardcoded guess); and a card
body that's 100% the `{{1}}` variable with no static framing text fails
Meta's template validation ("Parameters words ratio exceeds limit")
regardless of the example value's length - fixed with a short static
call-to-action sentence wrapped around the variable.

Check approval with `node scripts/checkTemplateStatus.js afromarket_restaurants_v2`
(add `AFROMARKET_WABA_ID=878603275008509` for the production WABA) - no
config or code change needed once it flips to `APPROVED`, the flow picks it
up automatically.

## v2.9 (2026-08-11): production native catalog populated - root cause of the `catalog_management` permission wall, and how dev's catalog actually worked

A from-scratch investigation into why `scripts/submitCatalogBatch.js` (added
in #73) kept failing with `(#100) Missing Permission` against the new
production catalog, even after granting the system user asset-level "Full
access" and regenerating tokens with every WhatsApp permission the
`AfroMarket-Bot` app offered - the native-catalog code itself (#74) had
already been live in production since PR #81's carousel-footer fix (v2.8)
was deployed; only the catalog *data* was missing.

**Root cause: `catalog_management` is a Marketing/Catalog API permission, not
a WhatsApp permission - it lives behind a completely separate Meta
authorization surface from `whatsapp_business_management` /
`whatsapp_business_messaging`.**
Confirmed via [Graph API Explorer](https://developers.facebook.com/tools/explorer):
switching the "Meta App" selector from `AfroMarket-Bot` to `AfroMarket-Dev`
and opening "Add a Permission" showed `catalog_management` listed under
"Other" for `AfroMarket-Dev` but not for `AfroMarket-Bot` - same Meta login,
same business, different apps, different permission surface.

**Why dev's catalog worked and prod's didn't - this is how it was actually
done for dev:** `AfroMarket-Dev` (App ID `1062969406286663`, mode: In
development) is an older-style Meta Business app with **Marketing API**
added as a product alongside WhatsApp (visible under Dashboard → "Added
products"). `catalog_management` is part of that Marketing API product's
permission set. `AfroMarket-Bot` (App ID `1515363753048080`, mode: **Live** -
the actual production app) was set up through Meta's newer "Use Cases" model
and had only one use case added: "Connect with customers through WhatsApp" -
no Marketing/Catalog API product, so no `catalog_management`, regardless of
token type or how many WhatsApp scopes were requested. That's the wall this
session kept hitting.

**Fix applied to the production app itself** (Dashboard → "Add use cases" →
filter "All (15)", not the default "Featured (3)" view, which is why this
was missed on earlier passes): added **"Manage products with Catalog API"**
to `AfroMarket-Bot`. This gives the actual production app its own
`catalog_management` access - the correct fix, versus the alternative of
permanently borrowing `AfroMarket-Dev`'s (a dev-mode app's) credentials to
manage a production commerce resource.

**A second, narrower platform limitation surfaced after that fix, and is
worth recording so it isn't re-discovered the hard way:** Meta Business
Suite's System User "Generate token" flow (Settings → Users → System users →
`AfroMarket Bot API` → Generate token) **never surfaces `catalog_management`
as a selectable permission for `AfroMarket-Bot`, even after the Catalog API
use case was added** - confirmed not a propagation-delay/caching issue by
retrying after several minutes; a permission search for "catalog" returns
"No matching results" every time. The System User flow's permission picker
appears to be hardcoded to a fixed allowlist of WhatsApp-only permissions
(`manage_app_solution`, `whatsapp_business_manage_events`,
`whatsapp_business_management`, `whatsapp_business_messaging`), independent
of what the app's use cases actually grant.

**The Graph API Explorer's personal "User Token" flow is the one that does
expose it.** After adding the use case, `catalog_management` appeared as
a selectable "Add a Permission" option for `AfroMarket-Bot` there, and a
User Token generated with it successfully read the production catalog
(`GET /1333066702319721?fields=id,name` → `200`). **Practical implication:
there is currently no stable, non-interactive (System User) credential for
managing this catalog** - only a personal, short-lived User Token via Graph
API Explorer (extendable to a 60-day long-lived token via the standard
`fb_exchange_token` OAuth grant if a longer-lived credential is ever needed
for a recurring/automated job). This is fine for how catalog population
actually happens today (`submitCatalogBatch.js` is a manual, occasional
script run from a developer machine, not a server-side route), so no
Railway-side change was needed for `WHATSAPP_ACCESS_TOKEN_AFROMARKET` -
serving the native catalog in chat only needs `whatsapp_business_messaging`
to reference a `catalog_id`, not `catalog_management` to edit it.

**Actions taken, in order:**
1. Added the "Manage products with Catalog API" use case to `AfroMarket-Bot`.
2. Generated a personal User Token (via Graph API Explorer) scoped to
   `catalog_management` + `whatsapp_business_management` +
   `whatsapp_business_messaging` against `AfroMarket-Bot`.
3. Ran `scripts/submitCatalogBatch.js` against catalog ID
   `1333066702319721` ("AfroMarket-Production-Catalog") with
   `AFROMARKET_PHONE_NUMBER=4915905495011` (K-AfroMarket's real number,
   from v2.4) overridden via shell env vars - confirmed in Commerce Manager:
   4 products, all "In stock".
4. Set `AFROMARKET_NATIVE_CATALOG_ENABLED=true`,
   `AFROMARKET_CATALOG_ID=1333066702319721`, and
   `AFROMARKET_PHONE_NUMBER=4915905495011` on Railway **production**
   (previously only present in `dev`) and manually deployed - production's
   manual-deploy-only convention followed as usual. Deploy logs confirm a
   clean start (`GET /api/health 200`), no errors related to this change.

**Not yet done:** end-to-end verification of the native catalog flow live on
WhatsApp against the production number - do that before considering this
fully shipped, per this session's established practice of testing on
WhatsApp rather than assuming a config change works.

## v2.8 (2026-08-09): migration actually applied to dev, plus a second real ordering bug found and fixed

Two follow-ups from v2.7, both found by testing live on WhatsApp rather than
assumed fixed once the code merged.

**The v2.7 email migration was reviewed, merged, and documented as "not yet
applied" - and then genuinely wasn't, for a while.** After v2.7 deployed to
dev, every `CustomerProfileStore.get()`/`upsert()` call started throwing
`column "email" does not exist` (confirmed directly in Supabase Postgres
logs), caught by `_handleCheckoutStart`'s deliberately-permissive try/catch
and silently falling back to the fresh-details flow - which is exactly what
a customer saw on their second order: asked for name/address again despite
a successful first purchase. Not a code bug; a deployment-step bug. Fixed by
actually running `migrations/003_add_customer_profile_email.sql` against the
`botmanagerservice` Supabase project (this service's `dev`-environment
database - not verified whether production shares the same project or has
its own; confirm the actual `DATABASE_URL` per Railway environment before
assuming either way). **Lesson: "not yet applied" in a
PR description is not the same as tracking it as a real follow-up task** -
this one slipped through.

**Partner Stores' fallback footer was rendering before its own cards.** A
live WhatsApp session showed "More options: Main Menu" arriving *before*
the intro text and the three store cards it was sent after, even though
`flowEngine.js`'s `cards`-state handler sends them in the correct
intro → items → footer order, each awaited sequentially. Same root cause
already documented for the native-carousel-template path in the same file
(`getCarouselFooterDelayMs`'s comment): a successful WhatsApp Cloud API
send() only means Meta accepted the call, actual on-device delivery is
async and slower for image-bearing messages, so a lighter footer sent right
after can race ahead and display first - it just wasn't guarded for the
*vertical fallback* rendering path (individual per-store card bubbles;
**see the correction below - this turned out not to be what was actually
rendering for this customer**). Fixed by reusing the same `CAROUSEL_FOOTER_DELAY_MS` pause before
the fallback path's footer send too - unconditionally, since
`validateFlowConfig` already guarantees every `cards` item carries an
image, so there's always at least one image-bearing send ahead of that
footer by the time this code runs.

**Correction, same day**: the fix above was real but incomplete - re-tested
live after it deployed and the footer was *still* rendering before the
cards. Checked Railway's deploy logs for the actual test: no "carousel
template send failed" line appears, meaning `carouselSent` was `true` -
this customer's Partner Stores screen has always been rendering via the
real, Meta-approved `afromarket_partner_stores_v1` template (confirmed by
the live text itself: WhatsApp showed the template's own approved body
copy, substituted with `bodyParams: ["there"]` from `carouselTemplate` in
`afromarket.bot.json` - text that was never in this repo at all, hence
turning up nothing in `git log -S`). So the actual race was in the
carousel-template branch's *pre-existing* delay, not (only) the vertical
fallback fixed above - and that pre-existing 2500ms default just wasn't
long enough for Meta's own async template assembly in practice. Bumped
`getCarouselFooterDelayMs`'s default to 6000ms. Still a heuristic, not a
guarantee - see the updated comment in `flowEngine.js` for why a fully
deterministic fix would need to key off WhatsApp's delivery-status
webhooks instead, which wasn't done here. Also set
`CAROUSEL_FOOTER_DELAY_MS=0` in `flowEngine.test.js`/`afromarketFlow.test.js`
so the higher default (2500ms → 6000ms, ~2.4x) doesn't inflate the test
suite's wall-clock time - none of them assert on actual timing, only send
order/content.

## v2.7 (2026-08-09): two live bugs fixed - duplicate welcome menu after "Shop online", rigid checkout format - plus email now persisted

Both reported from real customer sessions (one via a WhatsApp screenshot, one
via a customer complaint about the delivery-details format).

**Bug 1 - "Shop online" sent the catalog, then immediately the full welcome
menu again**, reading as the bot answering itself. Root cause: `shop_entry`'s
`ctx.goto('welcome')` continued the same flow-engine turn straight into
rendering `welcome`'s list right behind the native `product_list` (see
`flowEngine.js`'s `step()` loop - it only ends a turn when an action state
neither `goto()`s nor has a `next`). Fixed with a `shop_landing` action state
+ `shopLandingArmed` context flag: `shop_entry` now lands there instead,
which genuinely ends the turn after the catalog send; the customer's actual
next message is what triggers the handoff back to `welcome`. A code-review
subagent traced one real follow-on edge case (a customer re-tapping an
older, still-visible interactive button routes straight to that destination
via `main_route` instead of always re-showing `welcome` first) and confirmed
it's a single-message, deliberate outcome, not a reintroduction of the bug -
documented in `_handleShopLanding`'s comment and locked in with regression
tests.

**Bug 2 - the checkout format was too rigid for real customers.** The
`checkout_details` combined message (added 2026-07-21, see "Cart visibility
from recipes, and one-message checkout" below) required exact
`Name: .../Address: .../Email: ...` labels, regex-parsed line by line.
Anything else - a plain sentence, a missing colon, wrong label - silently
failed to populate name/address and just re-showed the same "resend in this
exact format" error. **This reverses that 2026-07-21 consolidation**: the
single combined-message design traded away exactly the robustness the
original four-separate-prompts design had, and a live customer complaint
confirmed the cost was real. `checkout_details`/`checkout_details_parse`
are replaced with three sequential `input` states -
`checkout_name` → `checkout_address` → `checkout_email` (reply *skip* to
skip) - finished by `checkout.finishDetails`
(`AfroMarketFlowPlugin._handleFinishCheckoutDetails`). Each field is asked
on its own, so whatever the customer types literally *is* that field - no
format to violate, nothing to reject. Phone is still taken from `ctx.from`,
unchanged.

**Email is now persisted**, reversing v2.6's "deliberately not saved/reused"
decision below - it wasn't part of that request; it is part of this one,
since Stripe's hosted checkout requires it and repeat customers were being
asked for it on every single order despite already having paid before.
`customer_profile` gains a nullable `email` column
(`migrations/003_add_customer_profile_email.sql`, applied by hand against
Supabase per this project's existing migration convention - **not yet
applied to any environment as of this entry**, apply to `dev` before
relying on it there). `CustomerProfileStore.upsert`/`get` and
`AfroMarketBot._recordOrder` now read/write it; `_handleCheckoutStart`
prefills `checkoutEmail` from the saved profile instead of always blanking
it, so a returning customer with an email on file isn't asked again.

**Deliberate trade-off, flagged in review**: `upsert`'s
`email = COALESCE(EXCLUDED.email, customer_profile.email)` means an explicit
"skip" at `checkout_email` (which upserts `email: null`) never clears a
previously-saved email - a "skip" reply means "not required for this
specific order," never "forget the email I gave you before" (there's no
code path for the latter today). In practice this rarely matters: whenever
Stripe is configured, `_handleCheckout` forces `checkout_email_required`
before any order with a still-empty email can actually pay, so a real email
always exists by the time `_recordOrder` upserts for any order that
completes. It only has any effect at all in the no-payment-provider dev/test
path, which doesn't call `_recordOrder` in the first place.

## v2.6 (2026-08-04): checkout reuses a saved delivery address, 3-day delivery window, receipt confirmed already covered

Per request: reuse a returning customer's delivery details instead of
asking them to retype everything on every order, tighten the delivery
estimate to 3 days, and make sure a payment-confirmation receipt goes out.

**What was already there**: `AfroMarketBot._recordOrder()` already upserts
`customer_profile` (name + delivery_address, keyed by `bot_id`/`whatsapp_id`)
after every successfully paid order - the *save* half of this existed
since the data-retention work (ADR-008). It was just never read back.
Likewise, `_onPaymentCompleted()` already sends a WhatsApp message with the
order number, itemized cart, total, delivery address, and delivery
estimate as soon as `payment.completed` fires - **that already functions
as the order receipt**; no new receipt mechanism was needed, just the
3-day wording change described below.

**What's new**:
- New `checkout_start` flow state (`checkout.start` action,
  `AfroMarketFlowPlugin._handleCheckoutStart`) sits between tapping
  "💳 Checkout" and the rest of the checkout flow. It looks up
  `customerProfileStore.get({ botId, whatsappId })`; if a saved
  name + address exist, it pre-fills them and jumps straight to
  `checkout_review` (skipping the free-text "reply with your details"
  prompt entirely), with the review screen's intro text conditionally
  saying *"We found your delivery details from last time — please
  confirm, or tap Start Over to use a different address"*
  (`{{#checkoutUsingSavedAddress}}`/`{{^checkoutUsingSavedAddress}}` in the
  template). Tapping the review screen's existing "✏️ Start Over" button
  still routes to the normal free-text `checkout_details` flow unchanged -
  that's the "unless he wants to change and provide a new address" case,
  and it already existed, it just needed the saved-address path to fall
  back to it.
- A lookup failure (DB blip, pool not configured, etc.) is caught and
  falls back to the plain free-text flow rather than blocking checkout -
  reusing a saved address is a convenience, never a hard dependency.
- `AfroMarketFlowPlugin` now takes an optional `customerProfileStore`
  constructor override (shares `AfroMarketBot`'s instance in production,
  same module-level Postgres pool either way - see `getPool()` in
  `pgClient.js`) so this is unit-testable without a real DB, matching how
  the payment gateway is already injected elsewhere.
- Delivery estimate changed from 5 days to 3
  (`DELIVERY_WINDOW_DAYS = 3` in `afromarketFlowPlugin.js`), and the order
  confirmation now says *"We deliver within 3 days"* explicitly rather than
  only showing a calculated date.

Email is deliberately **not** saved/reused here - it's asked fresh per
order only when Stripe needs it for the payment receipt, which is a
separate concern from delivery data and wasn't part of the request.
**Superseded by v2.7 above**, which does now save/reuse it - noted here
rather than rewritten, since this section is describing what shipped in
v2.6 at the time.

## v2.5 (2026-08-04): Official Business Account (blue checkmark) investigated - not attainable yet, blocked by message volume, not config

Looked into getting production's WhatsApp number "prod certified" (the blue
checkmark / Official Business Account status). Findings:

**The five documented OBA eligibility criteria** (Meta's own docs,
[Official Business Accounts](https://developers.facebook.com/documentation/business-messaging/whatsapp/official-business-accounts/)):
messaging-policy compliance, ≥30 days on the platform, Business Verification,
2-step verification enabled, display name approved. Of these, **Business
Verification was already done, and v2.4's work (above) incidentally
satisfied two more** - 2-step verification is now enabled (we set the PIN)
and the display name is approved ("K-AfroMarket", `code_verification_status:
VERIFIED`). Account age and policy compliance were not independently
checked but have no reason to be blockers.

**The actual, currently-binding blocker is different and not listed in
that doc**: Meta Business Suite's "Submit request" button for OBA status is
disabled, with the tooltip "Increase your business limits to become
eligible for an official Business account." Checked
WhatsApp Manager → Messaging limits
(<https://business.facebook.com/latest/whatsapp_manager/messaging_limits>):
production is on the entry tier - **250 business-initiated conversations
per rolling 24h**. The next tier up (2,000/day) requires **1,000 unique
customers messaged in a rolling 7-day period; production is currently at
3**. OBA almost certainly needs a tier beyond even that first jump.

**This is a business-growth gate, not a technical one** - no API call,
config change, or script fixes it. Revisit once real weekly customer volume
is meaningfully higher; nothing to build here for now.

## v2.4 (2026-08-04): WhatsApp profile photo + display name fixed via Cloud API (Meta Business Suite web uploader is broken)

Production's WhatsApp profile still showed placeholder branding — a generic
purple "B" avatar and the display name "BoT Management Service" instead of
"K-AfroMarket". Both are now fixed on the real production number
(+49 1590 5495011, phone_number_id `1214372845096561`):
- Profile picture → the `prod.png` "K" market-stall icon from
  `AfroMarketResources/Logo AfroMarket/`, cropped to a clean square and
  reprocessed as `afromarket-whatsapp-profile.jpg`.
- Display name (`verified_name`) → "K-AfroMarket".

**Root cause of why this needed a workaround**: Meta Business Suite's own
web uploader (Settings → WhatsApp Accounts → phone number → Profil →
"Datei auswählen") throws a client-side JS crash on every upload attempt:
```
ErrorUtils caught an error: n.toError is not a function
  at https://static.xx.fbcdn.net/rsrc.php/v4/yp/r/LkURvs5OdWQ.js:79:566
```
Confirmed reproducible regardless of file (tried a 640×640 PNG, a 512×512
JPEG, and a trivial 200×200 solid-color JPEG — identical crash every time),
browser state (hard refresh, incognito with extensions disabled), account
permissions (confirmed Full access), and UI locale (German vs English).
The browser network log shows no upload request is ever sent — the crash
happens in Meta's own JS before the request is built, so this is a bug in
their client code, not anything on our end. Filed with Meta Business
Support with the exact error signature; no fix from their side as of this
writing.

**Workaround: use the WhatsApp Cloud API directly**, bypassing the broken
web widget entirely.

*Profile photo* — new reusable script, `scripts/setWhatsAppProfilePhoto.js`:
```
node scripts/setWhatsAppProfilePhoto.js <phone-number-id> <image-path>
```
Discovers the app_id from the access token via `/debug_token` (no guessing
required), does the standard resumable-upload dance
(`POST /{app_id}/uploads` → `POST /{upload_id}` with the file bytes →
handle), then `POST /{phone-number-id}/whatsapp_business_profile` with
`profile_picture_handle`. Takes effect immediately, no review.

*Display name* — no reusable script yet (one-off, done by hand); the
sequence, per Meta's docs
(<https://developers.facebook.com/documentation/business-messaging/whatsapp/display-names>):
1. `POST /{phone-number-id}?new_display_name=<name>` — submits the change.
   `new_name_status` came back `AVAILABLE_WITHOUT_REVIEW` for this number
   (no manual Meta review needed), but the new name is **not** live yet.
2. Finalizing requires `POST /{phone-number-id}/register` with a `pin`
   field — the number's 2-step-verification PIN, which is mandatory
   (confirmed by calling `/register` without it: `(#100) The parameter pin
   is required.`). Nobody remembered the existing PIN, so it was reset
   first via `POST /{phone-number-id}` with `{"pin": "<new 6-digit PIN>"}`
   (works via API without needing the old PIN, given Full-access
   permission) - **PIN must be a plain 6-digit string, no separators**
   (`123456`, not `123-456` - the first attempt failed on exactly this).
3. Re-ran `/register` with the new PIN → `verified_name` flipped to
   "K-AfroMarket" immediately, confirmed via
   `GET /{phone-number-id}?fields=verified_name`.

**Credential handling**: the production access token and the 2FA PIN were
never pasted into chat - added directly to local `.env` by hand each time,
read by the scripts via `dotenv`, PIN line removed from `.env` again once
the register call succeeded. Same pattern as
`WHATSAPP_ACCESS_TOKEN_AFROMARKET`'s existing use in
`scripts/submitCarouselTemplate.js`.

**For next time** (e.g. doing the same for the dev number, or changing
either again): the web UI bug is very likely still present - go straight to
the API. `scripts/setWhatsAppProfilePhoto.js` is ready to reuse for photos;
the display-name steps above aren't scripted yet since it's expected to be
rare, but could be turned into `scripts/setWhatsAppDisplayName.js` if this
comes up again.

## v2.3 (2026-08-04): Afro Restaurant hidden on production until it has a real carousel

Per explicit request: **Afro Restaurant is hidden from the main menu on
production**, staying visible on dev. Reason — since v2.2 removed
`afro_restaurant_list`'s `carouselTemplate` (see below), it renders as
vertical `cta_url` cards instead of a native horizontal carousel; production
shouldn't show the feature degraded like that. It stays enabled on dev so
work on a new carousel template can continue without a flag flip, and
re-enabling on production later is a one-line config change (drop
`hideInProd`) once a new template is submitted/approved.

`hideInProd` previously only worked on `"buttons"`-type state buttons. Extended
`flowEngine.js` with `filterEnvGatedSections()`, the same idea applied to
`"list"`-type state rows: a row can carry `"hideInProd": true`, and any
section left with zero rows after filtering is dropped too (so production
never shows an empty section header). Applied to the "🍽️ Afro Restaurant" row
in `main_menu`'s `welcome` state.

Same known limitation as Partner Stores below: hiding the row doesn't gate
`main_route`'s route map, which still maps `afro_restaurant` →
`afro_restaurant_list` unconditionally. Unreachable through normal WhatsApp
interactive replies on production (no button exists to tap), not hardened
against someone replying with the literal text `afro_restaurant`. Acceptable
for the same reason as Partner Stores — low-value target, not sensitive data.

## v2.2 (2026-08-04): real restaurants, and dev/prod content now diverge

**Afro Restaurant** (`afro_restaurant_list`) replaced its 3 Berlin placeholder
restaurants with 4 real ones AfroMarket actually recommends, sourced across
Germany (not just Berlin — matches where AfroMarket delivers): akan afrofusion
(West African fusion, Hamburg HafenCity), La Villageoise (Cameroonian,
Frankfurt), Kilimanjaro II (Eritrean/East African, Karlsruhe), Ebony (African,
Stuttgart, since 1987). Addresses/phones/hours sourced from each restaurant's
own website.

**The `carouselTemplate` block was removed from `afro_restaurant_list`**,
not just its content swapped. The previous `afromarket_restaurants_v1`
template was in fact approved and live (see `docs/testing/afromarket-live-test-2026-07-27.md`),
but that doesn't help here: its `URL`-type button targets are **baked into
the approved template at Meta's end, not sent dynamically per-message**
(`WhatsAppCloudClient.sendCarouselTemplate` sends zero `parameters` for a
static URL button — confirmed by reading the send code, not assumed). Editing
only the JSON's `cards[].url` would have shipped a carousel showing the new
restaurants' photos next to "Visit Website" buttons still pointing at the old
placeholder restaurants' sites. The vertical `items[]` cta_url fallback (real
today, no Meta approval needed) is what customers actually see now in both
environments. A fresh carousel template (new name, e.g.
`afromarket_restaurants_v2`, new card images/URLs) would need to be submitted
and approved before native horizontal scrolling comes back for this state —
not done as part of this change; `scripts/submitCarouselTemplate.js` is ready
to use whenever that's worth doing.

**Partner Stores and the AfroMarket Store address now differ between `dev`
and `production`**, since real partner stores and a physical location don't
exist yet. Two additions to `flowEngine.js`, both keyed off `CONFIG_ENV`
(already set per Railway environment — see `appConfig.js` — so this needed no
new environment variables):
- Any button in a `"buttons"`-type state can carry `"hideInProd": true` to
  render everywhere except `CONFIG_ENV=production`. Applied to the "🏪
  Partner Stores" button in `afromarket_store_info` — `partner_stores_list`
  (3 placeholder stores) is unreachable via the UI on production, unchanged
  on dev.
- Every `renderTemplate()` context now includes `env.isProduction`, usable in
  any `template`/`body`/`caption` string via Mustache sections
  (`{{#env.isProduction}}...{{/env.isProduction}}` /
  `{{^env.isProduction}}...{{/env.isProduction}}`). Applied to
  `afromarket_store_info`'s template: production shows "we're based in 89555
  Steinheim, Germany and deliver across all of Germany — no walk-in store
  yet"; dev keeps the original Berlin placeholder shop address/hours
  unchanged.

Both mechanisms are generic (any button, any template string), not
restaurant/store-specific, so future environment-gated content doesn't need
new plumbing.

**Known limitation**: `hideInProd` only removes the button from what gets
rendered — it doesn't gate `store_route`'s route map, which still maps
`partner_stores` → `partner_stores_list` unconditionally. A production
customer only reaches `partner_stores_list` by tapping a button that no
longer exists, so this is unreachable through normal WhatsApp interactive
replies; it's not hardened against someone deliberately replying with the
literal text `partner_stores`. Acceptable for a placeholder feature; revisit
if this pattern gets reused for something more sensitive.

## v2.1 (2026-08-04): real catalog replaces the 15-product placeholder

The placeholder catalog described throughout this doc (15 products across
Grains/Pantry/Spices/Fresh, 8 recipes across 4 regional carousels) has been
**replaced with the business's real 4-product K-AFROMARKET catalog**:
Haricot Rouge 1kg, Arachide Blanche 1kg (both `beans_nuts` category), Ndolè
250g, Feuilles d'OKOK 100g (both `leaves` category) — sourced from
`AfroMarketResources/Shop Products/` (product descriptions doc + branded
product photos, hosted at `legal.botmanagementservice.eu/products/`).
Recipes were cut down to a single real Ndolè recipe (`recipeId: "ndole"`,
state `recipe_ndole`) since it's the only one whose ingredients are actually
sold — the region browsing menu (`region_menu` and the West/East/North/
Central carousel states) and the 8 other recipes were removed along with it.

The **4 Meta-approved carousel templates** documented below
(`afromarket_west_african_recipes`, `_east_african_recipes`,
`_north_african_recipes`, `_central_african_recipes`) are now **unused** —
left approved on Meta's side but no longer referenced by any flow state.
The carousel *mechanism* itself (`flowEngine.js`'s `carouselTemplate` cards
state, `WhatsAppCloudClient.sendCarouselTemplate`) is untouched and still
used by `partner_stores_list` (`afro_restaurant_list` dropped it in v2.2 —
see top of doc), and could be reused for recipes again if the catalog grows
enough to justify regional browsing. The sections below (conversation map, recipe carousel mechanics,
15-product counts) describe the **pre-v2.1 state** and are kept for their
still-accurate technical detail on how the carousel/cards mechanism works,
not as a description of the current catalog.

**v2 (`botVersion2`)**: AfroMarket is now a commerce bot — Afro-grocery
delivery for Germany, recipes with a "buy these ingredients" shortcut, plus
info cards for a physical restaurant and store — modeled closely on Meta's own
[Jasper's Market](https://github.com/fbsamples/whatsapp-business-jaspers-market)
demo (cloned locally, and tried live on WhatsApp under the "Jasper's Market"
business chat to match its tone/labels/flow shape).

**v1 (`botVersion1`, tag/branch)**: content-only bot (recipes, meal plans,
dinner ideas, shopping tips, about) — kept as a reference/rollback point, no
cart or checkout. See git history on that branch for its docs.

Full original source instructions for v1: `AfroMarket_WhatsApp_Bot_Instructions.md`
(Downloads).

## Why AfroMarket is no longer a pure-config bot

v1 ran on the generic `ConfigBot` with zero custom code. v2 adds a real
shopping cart and checkout, which needs *stateful, computed* behavior no JSON
config can express (running totals, order numbers, delivery dates). So v2
introduces:

- `src/bots/afromarket/AfroMarketBot.js` — thin `ConfigBot` subclass, wires in
  the plugin.
- `src/bots/afromarket/afromarketFlowPlugin.js` — the only custom logic:
  - `beforeState` hook: whenever the flow enters a `product_detail_*` or
    `recipe_detail_*` state, reads that state's `productId`/`categoryStateId`
    or `recipeId`/`recipeName` field and stashes it in conversation context
    (so one shared `product_actions` / `recipe_actions` state can serve *all*
    15 products / 8 recipes instead of needing one per item). Whenever it
    enters `cart_view`, it (re)computes the cart summary text.
  - Three custom actions: `products.route` (add to cart / view cart / back),
    `recipes.route` (buy this recipe's mapped ingredients / more recipes),
    `cart.checkout` (generate order number, total, clear cart).
- Everything else — menus, recipe photos, product photos/prices, the
  restaurant/store info cards — is still plain JSON in
  `configs/bots/afromarket.bot.json`.

`botRegistry.js` now special-cases `botType: "afromarket"` to `AfroMarketBot`
(previously it fell through to the generic `ConfigBot`, like Laundry/
ThomasNetwork already did for their own custom needs).

## Conversation map (v2)

```
hi/menu → Main menu (list, Jasper-style wording)
  ├─ 🛒 Shop online → category list (Grains/Pantry/Spices/Fresh)
  │     └─ product list → product detail (image+price) → Add to Cart / View Cart / Back
  │           → cart_view → Checkout (one combined name+address+email message,
  │                 phone auto-taken from WhatsApp) → review & confirm
  │                 → 💳 real Stripe Checkout link (cta_url) → order confirmed (async, on payment.completed)
  ├─ 🍲 Get recipe ideas → recipes hub
  │     ├─ Browse Recipes → region → recipe detail → 🛒 Buy ingredients (adds to cart,
  │     │     then recipe_actions swaps "Buy ingredients" for "👀 View Cart")
  │     ├─ Healthy Meal Plans (7-day breakdowns, unchanged from v1)
  │     ├─ Tonight's Dinner (3 quick recipes, unchanged from v1)
  │     └─ Shopping Tips → can jump straight into Shop online
  ├─ 🎉 Current promo → weekly deal + shop/recipe shortcuts
  ├─ 🍽️ Afro Restaurant → 4 real restaurants as photo cards, each with a genuine "Visit Website" button
  └─ 🏬 AfroMarket Store → address, phone, opening hours (info only)
```

## Afro Restaurant: real restaurants with working website links

**Superseded by v2.2 (see top of doc)**: the 3 Berlin restaurants and the
`afromarket_restaurants_v1` carousel template named below are no longer what
`afro_restaurant_list` sends (the template itself is still approved and live
on Meta's side — it's just unreferenced by any flow state now) — kept here
for the still-accurate technical story (the `cta_url` discovery, why a
carousel template's URL buttons can't be swapped per-message). Current
restaurants/mechanism are in v2.2 above.

Initially built as a directory (list → pick one → address/phone/hours detail
screen) with fictional placeholder restaurants. Replaced 2026-07-20 with real,
verified businesses and a genuine "Visit Website" link, after confirming two
things by testing directly against Meta's API rather than assuming:

- **`jaspers_market_media_carousel_v1` (Meta's own approved demo template,
  shared on this sandbox WABA) cannot be reused for this**: its "Get this
  recipe" button URL is a fully static string with no `{{1}}` variable
  (verified by re-fetching the approved template's raw components) — every
  card would link to the exact same hardcoded Meta developer-docs page,
  which would be actively misleading for a real restaurant recommendation.
  Confirmed structurally, not just by inspection.
- **The fix**: WhatsApp Cloud API's freeform `cta_url` interactive message
  type — no template, no approval wait, and each message carries its own
  real URL. Added `WhatsAppCloudClient.sendCtaUrl` and extended the `cards`
  engine state so an item can specify `buttonUrl` (opens a link, e.g.
  restaurant websites) instead of `buttonId` (quick-reply, routes back into
  the flow, e.g. recipes) — validated to require exactly one of the two.

**The 3 restaurants are real, Berlin-based** (AfroMarket's actual market is
Germany, not France — corrected 2026-07-20; found via web search,
addresses/phones/hours cross-checked against multiple sources, websites
verified reachable): Bantabaa (Gambian, Kreuzberg, bantabaafooddealer.eu),
Yajee (Nigerian & Caribbean, Charlottenburg, yajee.de), Afropot Berlin
(Ghanaian, Manifesto Market at Potsdamer Platz, afropotberlin.de). Verified
live: tapping "Visit Website" shows WhatsApp's own "You're about to leave
WhatsApp and go to https://..." confirmation with the correct restaurant URL,
and actually opens that real site.

15 products across 4 categories (Grains & Starches, Pantry & Sauces, Spices &
Seasoning, Fresh & Frozen), priced in EUR. 8 recipes carried over from v1,
each mapped in `recipeIngredients` to 1–3 of those products for the "buy
ingredients" shortcut. All images are verified `upload.wikimedia.org` links.

## Recipe browsing: real horizontal carousel for West Africa, vertical cards elsewhere

East/North/Central regions still send one photo+button message per dish (the
`cards` state type in `flowEngine.js`) instead of a text-only list, since list
message headers can't carry per-row photos. No Meta approval needed, but the
cards stack vertically rather than scrolling horizontally.

**West Africa gets true horizontal scrolling**, via a Meta-approved WhatsApp
Carousel Template — this was a hard platform constraint, not a code choice;
freeform interactive messages can never scroll horizontally.

- Template `afromarket_west_african_recipes` (id `1063703219418196`,
  category `MARKETING`, language `en_US`), submitted 2026-07-20 as a pilot,
  **approved 2026-07-21**.
- `flowEngine.js`'s `cards` state gained an optional `carouselTemplate` block
  (`configs/bots/afromarket.bot.json`'s `west_recipes` state). When present,
  the render branch sends ONE `template_carousel` intent instead of the
  intro+items fan-out; on failure it catches the error and falls through to
  the *same, unchanged* vertical-items code as a genuine fallback — a
  template outage never leaves the customer with nothing. Verified live: a
  real transient Wikimedia 429 while re-downloading an image for re-upload
  triggered exactly this fallback, visually confirmed on WhatsApp.
- `WhatsAppCloudClient` gained `uploadMedia({ link })` (downloads a public
  image URL and re-uploads it to Meta's Media API to get an `id` — carousel
  headers reference an uploaded media id, not a public link, unlike
  `sendImage`/`sendButtons`) and `sendCarouselTemplate({...})` (builds the
  `template.components = [body?, carousel]` payload per Meta's docs, one
  `quick_reply` button per card with a distinct `payload` string so
  identical-looking buttons still route differently — verified against
  Meta's own carousel-template docs, not guessed from memory).
- The reply-routing side needed **zero changes**: a quick-reply tap arrives
  as plain text via `message.button.payload` (already handled by
  `normalizeInbound`), and the SAME `saveAs: recipeChoice` / `next:
  recipe_route` mechanism the vertical cards already used handles it,
  since both card sets use identical `quickReplyPayload`/`buttonId` values
  (`recipe_jollof_rice` etc). `validateFlowConfig` now enforces those two
  sets stay in sync, so a future edit to one without the other fails fast at
  startup instead of silently breaking the rarely-exercised fallback path.
- **First attempt at this used two separate custom `action`-type plugin
  states** (send, then wait-and-route) instead of extending `cards` — this
  broke, because a plain `action` state chaining into an image→buttons
  sequence within one turn never sets flowEngine's internal
  `hasConsumedInboundText` flag, so the downstream `buttons` state
  misinterpreted the still-fresh quick-reply payload as an answer to its own
  prompt and routed to the main menu instead of the recipe. Abandoned that
  design in favor of extending the already-proven `cards` mechanism instead.
- Verified live end-to-end: genuine horizontally-scrolling cards rendered in
  WhatsApp, and tapping a card's button correctly opened that recipe's full
  detail + the "Bon appétit" follow-up.
- East/North/Central submitted 2026-07-21, same pipeline proven by the West
  Africa pilot, all already wired into their `cards` states'
  `carouselTemplate` blocks (config-only change, no code changes needed -
  the flowEngine.js extension is fully generic):
  - `afromarket_east_african_recipes` (id `1003461869227729`): Injera with
    Tibs, Ugali & Sukuma Wiki.
  - `afromarket_north_african_recipes` (id `1490130603152484`): Chicken
    Tagine, Shakshuka.
  - `afromarket_central_african_recipes` (id `1710010093594224`): Fufu with
    Ndolé, **Poulet DG** (added as Central Africa's 2nd dish - Meta requires
    ≥2 cards per carousel and Central only had 1; new product
    `plantain_1kg` added to the catalog for its "Buy ingredients" mapping).
  - All **`PENDING`** as of submission - check status with
    `node scripts/checkTemplateStatus.js <name>`.
- **Afro Restaurant also got a carousel**: `afromarket_restaurants_v1`
  (id `4228275444136640`, **`PENDING`**; Bantabaa/Yajee/Afropot Berlin).
  Unlike the recipe carousels, its cards use **`URL`-type buttons** (real
  restaurant websites), not `QUICK_REPLY` - each button is fully static (no
  `{{1}}` variable) since restaurant links never change, so
  `WhatsAppCloudClient.sendCarouselTemplate` needed a `buttonType: 'url'`
  card option (omits the `parameters` array entirely at send time - nothing
  to substitute for a static URL, mirroring how any WhatsApp template button
  with zero variables works - **unverified until this template is approved
  and actually sent**, unlike the recipe carousels which have live
  confirmation). `validateFlowConfig` was extended to enforce all cards in
  one carouselTemplate share the same button type (Meta requires uniform
  button composition across cards) and to drift-check `card.url` against
  `items[].buttonUrl` for URL-type carousels, same protection as the
  existing quickReplyPayload/buttonId check for quick-reply carousels.
  - **Submission gotcha**: the first submission attempt (no top-level intro
    text, since a restaurant directory has no personalized greeting) was
    rejected by Meta - `"Komponente des Typs BODY ist erforderlich"`
    ("a BODY component is required"). A top-level `BODY` is mandatory on
    every carousel template even with zero cards needing one; fixed by
    adding a static intro line with no `{{1}}` variable. `submitCarouselTemplate.js`
    now also only attaches an `example.body_text` when the intro text
    actually contains `{{` - passing an example for a variable-free body was
    untested and the failure mode wasn't worth risking on a 4th resubmission.

**Afro Restaurant is a directory, not AfroMarket's own restaurant**: it lists
real African restaurants AfroMarket recommends around Berlin (see above), not
a location AfroMarket runs. AfroMarket Store (the grocery shop) is unrelated
and still a single info card with a Berlin placeholder address, since
AfroMarket only has the one physical store.

**Recipe follow-up invariant**: every `recipe_detail_*` state's `next` must
point straight to `recipe_actions` (the "Bon appétit! Want to keep exploring?"
message with Buy ingredients/More recipes/Main menu buttons) so it always
appears immediately after the recipe description, with no gap — enforced by
a test in `test/afromarketFlow.test.js` that scans every recipe state.

## Deliberate deviations from Jasper's Market

Jasper's Market uses **pre-approved WhatsApp message templates** (via
`facebook-nodejs-business-sdk`) for its "Shop online" banner, its recipe
media carousel, and its limited-time-offer message — plus a webhook
**status callback** (delivered/read receipts) to fire a delayed follow-up
message ("Is there anything else...?"). Both require Meta template review
and status-webhook handling this codebase doesn't have (`whatsappHandler`
only processes `messages`, not `statuses`).

AfroMarket v2 deliberately does **not** replicate those two mechanics:
- "Shop online" goes straight into a real, usable category/product list
  (freeform interactive messages — no template approval needed, and actually
  useful for buying groceries, unlike Jasper's dead-end banner image).
- No read-receipt-triggered follow-up message; the bot always keeps a set of
  buttons live after every message so the conversation self-continues.

Everything else — the 3-then-list-extended main menu wording/order, the
"Order confirmed / Hi {name} / order number / estimated delivery" copy — is
copied close to verbatim from the real Jasper's Market chat we tested live.

## Meta setup

Created 2026-07-19: app **AfroMarket-Bot** (App ID `1515363753048080`) under the
**BoT Management Service** portfolio, WhatsApp messaging use case.
Test number `+1 (555) 637-5864`, Phone Number ID `1089648187567384` (already in
`configs/bots/afromarket.bot.json`), WABA ID `4464369590494418`.

Remaining/recurring steps:

1. [developers.facebook.com/apps](https://developers.facebook.com/apps/) → **Create App**
   → type **Business** → name `AfroMarket-Bot` → add product **WhatsApp**. *(done)*
2. **WhatsApp → API Setup**: note the **Phone Number ID** and WABA ID; add your own
   WhatsApp number as a test recipient (OTP verification).
3. Replace `phoneNumberId` in `configs/bots/afromarket.bot.json` with the real
   Phone Number ID. *(done — test number; swap again for the EU production number)*
4. Set `WHATSAPP_ACCESS_TOKEN_AFROMARKET` (temporary token for testing; for
   production create a System User in Business Manager with
   `whatsapp_business_messaging` + `whatsapp_business_management` scopes) and
   `META_VERIFY_TOKEN_AFROMARKET` (any random secret string — the bot config
   references it via `${META_VERIFY_TOKEN_AFROMARKET}`).
5. **WhatsApp → Configuration → Webhooks**: Callback URL
   `https://<host>/api/whatsapp/webhook`, Verify Token = the value of
   `META_VERIFY_TOKEN_AFROMARKET`, subscribe to the `messages` field. The test
   WABA is shared across the whole Business portfolio — a newly created app is
   **not** auto-subscribed; also call
   `POST /<WABA_ID>/subscribed_apps` with the app's access token once, or the
   webhook verifies but no messages ever arrive. (Local dev: `ngrok http 3000`,
   then `npm start` — **not** `npm run dev`, whose `--watch` restart can drop
   an in-flight webhook.)
6. Production hardening: set `WHATSAPP_VERIFY_SIGNATURE=true` and
   `WHATSAPP_APP_SECRET` (App Settings → Basic → App Secret).

## Cart visibility from recipes, and one-message checkout

Added 2026-07-21, from live-testing feedback: after "🛒 Buy ingredients" on a
recipe, there was no way to see the cart, pay, or keep shopping - `recipe_actions`
always showed the same static [Buy ingredients, More recipes, Main menu] buttons,
and the only path to the cart was Main Menu → Shop online → View Cart.

- `recipe_actions` now uses `buttonsFromContext` instead of a static `buttons`
  array. `AfroMarketFlowPlugin.beforeState` sets `recipeActionButtons` each time
  the state is entered: `[Buy ingredients, More recipes, Main menu]` when the
  cart is empty, `[👀 View Cart, More recipes, Main menu]` once it has anything
  in it. "View Cart" opens `cart_view`, which already had exactly the three
  things asked for: Checkout, Continue Shopping, Main menu - no new state
  needed, just a route into the existing one (`_handleRecipeAction`'s new
  `view_cart` branch).

Checkout also asked for name/address/phone/email as four separate sequential
prompts. Replaced with a single `checkout_details` input state asking for
name + address + email (optional) in one message, in a recommended
`Name: ...` / `Address: ...` / `Email: ...` format, parsed by
`AfroMarketFlowPlugin._handleParseCheckoutDetails` (line-by-line
`key: value` regex, case-insensitive, order-independent). **Phone is no
longer asked at all** - it's taken directly from the WhatsApp sender number
(`ctx.from`). If the parse can't find both a name and an address, the
customer sees an error and the same prompt again (`checkoutDetailsError`
templated into the prompt) rather than silently accepting garbage.

Email is genuinely optional at this step, but Stripe's hosted checkout
requires one - if payments are configured and the customer left it out,
`_handleCheckout` routes to a small dedicated `checkout_email_required`
prompt asking for just the email, then retries `cart.checkout`. This keeps
the checkout message honest ("optional") without breaking payment, and only
bothers the customer with an extra question when payment genuinely needs it.

## Payment: Stripe Checkout Sessions

**AfroMarket is a Germany/EU business with an EU-eligible payout account —
it is not, and has never been, a Cameroon-market product.** An earlier
version of this section chose Flutterwave specifically because the payout
entity was Cameroon-registered at the time; that constraint no longer
applies, and Flutterwave has been fully removed (provider file, webhook
route, env vars, tests — nothing else in the repo referenced it). **CamPay,
MTN MoMo, and Orange Money are not used by, and are not applicable to,
AfroMarket** — those exist for the `laundry`/`pharmacy`/`thomas_network`
bots in this same monorepo, which legitimately serve a Cameroon-based
laundromat business in XAF. The shared `PaymentGateway`
(`src/core/payments/paymentGateway.js`) is hardened so it can never silently
default a bot to a provider/currency it didn't explicitly ask for (see
below) — this is what actually keeps AfroMarket and the Cameroon bots from
ever cross-contaminating, not just convention.

Provider options considered for AfroMarket's EU/Germany market: **Stripe**
(chosen), Mollie, PayPal, Klarna (standalone), Adyen, Revolut. Stripe won
because:
- One Checkout Session covers card + Klarna + SEPA direct debit + giropay
  (`automatic_payment_methods`), rather than needing a separate Klarna
  integration.
- `Stripe-Signature` is a real HMAC-SHA256 signature
  (`t=<timestamp>,v1=<hex>` over `${timestamp}.${rawBody}`) — reuses this
  codebase's existing `computeHmacSha256Hex`/`safeEqual` primitives
  (`webhookSignature.js`), the same pattern CamPay's webhook already uses.
  Mollie's webhook, by contrast, carries no signature at all and requires an
  API callback to fetch real status — a different, weaker trust model.
- Stripe's REST API natively accepts an `Idempotency-Key` header and dedupes
  server-side for ~24h — free defense-in-depth on top of this codebase's own
  idempotency-key mechanism (below).
- Hosted Checkout Sessions are a plain REST endpoint
  (`POST /v1/checkout/sessions`), hand-rollable with `fetch` — no SDK, same
  as every other provider in this codebase.

**Architecture** (same `PaymentGateway`/provider-interface/
`PaymentStatusWorker` machinery already used for CamPay/MTN, just a
different provider):

- `src/core/payments/providers/stripeProvider.js` — `isConfigured` /
  `initiatePayment` (`POST /v1/checkout/sessions`, one aggregate line item
  for the cart total, returns a `checkoutUrl`) / `checkStatus`
  (`GET /v1/checkout/sessions/:id`) / `verifyWebhook` / `parseWebhook`
  (returns a stable `eventId` from the Stripe event envelope, used for
  webhook-ingestion dedup — CamPay/MTN's `parseWebhook` don't return one,
  which is fine, see below). Registered in `paymentService.js` when
  `STRIPE_SECRET_KEY` is set.
- `POST /api/payments/webhooks/stripe/:botId` in `routes/payments.js`
  mirrors the CamPay webhook route: verify signature → `gateway.handleWebhook`
  → append to the ledger (deduped by event id) → emit `payment.status`.
- **Checkout flow** (`afromarketFlowPlugin.js::_handleCheckout`) is otherwise
  unchanged from the Flutterwave-era design: email is asked for specifically
  only when a provider is actually configured and needs it; on confirm, if
  Stripe is configured, it calls `gateway.initiatePayment(...)` with the
  order as `metadata` and sends the real hosted checkout link via the
  existing `cta_url` message type ("💳 Pay for order AM-XXXX") instead of
  confirming instantly. If Stripe isn't configured (e.g. local dev with no
  `STRIPE_SECRET_KEY`), it falls back to the legacy instant-confirmation
  behavior so local testing still works without live payment credentials.
- **Order confirmation happens async**: `AfroMarketBot` registers a
  `payment.completed` listener (same shape as `ThomasNetworkBot`'s
  access-code listener, including a Redis `setnx` idempotency lock so a
  duplicate webhook can't double-send the WhatsApp message) that fires the
  real "✅ Order confirmed" message — built from the cart/name/address/phone
  snapshotted in the payment's `metadata` at initiation time — once the
  webhook confirms payment actually went through.
- Env vars: `STRIPE_SECRET_KEY` (Bearer key for the REST API),
  `STRIPE_WEBHOOK_SECRET` (Dashboard → Webhooks signing secret — **not** the
  same value as the secret key), `STRIPE_SUCCESS_URL`/`STRIPE_CANCEL_URL`
  (where Stripe sends the customer back after paying/cancelling), optional
  `STRIPE_BASE_URL` override for testing.
- **Not yet tested live** — needs real Stripe test-mode credentials before a
  payment link can actually be sent and confirmed on WhatsApp.

### Append-only payment ledger (not a single mutable row)

`PaymentStore` (`src/core/payments/paymentStore.js`) previously overwrote a
single `payment:{botId}:{transactionId}` row on every update — no audit
history. It now also appends every state transition
(`payment_initiated` / `payment_status_polled` / `payment_completed` /
`payment_failed`) to a Redis list, `payment_events:{botId}:{transactionId}`
(`appendEvent`/`getEvents`), deduped by event id before appending
(`payment_event_seen:{botId}:{provider}:{eventId}`, `SETNX`-guarded) so a
redelivered webhook can't create a duplicate ledger entry. The single
`payment:{botId}:{transactionId}` row still exists and is still cheap to
read — it's now a derived snapshot of the latest event, not the source of
truth. Providers without a stable event id (CamPay) get a synthesized dedup
key instead of a real one — coarser, but still not "silently rely on the
overwrite being harmless" the way it worked before.

**Caveat**: this ledger lives in Redis. Redis list persistence depends on
AOF being enabled wherever this runs in production — worth confirming
explicitly if long-term audit/compliance retention beyond Redis's realistic
guarantees becomes a hard requirement.

### Idempotency key (client-generated, checked before every charge attempt)

A double-tap on "Confirm Order" (or a WhatsApp webhook redelivery of the
same tap) used to mint a **second** order number and a **second** payment
session — `generateOrderNumber()` ran fresh on every `_handleCheckout`
invocation with no dedup. Fixed: entering `checkout_review` generates
`checkoutIdempotencyKey` (a `crypto.randomUUID()`) and `checkoutOrderNumber`
once per attempt (`AfroMarketFlowPlugin.beforeState`), reused across the
review → email-required → confirm retry loop. `PaymentGateway.initiatePayment`
looks up any existing payment for that key first
(`store.getPaymentByIdempotencyKey`) and returns the cached result instead
of re-calling the provider if found; `stripeProvider.js` also forwards the
same key as Stripe's own `Idempotency-Key` header, so there are two
independent layers of protection, not just a UI-level "the button is now
disabled" convention. The key/order number are cleared on reaching
`cart_view` (covers both a genuine cancel and a fresh look at the cart
before a new checkout) and right before `order_confirmed` on success — but
deliberately **not** cleared when a payment-initiation attempt fails
(`checkout_review` re-entry via the failure path), since no payment record
was ever stored for a failed attempt and retrying is still logically the
same in-flight order.

### Shared gateway hardening (no silent cross-tenant fallback)

`PaymentGateway.selectProvider` used to default to `campay` if no
`preferredProvider` was passed, and `initiatePayment` defaulted `currency`
to `'XAF'` if none was given — both are latent footguns in a
process-wide-singleton gateway shared by every bot (`paymentService.js`),
since a future AfroMarket code path that forgot to pass
`preferredProvider: 'stripe'` explicitly would have silently been routed to
CamPay in XAF instead of failing loudly. Both are now hardened: omitting
`preferredProvider` throws if 2+ providers are registered (resolves the sole
provider only when there's exactly one, which is unambiguous), and omitting
`currency` always throws. Every real call site already passed both
explicitly (`afromarketFlowPlugin.js` → `'stripe'`/`'EUR'`,
`thomasNetworkFlowPlugin.js` → `'campay'` via its bot config's
`payments.preferredProvider`), so this is a pure hardening change with no
behavior change for existing callers — it only closes the gap for future
code.

## Known limitations / next steps

- **Product data is duplicated 2–3x** (the `products` catalog array, each
  category list row's price, and each `product_detail_*` caption) since prices
  are baked into strings for simplicity. If prices change often, worth adding
  Mustache templating driven from the `products` array instead.
- **Cart is per-conversation, in Redis/in-memory** (same TTL as everything
  else) — abandoned carts just expire, no recovery flow.
- Restaurant/table reservation and physical-store loyalty features were
  explicitly scoped out for v2 (info cards only, per Gustave's ask).
- **No real inventory/stock tracking exists anywhere** (no stock/quantity
  field on any product, no reservation/commit/release logic). Explicitly
  scoped out of the Stripe payment-solution pass as an independently-sized
  feature, not a natural extension of a payment-provider swap. When picked
  up, model it as reserve-on-cart-add / commit-on-payment-completed /
  release-on-payment-failed-or-timeout, with an order state machine
  (`CREATED → PAYMENT_PENDING → PAID → PACKING → SHIPPED → DELIVERED`,
  branching to `PAYMENT_FAILED` off `PAYMENT_PENDING`) — reusing the
  `payment_events` ledger's `metadata` as the natural place to record
  reservation/commit events per order, rather than inventing a third store.
- **No shipping automation** (DHL/DPD label generation, tracking numbers) —
  same reasoning and same future phase as inventory above.

## Message templates (submit in WhatsApp Manager when going proactive)

| Name | Category | Purpose |
|---|---|---|
| `afromarket_welcome` | MARKETING | Onboarding greeting, `{{1}}` = name |
| `afromarket_daily_recipe` | MARKETING | Daily recipe tip with image header |
| `afromarket_mealplan_reminder` | UTILITY | Weekly meal-plan reminder |

Templates are only needed for business-initiated (outbound) messages; the whole
menu/shop/checkout experience above works inside the 24h customer-service
window without them.
