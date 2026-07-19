# AfroMarket WhatsApp Bot

Recipes, healthy meal plans and dinner ideas for African cuisine, modeled on Meta's
[Jasper's Market](https://github.com/fbsamples/whatsapp-business-jaspers-market) demo.
Full source instructions: `AfroMarket_WhatsApp_Bot_Instructions.md` (Downloads).

Unlike Laundry/ThomasNetwork, AfroMarket is a **pure configuration-driven bot**: the
entire experience lives in `configs/bots/afromarket.bot.json`. There is no
`AfroMarketBot` class and no plugin — it runs on the generic `ConfigBot`.

## Conversation map

```
hi/menu → Main menu (list)
  ├─ 🍲 Browse Recipes → region list (West/East/North/Central)
  │     └─ recipe list → recipe detail (image + caption) → follow-up buttons
  ├─ 🥗 Healthy Meal Plans → Balanced / High-Protein / Vegan (7-day breakdowns)
  ├─ 🌙 Tonight's Dinner → 3 quick recipes (≤30 min)
  ├─ 🛒 Shopping Tips → African pantry essentials
  └─ ℹ️ About AfroMarket
```

Recipes (8): Jollof Rice, Egusi Soup, Suya Skewers (West), Injera with Tibs,
Ugali & Sukuma Wiki (East), Chicken Tagine, Shakshuka (North), Fufu with Ndolé
(Central). Images are direct `upload.wikimedia.org` links (verified reachable).

## Meta setup (one-time, manual)

1. [developers.facebook.com/apps](https://developers.facebook.com/apps/) → **Create App**
   → type **Business** → name `AfroMarket-Bot` → add product **WhatsApp**.
2. **WhatsApp → API Setup**: note the **Phone Number ID** and WABA ID; add your own
   WhatsApp number as a test recipient (OTP verification).
3. Replace `phoneNumberId` (`REPLACE_ME_AFROMARKET_PHONE_NUMBER_ID`) in
   `configs/bots/afromarket.bot.json` with the real Phone Number ID.
4. Set `WHATSAPP_ACCESS_TOKEN_AFROMARKET` (temporary token for testing; for
   production create a System User in Business Manager with
   `whatsapp_business_messaging` + `whatsapp_business_management` scopes) and
   `META_VERIFY_TOKEN_AFROMARKET` (any random secret string — the bot config
   references it via `${META_VERIFY_TOKEN_AFROMARKET}`).
5. **WhatsApp → Configuration → Webhooks**: Callback URL
   `https://<host>/api/whatsapp/webhook`, Verify Token = the value of
   `META_VERIFY_TOKEN_AFROMARKET`, subscribe to the `messages` field.
   (Local dev: `ngrok http 3000`.)
6. Production hardening: set `WHATSAPP_VERIFY_SIGNATURE=true` and
   `WHATSAPP_APP_SECRET` (App Settings → Basic → App Secret).

## Message templates (submit in WhatsApp Manager when going proactive)

| Name | Category | Purpose |
|---|---|---|
| `afromarket_welcome` | MARKETING | Onboarding greeting, `{{1}}` = name |
| `afromarket_daily_recipe` | MARKETING | Daily recipe tip with image header |
| `afromarket_mealplan_reminder` | UTILITY | Weekly meal-plan reminder |

Templates are only needed for business-initiated (outbound) messages; the whole
menu experience above works inside the 24h customer-service window without them.
