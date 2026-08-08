# AfroMarket WhatsApp bot: how to test correctly at each stage

**Why this doc exists:** on 2026-08-04 a live "test" was run against what was
believed to be dev, but the Meta webhook Callback URL was actually still
pointed at production's custom domain (`bot.botmanagementservice.eu`). Every
prior "confirmed working on dev" claim that session was wrong — production's
code was being exercised instead. This doc exists so that mistake doesn't
repeat. Read it before claiming any live WhatsApp test validated a specific
environment.

## The one hard fact that causes this mistake

There is **one Meta App** ("AfroMarket-Bot"). The App has **one Callback URL
+ one Verify Token field**, full stop. Whichever backend URL is pasted into
that field is the one that receives *every* inbound webhook, regardless of
which WhatsApp number sent the message. Meta does not let you point
different WABAs/numbers at different URLs from the same App.

So "which number I texted" and "whose code actually ran" are two different
questions. Only the Callback URL field answers the second one.

## The two WhatsApp Business Accounts (WABAs) under that one App

| WABA | Real customers? | Used for |
|---|---|---|
| **K-AfroMarket** | Yes — production | production only |
| **Test WhatsApp Business Account** | No — Meta sandbox number | local, PR environments, dev |

Both hang off the same App, hence the single shared webhook constraint above.

## How phoneNumberId/accessToken selection actually works (confirmed in code)

`configs/bots/afromarket.bot.json` hardcodes the **Test** number as the
default: `"phoneNumberId": "1089648187567384"`.

`botRegistry.js` (`resolvePhoneNumberId`) and `whatsappClientFactory.js`
(`getAccessTokenForBot`) both read env vars named by convention
`PHONE_NUMBER_ID_<BOTID>` / `WHATSAPP_ACCESS_TOKEN_<BOTID>` (uppercased
botId, e.g. `PHONE_NUMBER_ID_AFROMARKET`) — but **the two fall back
differently, not identically**:

- `resolvePhoneNumberId` falls back to the bot.json default (the Test
  number) if the env var isn't set.
- `getAccessTokenForBot` falls back to **`null`** — there is no
  access-token field in bot.json at all. If
  `WHATSAPP_ACCESS_TOKEN_AFROMARKET` isn't set on an environment, the
  WhatsApp client is simply **unconfigured** (`isConfigured()` returns
  `false`) and can't send anything — it does not quietly use some "Test
  WABA default" token.

As of this writing, `PHONE_NUMBER_ID_AFROMARKET` (and the matching real
K-AfroMarket access token) is only set on Railway's **production**
environment. Every other environment (local, dev, every PR environment) runs
with the bot.json default phoneNumberId — i.e. the Test number — and needs
its own `WHATSAPP_ACCESS_TOKEN_AFROMARKET` set explicitly or it can't send
at all. **Don't assume dev has a working token by default; check the actual
Railway env vars for that environment if it matters.**

## The three deployment stages and what each one requires to test correctly

### 1. PR opened (not yet merged)

- Railway spins up a **separate, fully independent PR Environment**
  (e.g. `smart-laundry-platform-pr-73`) — its own `environmentId`, own
  variable set. It does **not** inherit `dev`'s variables automatically.
  Any env var the PR's code path needs (e.g.
  `AFROMARKET_NATIVE_CATALOG_ENABLED`, `AFROMARKET_CATALOG_ID`) must be set
  on that specific PR environment or it silently falls back to
  off/misconfigured — verify with Railway's variable inspector, not
  assumption.
- To test *this exact code* live over WhatsApp:
  1. Get the PR environment's own generated backend URL from Railway.
  2. Point the Meta App's Callback URL at
     `<pr-env-url>/api/whatsapp/webhook` (the real mount — see
     `src/app.js` → `src/routes/whatsappWebhook.js`).
  3. Get the PR environment's own Verify Token value and **curl-verify it
     directly** before pasting into Meta:
     `curl "<pr-env-url>/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=test123"`
     → must return `200` and echo back `test123`. Do not trust a
     copy-pasted value without this check — verify tokens across
     environments look similar and have been mixed up before.
  4. Message the **Test WhatsApp Business Account** number.
  5. **Revert the Callback URL back to production immediately after**
     (see "Mandatory revert" below) — a forgotten repoint means production
     silently stops receiving webhooks.

### 2. PR merged → auto-deployed to dev

- `dev` is a real, standing Railway environment (not a PR environment) and
  currently **does** auto-deploy from `master` (confirmed 2026-08-08 — this
  contradicts an earlier-session belief that all services had auto-deploy
  disabled everywhere; only `production` is actually hardened to
  manual-deploy-only. Worth revisiting but not yet done).
- Same repoint procedure as above, but against `dev`'s own URL and `dev`'s
  own Verify Token (curl-verify it too — it is a **third, distinct** token
  value from both the PR's and production's).
- Confirm `dev`'s own env vars have whatever the feature needs
  (`AFROMARKET_NATIVE_CATALOG_ENABLED`, `AFROMARKET_CATALOG_ID`,
  `AFROMARKET_PHONE_NUMBER`, etc.) — these do not carry over from a PR
  environment or from `master` merging; they're set per-environment in
  Railway directly.
- Message the **Test WhatsApp Business Account** number.
- **Revert the Callback URL back to production immediately after.**

### 3. On production

- Production's custom domain `bot.botmanagementservice.eu` is the
  **default, at-rest** Callback URL — this is where it should be pointed
  whenever you are *not* actively mid-test on a PR/dev environment. This is
  also why the 2026-08-04 mistake happened: it was already pointed here
  from a previous session and never got repointed before that day's test.
- Production has its own separate Verify Token (curl-verify against
  `bot.botmanagementservice.eu` specifically before trusting any pasted
  value).
- Production has `PHONE_NUMBER_ID_AFROMARKET` (+ matching access token) set,
  so it actually sends/receives via the **K-AfroMarket** real number, not
  the Test number — the one environment where that's true.
- Production is manual-deploy-only on Railway (confirmed intact
  2026-08-08 — a `master` merge does not auto-deploy here; someone must
  trigger the deploy explicitly). This is deliberate hardening — don't
  "fix" it to auto-deploy without a deliberate decision to do so.
- **Never repoint the Callback URL away from here except for an active,
  time-boxed test** — every minute it points elsewhere, production receives
  zero inbound webhooks (no incoming customer messages/orders processed).

## Mandatory revert-to-production checklist (do this after every test)

1. Repoint Callback URL back to `https://bot.botmanagementservice.eu/...`.
2. Paste back production's Verify Token (curl-verify it one more time
   against the production URL after saving, to confirm Meta accepted it —
   don't just trust the save dialog).
3. Send one harmless test message from a personal number to the
   **K-AfroMarket** number and confirm the bot responds normally.
4. Only then consider the test session closed.

## Standing rule

**A WhatsApp reply proves code ran somewhere — never assume it proves code
ran on the environment you intended.** Before trusting any live-test result,
state out loud (or in the PR/commit note) which URL the Callback was
pointed at when the message was sent, and how that was verified (curl
output, not memory).
