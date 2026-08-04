# AfroMarket WhatsApp Bot

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
(`business.facebook.com/latest/whatsapp_manager/messaging_limits`):
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
