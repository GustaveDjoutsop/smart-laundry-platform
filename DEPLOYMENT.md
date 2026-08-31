# Deployment Strategy

This document defines how code moves from a feature branch to production on Railway,
how releases are versioned, how to roll back, and how new bot features are exposed to
customers gradually per tenant.

This is the adapted, reality-matched version of an earlier draft. The original draft
proposed a `develop`/`main` GitFlow with GitHub branch protection; neither matched how
this repo actually works, so this version documents what's genuinely in place instead
of retrofitting the repo to a generic template. See "What changed from the original
draft" at the bottom for the reasoning.

## Goals

- `master` always reflects exactly what is running in the `production` Railway
  environment — no drift, no guessing.
- Every production release is tagged and reversible in under a minute.
- The real, customer-facing WhatsApp number and the test number never share an
  environment, so a broken change can't reach real customers just from testing.
- Process stays lightweight enough for a solo developer to actually follow.

---

## 1. Branch model

**One branch: `master`.** This is a shared monorepo (BotManagerService,
MachineStateService, PaymentManagementService, spring-bot-manager-only, the dashboard,
api-gateway, Reporting-bff, ...) and most of those services are on their own
migration-phase timeline (see `architecture-review/03-MIGRATION-TODO.md`). Introducing
a repo-wide `develop`/`main` split would touch all of them for a problem specific to
BotManagerService's release safety — not worth it.

Rules (unchanged from existing practice):
- Never push directly to `master`. Every change goes on its own `feature/*` or
  `bugfix/*` branch, gets its own PR.
- Before merging, have a subagent (or yourself) review the diff.
- After merging, tag the release (see §4) if it's going to `production`.

```
feature/afromarket-real-product-catalog ──PR──> master ──auto-deploy──> dev environment
                                                    │
                                                    │ (tag + promote when ready)
                                                    ▼
                                            production environment
```

**Branch protection is not available** on this GitHub plan (private repo, free tier —
enabling it requires GitHub Pro or making the repo public). Decided to skip it for now
and rely on discipline + the PR habit instead of a hard gate. Revisit if/when the plan
changes.

---

## 2. Railway environments

Single Railway project (`smart-laundry-dev` — the name is legacy, don't read anything
into it), two environments:

| Environment | Branch trigger | WhatsApp number | Domain |
|---|---|---|---|
| `production` | `master` (**manual deploy only**) | Real AfroMarket number | `bot.botmanagementservice.eu` (custom domain) |
| `dev` | `master` (auto-deploy) | Test WhatsApp Business number | `*.up.railway.app` (Railway-generated) |

**Correction (2026-08-16): `production` does NOT auto-deploy, despite what this
section originally claimed.** Confirmed directly in Railway (BotManagerService →
Settings → Source → "Branch connected to production" → `master`, with **"Auto deploy
is disabled"** shown next to it). Real-world evidence this was already true in
practice, not just a config value nobody noticed: `production`'s active deployment was
still PR #97 (merged 2026-08-14 14:28) while `master` had moved 4 merges ahead,
including a same-day fix and a diagnostic-logging commit merged that same morning —
none of it reached `production` until manually deployed (see §2a). The original "both
environments auto-deploy" claim below is kept struck through rather than deleted, since
`dev` genuinely still does auto-deploy — only `production`'s behavior was wrong.

~~**Important:** both environments auto-deploy on every push to `master` — there is no
separate promotion step at the Railway level.~~ **Now accurate only for `dev`.**
`production` requires the manual trigger in §2a below for every release. Safety still
comes from:
1. Code review before merge (existing habit).
2. The `dev` environment's WhatsApp credentials point at the test number only, so a
   bad `dev` deploy can't reach a real customer.
3. `production` now additionally requires a deliberate manual step (§2a) — nothing
   reaches real customers just from merging to `master`.
4. Tag + Railway deployment-history rollback (§5) if something does slip through.

This is a deliberate simplification versus a "verify in dev, then promote to prod"
gated pipeline — a solo developer doesn't get much from an extra manual promotion
click that a subagent code review + tests don't already catch, and the two-environment
split still guarantees a broken deploy never touches real WhatsApp traffic *while
you're building the feature*. It reduces "test one thing, patch a slightly different
thing in prod" — not "code review didn't catch it." (In practice, `production`'s manual
deploy step turned out to double as exactly that promotion gate anyway — see §2a.)

---

## 2a. Manual deploy trigger (production)

Since `production`'s `master` branch connection has **"Auto deploy" disabled**,
merging a PR does **not** ship it to real customers — it only updates `dev`. Nothing
reaches `production` until this manual step is run. Skipping this step is exactly how
`production` ran 2 days and 4 merges stale (including a bug fix) until caught by a
live WhatsApp test on 2026-08-16.

**Steps (Railway dashboard):**
1. Open the project: [smart-laundry-dev / production](https://railway.com/project/e897f8fd-21ae-4911-9c6a-df5e8dd43fe3?environmentId=4f17728e-7f14-4c22-aac6-1c305dabbc56)
   (confirm the environment switcher top-left reads **`production`**, not `dev`).
2. Click the service card you want to deploy (e.g. `BotManagerService`) to open its
   panel.
3. Press **Ctrl+K** (Windows/Linux) / **Cmd+K** (Mac) to open Railway's command
   palette.
4. Type `Deploy latest commit` and select the single matching result (it's scoped to
   whichever service's panel is open — verify the service name in the palette/panel
   header before confirming).
5. A toast confirms **"Deployment triggered"**, and a new deployment card appears
   with status `INITIALIZING` → `BUILDING` → `DEPLOYING` → `ACTIVE`. The commit
   subject shown should match the latest merge on `master` (check against
   `git log -1 --format=%s origin/master`). Takes roughly 30–40 seconds end to end.
6. Once `ACTIVE` with "Deployment successful," the previous deployment moves to
   `HISTORY` as `REMOVED`. Confirm via `View logs` → `Deploy Logs` or `Network Logs`
   that fresh traffic is landing (no visual difference otherwise — Railway doesn't
   auto-restart in-flight connections).

**Repeat once per service** you need to deploy — the command palette only deploys the
service whose panel is currently open, there's no "deploy all services" action.

**Gotcha:** the "Redeploy" option under a deployment's `⋮` menu does **not** pick up
new commits — it just rebuilds/restarts the *same already-deployed* commit. Use
"Deploy latest commit" via the command palette instead when the goal is to ship new
code.

**Why this convention exists rather than re-enabling auto-deploy:** this manual step
is now `production`'s de facto "promote to real customers" gate (see §2's note above)
— cheap enough for a solo developer to run after confirming a change is ready, without
the overhead of a `develop`/`main` split. The tradeoff is real: it's easy to forget,
as this section's own correction demonstrates. Treat "deploy to production" as an
explicit item on the release checklist (§6), not an assumed side effect of merging.

**Why the production domain matters:** Railway's auto-generated domains bake in the
environment name (`botmanagerservice-dev.up.railway.app`). If the webhook URL
registered with Meta pointed at that, renaming or restructuring the environment would
break real customer traffic until Meta's config was updated to match. `production` now
uses `bot.botmanagementservice.eu` instead — a custom domain Railway environment
changes can't touch. `dev` doesn't need this since its test number's webhook can break
without customer impact.

Setup performed (2026-08-04):
1. Added custom domain `bot.botmanagementservice.eu` to the (then-named) `dev`
   environment, CNAME + TXT verification records added at Namecheap. ✅ Done.
2. Updated Meta's webhook Callback URL for the real AfroMarket WABA to
   `https://bot.botmanagementservice.eu/api/whatsapp/webhook`, verified with a real
   test message. ✅ Done — confirmed end-to-end via WhatsApp Web (bot replied with the
   welcome message through the new domain).
3. Renamed the environment `dev` → `production` (metadata only, once the domain no
   longer depended on the environment name). ✅ Done — confirmed webhook still
   verifies correctly post-rename (custom domain is unaffected by environment
   renames, unlike Railway's auto-generated domains).
4. Created a new `dev` environment (Railway "Duplicate Environment" from `production`),
   then swapped WhatsApp credentials to a dedicated test setup:
   - Created a **separate Meta app** (`AfroMarket-Dev`, App-ID `1062969406286663`) under
     the same business (`BoT Management Service`, `2193429567854664`), with its own free
     Test-Nummer and its own Webhooks screen — deliberately structurally isolated from
     the production app's config (see "Why a separate Meta app" below).
   - `PHONE_NUMBER_ID_AFROMARKET`: left unset in `dev` (removed — it had been inherited
     from `production` via the environment clone, which pointed dev at the *real* number
     and caused `[WARN] No bot configured for phone_number_id=...`). Falls back to the
     JSON default in `configs/bots/afromarket.bot.json`, which happens to already match
     the new test number's ID (Meta's test numbers appear to be shared/reused per
     business, not uniquely minted per app).
   - `WHATSAPP_ACCESS_TOKEN_AFROMARKET`: new permanent System User token, scoped to the
     `AfroMarket-Dev` app only, `whatsapp_business_messaging` permission, never expires.
   - `META_VERIFY_TOKEN_AFROMARKET`: freshly generated random dev-only string (not
     Meta-issued — this one is just a shared secret for the webhook GET challenge).
   - AfroMarket-Dev's Webhooks screen: Callback URL set to `dev`'s Railway
     auto-generated domain (`https://botmanagerservice-dev-7fcf.up.railway.app/api/whatsapp/webhook`)
     — no custom domain needed since it's not customer-facing.
   - Separate Redis instance (`Redis-AfroMarket`) already existed from the environment
     clone.
   - **Subscribed the test WABA to the app's webhooks** (`POST /{waba-id}/subscribed_apps`,
     required `whatsapp_business_management` permission on a one-off token) — without
     this the exact same silent-failure bug from the original production incident
     recurs: GET verification succeeds, but no POST webhook ever arrives.
   ✅ Done — confirmed end-to-end via WhatsApp Web: sent a message to the AfroMarket-Dev
   test number, bot replied with the welcome message through the dev environment.

**Why a separate Meta app instead of reusing AfroMarket-Bot's test number:** Meta's
webhook Callback URL is configured once per app, shared by every WABA/phone number
subscribed to it. A single app can't point production and dev at two different URLs.
Two separate apps under the same business give each its own Webhooks screen, own
Callback URL, own verify token — dev testing never touches the production app's
settings at all.

The empty `smart-laundry-prod` Railway *project* (a different thing from the
`production` *environment* above) is unused — left alone for now, candidate for
deletion once confirmed nothing depends on it.

---

## 3. Versioning and tags

Tag a release right after merging something you're promoting to production traffic —
not necessarily every single merge, since `dev` deploys on every push but
`production` only ships once you run the manual deploy in §2a. Tag when you've
decided "this is a point I'd want to roll back to."

```bash
git checkout master
git pull
git tag -a v1.1.0 -m "Real K-AFROMARKET product catalog replaces placeholder groceries"
git push origin v1.1.0
```

Semver:
- **patch** (`v1.0.1`) — bug fix, no behavior change for existing customers
- **minor** (`v1.1.0`) — new feature or content change, backward compatible
- **major** (`v2.0.0`) — breaking change to bot config schema or webhook contract

No `CHANGELOG.md` yet — PR descriptions on GitHub already carry this (see PRs #56-#60
for the pattern: what changed, why, test plan). Revisit if PR history stops being
enough to answer "what shipped and why."

---

## 4. Rollback

**Fast (< 1 minute): Railway deployment history.**
`production` environment → Deployments → find the last known-good build → **Redeploy**.
Restores service immediately while you investigate on `master`.

**Correct (same day, follow-up): git revert.**
```bash
git checkout master
git revert <bad-commit-sha>
git push
```
Keeps `master`'s history honest instead of leaving it pointed at an old deploy while
the branch has moved on. Do this after a Railway-history rollback, not instead of it —
otherwise the next merge to `master` redeploys the broken commit right back.

**If a tag exists for the last-good state**, `git checkout v1.0.0` is the fastest way
to confirm exactly what was running before reverting.

---

## 5. Feature exposure: shipping without releasing

Bot behavior is config-driven (`configs/bots/<name>.bot.json`, flow-engine-based). For
a change too risky to expose to all customers immediately, add an `enabled: false`
flag at the flow level and gate the route to it:

```json
{
  "flows": {
    "new_feature": {
      "enabled": false,
      "triggers": ["2"],
      "states": [ ... ]
    }
  }
}
```

This isn't wired into the flow engine yet — it's a convention to adopt the next time a
feature needs staged rollout, not something already enforced. When it's actually
needed: merge the flow with `enabled: false`, verify on `dev` with the test number,
then flip to `true` in a small follow-up PR when ready for real customers.

**Current limitation:** flow config lives in the repo, so flipping `enabled` still
needs a deploy - to `dev` automatically, to `production` only via the manual step in
§2a. Until that manual deploy runs, the flag change hasn't reached real customers
regardless of what the flag itself says.

---

## 5a. AfroMarket PayPal migration (env-var-flag rollout, not flow-level)

See `BotManagerService/afromarket-paypal-migration-and-shipping-todo.md` for the full
design; PR #199 (`feature/afromarket-paypal-migration`) is the implementation. Unlike
§5's not-yet-enforced flow-level `enabled` convention, this feature's staged rollout is
a genuinely wired, tested env-var flag — a concrete example to follow next time §5's
pattern is actually needed.

**`AFROMARKET_PAYMENT_PROVIDER`** (`"stripe"` | `"paypal"`, defaults to `"paypal"`) —
the single switch between Stripe and PayPal checkout. Both providers can be registered
at once; this flag picks which one `_handleCheckout` actually calls.
`afromarketFlowPlugin.js::_handleCheckout` refuses checkout (not a silent
free-instant-confirmation) if the selected provider has no credentials configured
**while another provider does** — so leaving this unset/misconfigured on an
environment that has Stripe wired up but not PayPal makes checkout unavailable, not
free. Set explicitly on every environment rather than relying on the default.

**`AFROMARKET_SHIPPING_ENABLED`** (`"true"` | unset, defaults to off) — tiered
shipping (Workstream 4). Every `shippingTiers.priceEur` in `afromarket.bot.json` is
still a `null` placeholder pending real Packlink rates; flipping this on before they're
filled in fails checkout loudly (by design) rather than charging 0€. Leave unset until
`afromarket.bot.json`'s `shippingTiers` has real prices.

### PayPal sandbox setup (2026-08-30, both `dev` and `production` on sandbox credentials)

No production (live) PayPal credentials exist yet - both Railway environments run
against **PayPal's sandbox**, using the same sandbox app's Client ID/Secret. Two
separate webhook subscriptions were registered in that one sandbox app (PayPal allows
up to 10 per app), one per environment's own domain - each webhook subscription gets
its own distinct `webhook_id`:

| | `dev` | `production` |
|---|---|---|
| Webhook URL | `https://botmanagerservice-dev-7fcf.up.railway.app/api/payments/webhooks/paypal/afromarket` | `https://bot.botmanagementservice.eu/api/payments/webhooks/paypal/afromarket` |
| Subscribed events | `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DECLINED`, `PAYMENT.CAPTURE.PENDING` | same |
| `SANDBOX_PAYPAL_CLIENT_ID` | same sandbox app | same sandbox app |
| `SANDBOX_PAYPAL_CLIENT_SECRET` | same sandbox app | same sandbox app |
| `SANDBOX_PAYPAL_WEBHOOK_ID` | this env's own webhook subscription's ID | this env's own webhook subscription's ID (**not** the same value as `dev`'s) |
| `PAYPAL_RETURN_URL` | `https://botmanagerservice-dev-7fcf.up.railway.app/payment-return` | `https://bot.botmanagementservice.eu/payment-return` |
| `PAYPAL_CANCEL_URL` | optional, defaults to `PAYPAL_RETURN_URL` | optional, defaults to `PAYPAL_RETURN_URL` |

**`SANDBOX_` in the credential env var names is the credential naming, not an
environment toggle** - both `dev` and `production` read `SANDBOX_PAYPAL_CLIENT_ID`
today because both are genuinely on sandbox. When real (live) PayPal credentials exist,
`paypalProvider.js`/`paymentService.js` need new env vars (e.g. `PAYPAL_CLIENT_ID`,
`PAYPAL_BASE_URL=https://api-m.paypal.com`) added alongside the sandbox ones, not a
find-and-replace of `SANDBOX_` - `production` should get the live credentials while
`dev` likely keeps testing against sandbox.

Do not confuse `SANDBOX_PAYPAL_CLIENT_ID`/`SECRET` with the billing system's own,
unrelated `SANDBOX_SECRET_KEY` (Stripe) - see the todo doc's scope-boundary section.

**Cannot be verified or set by Claude directly** - no Railway MCP/CLI access exists in
this environment. Confirm all five vars are actually set correctly on both
environments in the Railway dashboard before flipping `AFROMARKET_PAYMENT_PROVIDER` to
`paypal` anywhere it isn't already the effective default.

---

## 5b. JVM heap caps (cost optimization, `dev`/`stage` only)

See `railway-cost-optimization-tasks.md` (2026-08-25 baseline: $48.31/month, 94% of
which is memory) for the full task list this addresses - most of it is Railway
dashboard clicking Claude cannot do (Serverless toggles, deployment removal, PR
environment cleanup, spending alerts). This section covers the one item that's a real
lever from the repo: the four Spring Boot services with no explicit JVM heap cap, so
the JVM sizes its heap off the container's full allocated memory by default.

| Service | Dockerfile ENTRYPOINT | Explicit `-Xmx` today |
|---|---|---|
| `MachineStateService` | `java -jar app.jar` (or `railway.toml`'s `startCommand` for the `dev`-mapped Railway service - see that file's own comment on production overriding this separately in the Railway UI) | none |
| `PaymentManagementService` | `java -jar app.jar` | none |
| `api-gateway` | `java -jar app.jar` | none |
| `reporting-bff` | `java -jar app.jar` | none |

**Deliberately not editing any Dockerfile or `railway.toml` for this** - all four use
the exec-form `ENTRYPOINT ["java", "-jar", "app.jar"]`, so there's no way to condition
a hardcoded `-Xmx` flag on environment from inside the image itself, and MachineStateService's
own `railway.toml` comment leaves genuine ambiguity about whether `production` already
has its own `startCommand` override in the Railway UI or falls through to this repo's
config. Given the explicit "do not touch production" constraint on this whole
cost-optimization pass, guessing wrong here risks exactly what that constraint exists
to prevent.

Instead: the JVM automatically picks up **`JAVA_TOOL_OPTIONS`** from its process
environment on startup (logs `Picked up JAVA_TOOL_OPTIONS: ...` to stderr when it does),
regardless of how `java` was invoked - no code or Dockerfile change needed. Set it as a
plain Railway environment variable, scoped to whichever environment you want capped:

```
JAVA_TOOL_OPTIONS=-Xmx384m
```

- Set this on `dev` (and `stage`, per Task 3's judgment call) for each of the four
  services above - **do not set it on `production`** without first confirming `dev`
  runs stable for a few days at this cap (watch for `OutOfMemoryError` in deploy logs).
- `384m` is a starting point per the task file's own suggested range (`256m`–`384m`);
  raise per-service if a given one OOMs - `MachineStateService` (heaviest, ~1.16 GB
  observed) is the most likely to need a higher cap than `api-gateway`/`reporting-bff`
  (~0.6 GB observed each).
- Leaving the variable unset anywhere (including `production`, permanently, unless
  explicitly decided otherwise) is a complete no-op - current behavior is unaffected.
- **Cannot be set or verified by Claude directly** - no Railway MCP/CLI access exists in
  this environment, same limitation as §5a.

---

## 6. Release checklist

Before merging a `feature/*` or `bugfix/*` PR into `master`:

- [ ] Code review done (subagent or self)
- [ ] Tests pass locally
- [ ] If touching AfroMarket flows: sanity-checked the flow's dangling-reference and
      WhatsApp UI-limit invariants (see `test/afromarketFlow.test.js`'s structural
      tests) — these catch real bugs (a 24-char row-title violation was caught this
      way during the product-catalog migration)
- [ ] New/risky flows default to `"enabled": false` unless explicitly ready for all
      tenants (see §5 — opt-in convention, not yet enforced by code)
- [ ] If touching AfroMarket payments/shipping: `AFROMARKET_PAYMENT_PROVIDER` and
      `AFROMARKET_SHIPPING_ENABLED` are set correctly on the target environment before
      relying on their defaults (see §5a) — Claude cannot verify or set these directly,
      no Railway access

After merge:

- [ ] Confirm `dev` auto-deployed successfully on Railway
- [ ] **Manually deploy to `production`** (§2a) — this does not happen automatically
- [ ] Tag pushed if this is a point worth being able to roll back to (`git tag -a vX.Y.Z`)
- [ ] Spot-check `production` — for AfroMarket specifically, a real WhatsApp message
      end-to-end is the actual test, not just "server started"

---

## What changed from the original draft

- **No `develop`/`main` GitFlow.** `develop` existed but was 189 commits stale and
  unused; reviving it as a repo-wide integration branch was more process than a solo
  developer maintaining a shared monorepo on its own migration timeline needs.
  `master` already *is* what `develop` would have been.
- **No branch protection (for now).** Requires a paid GitHub plan or a public repo —
  a real tradeoff, not something to silently work around.
- **Environment separation lives at Railway, not git.** Both `dev` and `production`
  track `master`; the safety boundary is "which WhatsApp number is wired to which
  environment," not "which branch got promoted."
- **Custom domain added before any environment rename**, specifically because Railway's
  auto-generated domains include the environment name — renaming `dev` → `production`
  without this first would have broken the live webhook Meta had on file.
