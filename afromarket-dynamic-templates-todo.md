# AfroMarket — Dynamic Message Templates (Catalog Welcome + Promo/Discount)

**Status (2026-08-16): `request_welcome` was a dead end — Meta removed the
webhook and `enable_welcome_message` from the API entirely on 2026-03-27, 4.5
months before this feature was even built (see Correction 6). Every symptom
chased in Corrections 3-5 (wrong endpoint, sandbox "limitation", unobserved
payload shape) had a simpler explanation underneath: there was never anything
to receive. Catalog welcome now ships via a different mechanism — sent once on
a customer's genuine first message instead of a "chat opened" event — which
doesn't depend on this Meta feature at all.
`ConfigBot._handleRequestWelcome`/`scripts/setConversationalAutomation.js` are
removed as dead code. See Corrections below before reading the rest of this
doc as written — several of its technical assumptions turned out wrong once
checked against Meta's real API/docs, mirroring exactly the lesson
`afromarket-carousel-bugs-todo.md` already taught this project once. Full
detail in `docs/requirements/afromarket.md` v2.16/v2.17/v2.18/v2.19/v2.22/
v2.23.**

- Template 1 (catalog welcome): built as a plain interactive message (not a
  submitted Template — see Correction 1). Code done, tested,
  `sendCatalogMessage()` live-verified end to end with the real Bouillie
  Jaune product as the header thumbnail. ~~**Blocked**: the new Bouillie Jaune
  product can't sync to the live Commerce Catalog~~ **Resolved (v2.18)** — token
  regenerated with `catalog_management`, product confirmed live in the catalog.
  ~~**Deferred**: enabled on sandbox only~~ **Resolved (v2.19)**:
  `enable_welcome_message` is now genuinely `true` on both WABAs — the earlier
  "sandbox doesn't support this" conclusion was itself wrong, caused by
  `setConversationalAutomation.js` posting to the wrong Graph API endpoint (see
  Correction 5). ~~Triggered by `request_welcome`~~ **Resolved (Correction 6,
  v2.23)**: `request_welcome` was removed from the platform entirely on
  2026-03-27 — no real event was ever going to arrive. Now triggered on the
  customer's genuine first message instead.
- Template 2 (promo/discount): both variants built and submitted to both WABAs.
  Variant A (no code) fully wired into live use (quick-reply → bot's own cart at the
  discounted price). Variant B (with code) prepared and submitted per the business
  owner's explicit instruction, **not wired into live sending** — see Correction 3.

---

## Why "fully dynamic" is a hard requirement here, not a preference

This project has already hit the cost of getting this wrong once:
`afromarket_restaurants_v1` baked restaurant names, addresses, and URLs in as literal
template text instead of `{{n}}` variables, which is exactly why it broke the moment
the underlying restaurant list changed, and why earlier fix attempts didn't hold (see
`afromarket-carousel-bugs-todo.md`). Both templates below must be built with every
changeable value — text, images, codes, prices — as a variable filled at send-time.
Treat this as a hard build constraint, not a style preference, and verify it before
submission, not after.

---

## Corrections (2026-08-14) — read before the sections below

### Correction 1 — the reference screenshots aren't a template at all

The real WhatsApp catalog template schema is `body text + optional footer + one
CATALOG-type button`, full stop — no header image field, no title/tagline
components, no category-row or "Top Deals" component. What the reference screenshots
show (category carousel, Top Deals section) is Meta's own native Commerce-Catalog
storefront (the **Collections** feature), rendered automatically by WhatsApp the
instant "View Catalog" is tapped, driven entirely by Meta Commerce Manager data —
nothing to build in code. This also means Template 1 didn't need to be a *submitted*
Template at all: since it fires as the bot's response inside an already-open session
(the customer's first message / a `request_welcome` event, not before either), a
plain interactive message works, ships instantly, and needs no Meta review cycle.
Built that way — see `docs/requirements/afromarket.md` v2.16.

### Correction 2 — header image is not the profile picture

Confirmed via Meta's actual API: the catalog message's header image is sourced from
a **catalog product's own photo** (`thumbnail_product_retailer_id`, defaulting to
the catalog's first item when omitted) — there is no field referencing the WABA
profile picture anywhere in either the template or interactive-message schema.
Built using a specific featured product's photo instead (currently Bouillie Jaune,
since it's the newest addition).

### Correction 3 — "Shop now" can't deep-link to a checkout that doesn't exist, and
### the LTO template type has its own hard constraints

AfroMarket has no product storefront website — checkout is entirely in-chat, ending
in a Stripe Checkout **session** URL minted fresh per order, not a static per-product
page a button could point at. Variant A's "Shop now" therefore routes back into the
bot via `QUICK_REPLY` (added item to the bot's own cart at the discounted price,
recomputed from the current product config — not trusted from the tapped template),
confirmed with the business owner before building.

Variant B (the code variant) hit two further constraints only discoverable by
actually submitting against the real API:
- Meta's Limited Time Offer template type **requires its second button to be
  `URL`, not `QUICK_REPLY`** — so Variant B genuinely cannot route "Shop now" back
  into the bot the way Variant A does. Per the business owner's explicit
  instruction, Variant B was submitted anyway (prepared for later) with a
  placeholder URL, not wired into live sending.
- **`wa.me` deep-links are rejected as a template URL button target** ("Direct links
  to WhatsApp aren't allowed for buttons") — this broke the originally-planned
  wa.me-placeholder fallback (the same one `submitCatalogBatch.js` uses elsewhere
  for products with no dedicated page). Shipped instead with a real, working page on
  a domain this business controls (`legal.botmanagementservice.eu/impressum.html`)
  as an honest placeholder — swap for the real discounted-checkout destination
  whenever Variant B is actually activated.
- Also confirmed live and worth knowing for any future template: quick-reply/URL
  button *text* cannot contain emoji, newlines, or variables ("Buttons can't have
  any variables, newlines, emojis or formatting characters"), and LTO's
  `limited_time_offer.text` field is capped at 16 characters — neither documented
  anywhere findable in advance, only surfaced by the real API's error response.

### Correction 4 — "Top Deals"/categories are a Commerce Manager task, not code

Per Correction 1: categories and a "Top Deals" section are **Meta Collections**,
configured directly in Commerce Manager — confirmed as a real, current Meta feature
("Collections... organize items in their catalogs by category"). No public Graph API
endpoint for creating them was found in this session (only generic Product Sets,
which may or may not be the same underlying object — worth one more check if this
ever needs to be scripted rather than clicked through). This is the business owner's
task in Commerce Manager, not something the coding agent builds.

### Correction 5 (2026-08-14) — enable_welcome_message never actually took effect;
### wrong Graph API endpoint, not a sandbox limitation

`scripts/setConversationalAutomation.js` originally POSTed to
`/{phone-number-id}` with a nested `conversational_automation` body field. Meta's
API accepted this with `{success: true}` on every call, but the setting never
actually applied — a follow-up `get` kept showing the old value indefinitely,
checked repeatedly over several minutes on production, ruling out a simple
propagation delay. Confirmed via Meta's actual Conversational Automation API
reference: `conversational_automation` is a **dedicated sub-resource endpoint**,
`POST /{phone-number-id}/conversational_automation`, not a field on the phone
number's own POST endpoint. The misleading `{success: true}` from the wrong
endpoint is exactly what let this ship without being caught initially.

This also invalidates the earlier "sandbox's free Test Number doesn't support
conversational_automation" conclusion — that was the identical wrong-endpoint bug,
not a real platform limitation. Fixed the script; re-ran `clear-ice-breakers`
against both WABAs; confirmed via `get` immediately after, on both:
`enable_welcome_message: true`, no `prompts`. Both numbers behave identically once
the endpoint is correct.

### Correction 6 (2026-08-16) — request_welcome was never going to work: Meta
### removed the webhook and enable_welcome_message entirely, 4.5 months before
### this feature was built

All of Corrections 3-5 were debugging symptoms of one underlying fact none of
them checked directly: Meta's own changelog records, dated **2026-03-27**
("Cloud API, Conversational Components"): *"Removed the `request_welcome`
webhook and welcome message feature from conversational components. This
feature is no longer supported. The `enable_welcome_message` parameter has
been removed from the Conversational Automation API."* This feature was built
starting 2026-08-14 — the mechanism it depended on had already been dead for
over four months. `GET .../conversational_automation` now 404s
("`(#100) Tried accessing nonexisting field`"); the old
`docs.../enable-welcome-messages` guide page 404s too.

A 2026-08-14 chat screenshot that briefly looked like counter-evidence (the
catalog message visibly arriving in a live `dev` chat) turned out to be a
Claude Code session's own manual `sendCatalogMessage()` verification call
(the "live-verified against the real API" step in `5e84695`'s commit message)
— confirmed by checking `dev`'s raw Railway logs for that window: real
webhook traffic landed, but `ConfigBot`'s own success-log line for
`request_welcome` handling appears nowhere in `dev`'s logs, ever, across the
feature's full lifetime. See `docs/requirements/afromarket.md` v2.22/v2.23
for the complete investigation.

**Fixed**: `request_welcome` handling and `setConversationalAutomation.js`
removed as dead code. Catalog welcome now sends on the customer's genuine
first message (no existing conversation state) instead of a "chat opened"
event that Meta no longer offers any way to observe.

---

## Template 1 — Catalog Welcome Template (replaces Ice Breakers)

### Purpose and trigger point

Replaces the current Ice Breakers-based first-contact experience entirely. This
becomes the first message a new customer sees, rather than Meta's generic pre-chat
suggested replies.

**Sequencing note:** this may make the still-open diagnostic in
`afromarket-production-trust-onboarding-issues.md` (Issue 3 — Ice Breakers vs. a real
welcome-flow regression) moot, since Ice Breakers are being replaced outright. Confirm
with the business owner whether to still finish that diagnosis first (useful
regardless, to rule out an unrelated regression) or treat it as superseded by this
work — don't assume either way.

### Layout (from reference examples, both confirmed)

- **Header banner image:** must be the **WhatsApp Business account's profile
  picture**, not a separate static upload. Verify via fresh Meta documentation
  whether the catalog message header can reference the account's live profile photo
  automatically, or whether this needs to be kept in sync manually whenever the
  profile picture changes — do not assume either behavior without checking.
- **Title:** "K-AfroMarket's" with the tagline text beneath it, styled per the
  reference image — both must be variables, not hardcoded, consistent with the
  requirement above.
- **"View Catalog" button** opens the connected Commerce Catalog as a **side panel**
  (confirmed via reference screenshot), not a page navigation — this is native
  behavior once correctly wired to the catalog already set up in the earlier
  catalog/cart migration work (`afromarket-catalog-cart-migration-todo.md`), not a
  separate build.
- **Categories row:** horizontal carousel, with a "See all" option. Populated from the
  current category list — **must be editable/non-static**, i.e. adding or renaming a
  category should not require a template resubmission. Verify against current Meta
  documentation whether category browsing in this experience is driven by the
  Commerce Catalog's own product categorization (set in Meta Commerce Manager) or by
  a separately configured list — this determines where "editable" actually needs to
  be implemented.
- **Tapping a category filters to that category's products.**
- **"Our Top Deals" section:** image, name, description, price, quick-add — same
  structure as the reference, populated dynamically (see open items — source of
  "top deals" not yet defined).

### Category → product mapping (confirmed by business owner)

| Category | Products |
|---|---|
| Fruit & Vegetables | Feuilles d'OKOK Séchées, Ndolè Cameroun |
| Grains | Haricot Rouge – Meringué, Arachide Blanche Dépulpée |
| Snack & Breakfast | Bouillie Jaune – Sèche *(new product, see below)* |
| Cooking Powder | *(currently empty — no product assigned yet)* |

New product to add to the catalog: **Bouillie Jaune – Sèche**, category Snack &
Breakfast, description (English, per business owner's one-off language decision —
matches how the existing catalog is written, French name / English description, not a
multi-language catalog redesign): *"Yellow corn porridge, smooth and comforting, ideal
for breakfast or a warm snack. Easy to prepare, with a creamy texture and a naturally
pleasant taste. Directly imported from Cameroon."* French and German versions exist
and are on file for later, not discarded — flag if/when the catalog moves to proper
multi-language support.

---

## Template 2 — Promo/Discount Templates (two variants)

Both variants share the same structure (product photo, offer text, "Shop now"
button); they differ only in whether a discount code is present.

### Variant A — no code

- Dynamic sale percentage (variable, not static text).
- Dynamic product image (variable).
- "Shop now" button — adds the item to cart at the reduced price (see open item
  below — this needs a resolved mechanism before building, not assumed).
- No code/copy-code element at all.

### Variant B — with code

- Everything in Variant A, plus:
- Dynamic discount code (variable) and a "Copy code" button, matching the reference
  layout exactly.

---

## Open items — need resolution before or during implementation

- ~~**Discounted "Shop now" mechanism.**~~ **Resolved (Correction 3):** Variant A
  routes back into the bot via quick-reply, applying the discount in the bot's own
  cart rather than WhatsApp's native catalog cart.
- ~~**"Top Deals" source.**~~ **Resolved (Correction 4):** Meta Collections,
  configured in Commerce Manager — not code.
- **Cooking Powder category is currently empty.** Still open — a Commerce Manager
  content decision (whether to create that collection before it has a product), not
  a code branch. Recommend not creating it until it has ≥1 product.
- ~~**Profile-picture-as-header-image mechanism**~~ **Resolved (Correction 2):**
  it's a catalog product's own photo, never the profile picture.
- ~~**Category browsing mechanism**~~ **Resolved (Correction 1/4):**
  Commerce-Catalog-native (Collections), not a separately configured list.
- ~~**New, not anticipated by this doc: `catalog_management` permission gap.**~~
  **Resolved (v2.18):** token regenerated with `catalog_management` scope,
  `submitCatalogBatch.js` now succeeds, Bouillie Jaune confirmed live in the
  catalog and referenceable in a real `sendCatalogMessage()` send.
- ~~**New, not anticipated by this doc: `request_welcome` webhook shape unconfirmed
  on a real event.**~~ **Resolved (Correction 6, v2.23):** there was no payload
  shape to confirm - Meta removed `request_welcome` from the platform entirely on
  2026-03-27, before this feature was even built. Replaced with catalog-on-first-
  message; `ConfigBot._handleRequestWelcome`/`setConversationalAutomation.js`
  removed as dead code.
- **New, not anticipated by this doc: Bouillie Jaune showing as only 4 products on
  a live client.** Reported by the business owner testing production. Re-confirmed
  via a direct Graph API read that all 5 products (Bouillie Jaune included, `in
  stock`) are present in the Commerce Catalog server-side - likely a client-side
  WhatsApp cache (same class of propagation delay already seen once for this exact
  product in v2.18), not re-confirmed after a client-side refresh yet.

---

## Verification plan

- ~~Confirm both templates render correctly in Meta's template preview before
  submission~~ — moot for Template 1 (not a submitted template, see Correction 1);
  done for Template 2 via live submission (both variants `PENDING` on both WABAs,
  see `docs/requirements/afromarket.md` v2.17) — check status with
  `node scripts/checkTemplateStatus.js afromarket_promo_v1` /
  `afromarket_promo_code_v1`.
- Unit/manual test: changing a category name or adding a new category does not
  require a template resubmission — **done differently than expected**: categories
  aren't a template concern at all (Correction 1/4), so this is inherently true by
  construction, not something to separately test.
- ~~Unit/manual test: swapping which product/percentage/code appears in Template 2
  requires only a new API call with different variable values~~ **Done** — covered
  by `test/whatsappClient.test.js`'s `sendPromoTemplate` tests and confirmed by the
  template's `{{1}}`/`{{2}}` variable shape.
- Manual test on a live WhatsApp client: confirm the catalog opens as a side panel
  and that category taps correctly filter products — **still open**, now blocked
  only on live browser access to actually drive a WhatsApp client from this
  session (the catalog_management blocker is resolved).
- ~~Confirm new product (Bouillie Jaune – Sèche) appears correctly categorized in
  the live catalog before Template 1 goes live~~ **Done (v2.18)** — confirmed via
  a direct Graph API read (correct name/price/availability/image) and via a real
  `sendCatalogMessage()` send using it as the header thumbnail.
