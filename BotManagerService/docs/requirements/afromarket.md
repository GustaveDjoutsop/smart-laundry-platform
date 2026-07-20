# AfroMarket WhatsApp Bot

**v2 (`botVersion2`)**: AfroMarket is now a commerce bot — European Afro-grocery
delivery, recipes with a "buy these ingredients" shortcut, plus info cards for
a physical restaurant and store — modeled closely on Meta's own
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
  │           → cart_view → Checkout (name → address → phone) → review & confirm → order confirmed
  ├─ 🍲 Get recipe ideas → recipes hub
  │     ├─ Browse Recipes → region → recipe detail → 🛒 Buy ingredients (adds to cart)
  │     ├─ Healthy Meal Plans (7-day breakdowns, unchanged from v1)
  │     ├─ Tonight's Dinner (3 quick recipes, unchanged from v1)
  │     └─ Shopping Tips → can jump straight into Shop online
  ├─ 🎉 Current promo → weekly deal + shop/recipe shortcuts
  ├─ 🍽️ Afro Restaurant → 3 real restaurants as photo cards, each with a genuine "Visit Website" button
  └─ 🏬 AfroMarket Store → address, phone, opening hours (info only)
```

## Afro Restaurant: real restaurants with working website links

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

**The 3 restaurants are real** (found via web search, addresses/phones
cross-checked against multiple sources, websites verified reachable):
Le Petit Dakar (Senegalese, lepetitdakar.com), Ohinéné (Ivorian, ohinene.fr),
BMK Paris-Bamako (West African/Mali, bmkparis.com). Ohinéné's and BMK's
opening hours weren't confirmably found, so those cards say "Check website
for current hours" rather than guessing — replace with confirmed hours
whenever available. Verified live: tapping "Visit Website" shows WhatsApp's
own "You're about to leave WhatsApp and go to https://..." confirmation with
the correct restaurant URL, and actually opens that real site.

15 products across 4 categories (Grains & Starches, Pantry & Sauces, Spices &
Seasoning, Fresh & Frozen), priced in EUR. 8 recipes carried over from v1,
each mapped in `recipeIngredients` to 1–3 of those products for the "buy
ingredients" shortcut. All images are verified `upload.wikimedia.org` links.

## Recipe browsing: visual dish cards (interim) + real carousel (pending)

Choosing a region (West/East/North/Central) sends one photo+button message
per dish (see the new `cards` state type in `flowEngine.js`) instead of a
text-only list, since list message headers can't carry per-row photos. Each
card has its own "➡️ Get this recipe" button — tapping any one of them (not
just the last rendered) opens that dish's full recipe. This ships today, no
Meta approval needed, but the cards stack vertically rather than scrolling
horizontally.

**True horizontal scrolling** (matching Jasper's Market exactly) requires a
Meta-approved WhatsApp Carousel Template — this is a hard platform
constraint, not a code choice; freeform interactive messages can never
scroll horizontally. Submitted a pilot template for the West African region
on 2026-07-20:

- Template name: `afromarket_west_african_recipes`, template ID
  `1063703219418196`, category `MARKETING` (Meta rejects `UTILITY` for
  carousel templates), language `en_US`.
- 3 cards (Jollof Rice, Egusi Soup, Suya Skewers), each with its dish photo
  (uploaded via the Resumable Upload API → `header_handle`, not a public URL)
  and a "Get this recipe" quick-reply button.
- **Status as of submission: `PENDING`** Meta review. Check current status:
  `GET /4464369590494418/message_templates?name=afromarket_west_african_recipes`
  with the `WHATSAPP_ACCESS_TOKEN_AFROMARKET` bearer token, or in WhatsApp
  Manager → Message Templates.
- Once approved: sending a template message requires
  `WhatsAppCloudClient` to gain a `sendTemplate`/carousel-send method (not yet
  built — the interim `cards` state still runs meanwhile) and `west_recipes`
  would switch to firing that template instead of the vertical cards.
- The other 3 regions (East/North/Central) aren't submitted yet — this was a
  single pilot to prove the upload → create → review pipeline works before
  repeating it 3 more times.

**Afro Restaurant is a directory, not AfroMarket's own restaurant**: it lists
African restaurants AfroMarket knows/recommends around Paris (Baobab Kitchen –
Senegalese, Le Maquis – Ivorian, Injera House – Ethiopian & Eritrean), not a
location AfroMarket runs. All three currently use **placeholder** names/
addresses/phones/hours in `configs/bots/afromarket.bot.json` — replace with
real restaurants before going live. AfroMarket Store (the grocery shop) is
unrelated and still a single info card, since AfroMarket only has the one
physical store.

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

## Known limitations / next steps

- **Checkout is a stub**: it collects name/address/phone, shows a review
  screen (Confirm / Start Over / Cancel) so a mistyped or reserved-word reply
  can't silently place an order, then confirms an order number — but doesn't
  take payment or persist orders anywhere; there's no order store, no
  Stripe/CamPay integration yet. Add a real payment step before taking this
  to real customers.
- **Product data is duplicated 2–3x** (the `products` catalog array, each
  category list row's price, and each `product_detail_*` caption) since prices
  are baked into strings for simplicity. If prices change often, worth adding
  Mustache templating driven from the `products` array instead.
- **Cart is per-conversation, in Redis/in-memory** (same TTL as everything
  else) — abandoned carts just expire, no recovery flow.
- Restaurant/table reservation and physical-store loyalty features were
  explicitly scoped out for v2 (info cards only, per Gustave's ask).

## Message templates (submit in WhatsApp Manager when going proactive)

| Name | Category | Purpose |
|---|---|---|
| `afromarket_welcome` | MARKETING | Onboarding greeting, `{{1}}` = name |
| `afromarket_daily_recipe` | MARKETING | Daily recipe tip with image header |
| `afromarket_mealplan_reminder` | UTILITY | Weekly meal-plan reminder |

Templates are only needed for business-initiated (outbound) messages; the whole
menu/shop/checkout experience above works inside the 24h customer-service
window without them.
