# AfroMarket Bot — Live WhatsApp Test Pass (2026-07-22)

Full feature walkthrough on the real AfroMarket-Bot WhatsApp number (test app,
phone number ID `1089648187567384`, WABA `4464369590494418`), against a
freshly restarted `npm start` (not `npm run dev`) with the ngrok tunnel
`https://8a1d-217-241-196-170.ngrok-free.app`. `FLUTTERWAVE_SECRET_KEY` is
**not** set in `.env`, so every checkout in this pass exercised the
"no payment provider configured" instant-confirmation fallback, not the real
Flutterwave flow — that still needs a separate live pass once sandbox
credentials are available.

## Template status (start and end of this pass)

| Template | Status |
|---|---|
| `afromarket_west_african_recipes` | **APPROVED** |
| `afromarket_east_african_recipes` | PENDING |
| `afromarket_north_african_recipes` | PENDING |
| `afromarket_central_african_recipes` | PENDING |
| `afromarket_restaurants_v1` | PENDING |

No change across the pass (checked both before and after the full test
sequence).

## Scenarios tested

| # | Scenario | Result | Notes |
|---|---|---|---|
| 1 | `hi` → main menu | ✅ Pass | Welcome list with 5 sections rendered correctly. |
| 2 | Shop online → category → product detail | ✅ Pass | Image + price + description + Add to Cart/View Cart/Back rendered correctly. |
| 3 | Add to cart → View Cart | ✅ Pass | Correct item, price, total; Checkout/Continue Shopping/Main menu buttons present. |
| 4 | Checkout: combined one-message prompt | ✅ Pass | Prompt shows the recommended `Name:`/`Address:`/`Email:` format and states the WhatsApp number will be used automatically. |
| 5 | Checkout: malformed input (no Name/Address) | ✅ Pass | Bot replies with an error and re-shows the exact prompt; does not advance or lose the cart. |
| 6 | Checkout: valid combined message | ✅ Pass | Name/Address parsed correctly; **Phone auto-derived from the WhatsApp sender number** (`+4917630176915`), never asked; Email left blank since optional and not provided. |
| 7 | Order confirmation (no Flutterwave configured) | ✅ Pass | Instant "Order confirmed" with order number, itemized total, delivery address, contact, estimated delivery date; cart cleared afterward. |
| 8 | Recipes → Browse Recipes → East Africa (carousel PENDING) | ✅ Pass (fallback) | Real API call to send the carousel template correctly rejected by Meta (`(#132001) Template name does not exist` — expected, still PENDING); code caught the failure and fell back to the vertical cards cleanly, with no user-visible error. |
| 9 | Recipe detail → "Bon appétit" follow-up chaining | ✅ Pass | Recipe detail image+caption always immediately followed by the Buy ingredients/More recipes/Main menu message, no gap. |
| 10 | Buy ingredients → View Cart button swap | ✅ Pass | After buying ingredients, "Buy ingredients" correctly replaced by "👀 View Cart" (cart now non-empty); tapping it opens the cart with Checkout/Continue Shopping/Main menu. |
| 11 | Meal Plans → High-Protein Plan | ✅ Pass | Full 7-day breakdown rendered correctly with Other plans/Recipes/Main menu follow-up. |
| 12 | Tonight's Dinner Ideas | ✅ Pass | 3 quick recipes listed with cook times; each opens its full recipe correctly. |
| 13 | Shopping Tips | ✅ Pass | Static pantry-essentials content rendered correctly with Shop groceries/Recipes/Main menu follow-up. |
| 14 | Current Promo | ✅ Pass | Weekly deal text + code, Shop now/Recipes with it/Main menu follow-up. |
| 15 | Afro Restaurant (carousel PENDING) | ✅ Pass (fallback) | Same pattern as #8: real carousel attempt correctly rejected by Meta (still PENDING), fell back to the 3 real-restaurant `cta_url` cards (Bantabaa/Yajee/Afropot Berlin) with working "Visit Website" buttons and correct Berlin addresses/phones/hours. |
| 16 | AfroMarket Store info | ✅ Pass | Correct Berlin placeholder address/phone/hours; Shop online/Main menu follow-up. |
| 17 | West Africa carousel (APPROVED template) | ✅ Pass, with a real reliability finding — see below | Confirmed genuinely working as a real horizontal carousel in an earlier test this session (see finding #1), but during this pass hit a **live Wikimedia rate-limit (429)** while re-downloading one of the 3 recipe images for re-upload to Meta, and correctly fell back to vertical cards. Not a code bug — the fallback did exactly its job — but a real, reproducible operational risk. |
| 18 | North Africa carousel (PENDING) | ✅ Pass (fallback) | Same clean fallback pattern as East/Restaurants. |
| 19 | Central Africa carousel (PENDING), incl. new Poulet DG dish | ✅ Pass (fallback) | Fufu with Ndolé + **Poulet DG** (the newly added 2nd dish) both rendered correctly with real photos, correct cook time/kcal/difficulty. |
| 20 | Continue Shopping (from cart view) | ✅ Pass | Returns to the grocery category list correctly. |
| 21 | Cart persistence across navigation | ✅ Pass (incidental) | Items added via "Buy ingredients" for a recipe remained in the cart correctly after navigating through several unrelated menus (Meal Plans, Dinner Ideas, Shopping Tips, Current Promo, Afro Restaurant, AfroMarket Store) in between. |

Not re-tested live this pass (already covered by the automated test suite,
103/103 passing): empty-cart checkout warning, Cancel/Start Over from the
checkout review screen, reserved-word-as-checkout-input handling, and the
Flutterwave payment-configured path (no sandbox credentials available yet).

## Findings

### 1. Real, reproducible reliability risk: Wikimedia image re-fetching at send time (Medium-High priority)

`WhatsAppCloudClient.uploadMedia` downloads each carousel card's image fresh
from its public Wikimedia URL on **every single carousel send**, then
re-uploads it to Meta's Media API. This session hit Wikimedia's rate limit
(`429 Too many requests`, `retry-after: 600`) multiple times purely from this
same dev machine's own repeated image fetches (both from this feature and
from earlier template-submission work). When it happened live during this
test pass, the carousel send failed and the bot correctly fell back to
vertical cards — the fallback mechanism worked exactly as designed, and no
customer-visible error occurred. But this means **the "real Meta-approved
horizontal carousel" experience is not reliably available even for an
approved template**, since it silently degrades to the vertical fallback
under a transient, entirely-external rate limit.

This was already flagged as a lower-priority "fast follow" in the code
review before this test pass; live testing now shows it's a real, currently
happening failure mode, not just a theoretical one. Recommend prioritizing
a `{imageLink → mediaId}` cache (e.g. via the already-used `redisManager`,
with a TTL under Meta's media-id expiry) so a production deployment doesn't
depend on Wikimedia's live availability every time a customer browses
recipes or restaurants.

### 2. WhatsApp Web's own message list appears to reorder image-bearing fallback messages (Low priority, needs a mobile-app check)

For every multi-card vertical-fallback render (East/North/Central regions,
Afro Restaurant), WhatsApp **Web's** message list — both visually on repeated
scroll-backs and via DOM text extraction — consistently showed the
"More options:" footer appearing *between* the first and second card,
not after all cards. I verified the actual send code
(`flowEngine.js`'s `cards` state, vertical-fallback branch) is a strictly
sequential `for` loop with `await` on every item, followed by a separate
`await` for the footer only after the loop completes — there is no code path
that could send the footer before the last card. The most likely explanation
is that WhatsApp Web's own rendering doesn't guarantee DOM/visual order for
image-bearing bubbles that arrive in a rapid burst (a plain text/button
message can attach to the UI faster than one still loading/decoding an
image), which would not necessarily reproduce on the actual mobile app
(which renders by server-assigned sequence more reliably). **This could not
be fully confirmed or ruled out from this environment** (WhatsApp Web only,
no phone available) — worth a quick manual check on an actual phone before
concluding either way. Send order in the code itself is confirmed correct.

### 3. Everything else: no bugs found

Every other tested scenario — cart flow, checkout (including the malformed-
input retry and the combined name/address/email message with auto-derived
phone), recipe browsing and ingredient-buying, meal plans, dinner ideas,
shopping tips, current promo, restaurant directory, store info, and all 3
newly-PENDING carousel templates' fallback behavior — worked exactly as
designed. The graceful degradation from "real carousel" to "vertical cards"
worked cleanly and invisibly to the user in every case it was triggered
(both by Meta's expected 404 for not-yet-approved templates, and by the
unexpected live Wikimedia rate-limit), which is the core reliability
guarantee that design was built for.

## Follow-ups

1. **Priority**: cache uploaded media ids for carousel card images (finding #1) instead of re-fetching from Wikimedia on every send.
2. Re-check the 4 PENDING templates periodically (`node scripts/checkTemplateStatus.js <name>`) and re-run this same live pass once each is approved, to confirm the real carousel (not just the fallback) for East/North/Central/Restaurants.
3. Verify finding #2 (footer/card ordering) on an actual WhatsApp mobile client, not just WhatsApp Web.
4. Once Flutterwave sandbox credentials are available, repeat the checkout scenarios (#4-#7) against the real payment flow: hosted payment link via `cta_url`, webhook-driven order confirmation, and the "email required at payment time" prompt.
