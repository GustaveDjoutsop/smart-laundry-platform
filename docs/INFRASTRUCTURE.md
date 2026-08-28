# Infrastructure Inventory

**Purpose:** every external service this platform depends on, its current state, and
how to recreate it from scratch. Written for R13 of `Implementation Roadmap — 13 Audit
Recommendations.md` — "rebuilding the environment today would be archaeology." This
file is that archaeology, done once so it doesn't have to be redone under pressure.

**Scope note (R13 decision):** full Terraform is over-engineering at this platform's
size. Supabase, Railway, Redis Cloud, and most of Doppler stay documented-but-manual
here. Only the Auth0 tenant and Cloudflare DNS get actual Terraform (tracked
separately — see the bottom of this doc).

**Last verified:** 2026-08-28. Facts marked **(live-checked)** were confirmed against
the actual provider today (Supabase via MCP, Cloudflare/Railway via their dashboards).
Everything else is sourced from this repo's own config files and existing docs
(`smartlaundry-infra/`, `architecture-review/`) — cross-check before relying on it for
a real recovery, since some of those source docs are two months stale in places (noted
inline where found).

---

## 1. Supabase — Postgres

Three projects exist, all under one Supabase org (`xftueoygogcojvlvbwqk`). No
`smartlaundry-prod` project exists yet — deferred, see below.

| Project | Ref | Region | Plan | Status | Holds |
|---|---|---|---|---|---|
| `smartlaundry-dev` | `mmkxlwzmeercsncsseie` | eu-central-1 | Free | **ACTIVE_HEALTHY** (live-checked) | Real dev/early-prod data for the 4 core services (see below) — despite the name, this is the *active* data store today |
| `smartlaundry-test` | `sqbbircvgydrohhbypcd` | eu-central-1 | Free | **INACTIVE** (live-checked — paused, likely Supabase's free-tier auto-pause after inactivity) | Same schema/role layout as dev, no live traffic |
| `botmanagerservice` | `lkvyrvhvouendrlxkwla` | eu-central-1 | Free | **ACTIVE_HEALTHY** (live-checked) | `customer_profile`, `invoice_record`, `deletion_request_log`, `customer_identity_link` for BotManagerService/AfroMarket (ADR-008) — **live production data**, 12 real invoice rows as of this writing |
| `smartlaundry-prod` | *not yet created* | — | — | — | Deferred — creating one needs an org Pro-plan upgrade past the 2-project free cap; see `smartlaundry-infra/README.md` |

**Important, not previously documented:** `botmanagerservice` is a *separate* Supabase
project from `smartlaundry-dev`/`-test`, created 2026-08-03 — none of the existing
`smartlaundry-infra/` docs (dated 2026-06) mention it. It backs ADR-008's GDPR/invoice
data model and is a distinct recovery target from the other two.

### Schema-per-service layout (`smartlaundry-dev` / `smartlaundry-test`)

Both projects share identical `bot` / `payment` / `machine` / `ops` schemas, each with
a least-privilege role (`bot_svc`, `payment_svc`, `machine_svc`, `ops_svc`) restricted
to its own schema via `search_path` + `REVOKE ALL ... FROM PUBLIC`.

| Service | Role | Schema | Doppler project (see §7) |
|---|---|---|---|
| spring-bot-manager-only | `bot_svc` | `bot` | `spring-bot-manager` |
| PaymentManagementService | `payment_svc` | `payment` | `payment-management-service` |
| MachineStateService | `machine_svc` | `machine` | `machine-state-service` |
| reporting-bff | `reporting_svc` | `ops` (own) + cross-schema `SELECT` on `payment`/`machine`/`bot` | `reporting-bff` |
| *(future)* OperationsService | `ops_svc` | `ops` | not yet created |

Connection strings go through **Supavisor** (Supabase's pooler), not the direct DB
host — transaction mode (port 6543) for app runtime, session mode (port 5432) for
Flyway migrations. Full JDBC URL patterns and the `doppler secrets set` commands to
wire a new project in: `smartlaundry-infra/docs/connections.md`.

### `botmanagerservice` project

No pooler-mode wiring doc exists for this one yet (it postdates
`smartlaundry-infra/docs/connections.md`). Connection is via a single `DATABASE_URL`
env var (`BotManagerService/src/core/db/pgClient.js`), set directly in Railway's
service dashboard — **not** in Doppler (BotManagerService isn't Doppler-wired at all,
see §7).

### Recreate steps

1. New project: name it, region `eu-central-1` (keep regions consistent — cross-region
   adds latency the R10 audit already flagged as a problem for this user base).
2. For `bot`/`payment`/`machine`/`ops`: re-apply
   `smartlaundry-infra/supabase/migrations/*.sql` in order (P2 schema/role baseline,
   then each service's P3 Flyway baseline) via the Supabase MCP `apply_migration` tool
   or the SQL editor.
3. For `botmanagerservice`'s tables: re-run BotManagerService's own migrations —
   `BotManagerService/migrations/001_data_retention_erasure.sql`,
   `004_add_customer_identity_link.sql` (see the `migrations/` directory for the full
   ordered set).
4. Generate role passwords, store them in Doppler (not this repo, not git — see
   `smartlaundry-infra/docs/connections.md` §"Setting secrets") or, for
   `botmanagerservice`, directly as a Railway service variable.
5. Confirm "Enforce SSL on incoming connections" is on (Settings → Database) — Supabase
   defaults to this, but it's dashboard-only, not verifiable via the MCP tools used to
   provision everything else here.

**Upgrade path:** Pro plan ($25/mo) unlocks PITR/daily backups, IP allow-listing, and
a 3rd free project (removing the dev/test naming confusion above) — currently deferred
per a manual billing decision. R2's own `pg_dump`-to-R2 backup script
(`scripts/backup-databases.sh`) is the interim substitute; see `docs/BACKUP.md`.

---

## 2. Redis Cloud

One shared instance, referenced via `REDIS_URL` (preferred) or the legacy
`REDISCLOUD_URL` fallback across `api-gateway` (rate limiting), `spring-bot-manager-only`
(bot conversation state, `bot-core/.../RedisManager`), and `reporting-bff` (R9 cache
layer). Plan tier and exact Redis Cloud subscription/database name are **not verified
live** in this pass (no Redis Cloud dashboard access from this session) — cross-check
against the Redis Cloud console before treating those as fact.

### Recreate steps

1. Provision a new Redis Cloud database (or any Redis 6+ instance — nothing here
   depends on Redis Cloud specifically beyond the connection URL shape).
2. Set `REDIS_URL` (format `redis://[:password@]host:port`) as a Railway service
   variable on each of the three consuming services, or in Doppler for the two that
   are Doppler-wired (`spring-bot-manager`; `payment-management-service` and
   `machine-state-service` don't use Redis directly).
3. `management.health.redis.enabled: false` is deliberately set on `reporting-bff`
   (R9) so a Redis outage degrades caching gracefully instead of taking the service
   out of Railway's health-check rotation — replicate that setting if provisioning a
   new instance under a stricter health-check regime.

---

## 3. Auth0

**Tenant:** `dev-iuo6si32jobgnmod.eu.auth0.com` — note the `dev-` prefix is Auth0's
naming for the tenant's *domain*, not necessarily an indication this is a
non-production tenant; every service (including what's deployed to Railway's
"production" environment) points at this same tenant today. There is no separate
Auth0 prod tenant.

**API (resource server):** audience `https://smartlaundry.api`, shared by every
backend service.

### `sls-*` scopes (defined on the API resource server)

Enforced via `hasAuthority('SCOPE_sls-*')` in each Spring service; the dashboard's own
`resource:action` permission strings are a completely separate, Auth0-independent
system (see `smart-laundry-dashboard/src/lib/auth/types.ts`'s `RolePermissions` map)
— **the two must be kept in sync by hand** when adding a role or permission; nothing
enforces that they agree.

```
sls-machine-read      sls-payment-read       sls-rfid-read        sls-topup-manage
sls-machine-write     sls-payment-write      sls-rfid-manage      sls-telemetry-write
sls-machine-start     sls-payment-initiate   sls-rfid-debit       sls-bot-admin
sls-machine-command   sls-reservation-read   sls-reservation-write
sls-pricing-manage
```

### M2M applications (one per service-to-service caller)

Every backend service authenticates outbound calls via an Auth0 client-credentials
(M2M) application scoped to a subset of the `sls-*` list above. Exact application
names/IDs are **not enumerated here** — this needs a live tenant audit (Applications →
filter by "Machine to Machine") before it can be called complete; doing that audit is
the first step of R13 item 2 (Terraform), tracked separately rather than guessed at in
this doc.

### End-user application (dashboard)

`smart-laundry-dashboard` authenticates real operators via Auth0 OIDC/PKCE (Authorization
Code flow), issuing a `roles` custom claim via an Auth0 Action — SDK v4, done as part
of P6b. The Action's exact source isn't mirrored in this repo; recreating it requires
either the Auth0 dashboard's Action editor history or re-authoring it from the role
table in §"Role hierarchy" below.

### Role hierarchy (dashboard-side, `resource:action` system — not Auth0 `sls-*`)

| Role | Level | Summary |
|---|---:|---|
| `admin` | 100 | Full system access, including user deletion and system logs/backup |
| `owner` | 80 | Same as admin minus user deletion and system logs/backup |
| `manager` | 60 | Day-to-day ops: machines, transactions, expenses (create), timekeeping/absences for all staff |
| `accountant` | 40 | Finance read-only + own timekeeping/absences |
| `employee` | 20 | Start machines, own transactions/timekeeping/absences only |

### Recreate steps

1. Create a new tenant, region EU (to match every other service's region choice here).
2. Create the API resource server, audience `https://smartlaundry.api`, RBAC enabled,
   "Add permissions in access token" on.
3. Add the 16 `sls-*` scopes listed above to that API.
4. Create one M2M application per service-to-service caller (audit the live tenant
   first — see above), grant each only the scopes it actually needs (least privilege,
   not "all of them for convenience").
5. Create the dashboard's regular web application (Authorization Code + PKCE), set
   allowed callback/logout URLs to the dashboard's actual domain(s).
6. Re-author the role-claim Action (or restore from Auth0's Action version history if
   the tenant still has it) so the `roles` claim lands in ID tokens matching the table
   above.
7. Point every service's `AUTH0_ISSUER_URI` / `AUTH0_AUDIENCE` env vars (Doppler or
   Railway, per §7) at the new tenant.

---

## 4. Railway

**Project:** "BoT Management" (live-checked, R11/R12 dashboard sessions, 2026-08-27/28
— this is the Railway *project* name; don't confuse it with `smart-laundry-dev`, which
is the name of one *environment* inside it, per `MachineStateService/railway.toml`'s
header comment, or with "BoT Management Service", the unrelated Meta Business Manager
account name in `DEPLOYMENT.md`). **Region:** EU West (Amsterdam), live-checked on
`api-gateway` (R12) — assume the same for the other services unless proven otherwise,
don't treat that as independently verified for each one. **Environments:**
`production` (live-checked on `api-gateway`, R12: auto-deploy from `master` is
currently **disabled** there specifically — `DEPLOYMENT.md` separately documents the
same being true of BotManagerService's `production` environment; verify per-service,
don't assume either finding generalizes to the others) plus ephemeral PR-preview
environments, auto-created per open PR via Railway's native GitHub integration and
torn down on merge/close.

| Service | Notes |
|---|---|
| `api-gateway` | 2 replicas as of R12, `/actuator/health` healthcheck (live-checked) |
| `MachineStateService` | |
| `PaymentManagementService` | |
| `spring-bot-manager-only` | |
| `reporting-bff` | |
| `smart-laundry-dashboard` | |
| `BotManagerService` | not fronted by `api-gateway` — deliberately standalone rather than a module of `spring-bot-manager-only`, per `architecture-review/05-API-GATEWAY-DESIGN.md` (its own README doesn't cover this) |
| Redis | in-project managed Redis instance backing §2 above |

**Config-as-code note:** `MachineStateService` and `BotManagerService` each have a
committed `railway.toml`; `api-gateway` does not (configured entirely via dashboard —
see R12's PR for why: Railway's config-as-code is deprecated platform-wide as of
2026-08-28 for services that never opted in, and `api-gateway` hadn't). Treat
`railway.toml` as legacy-but-working, not the primary path going forward, for
*current* Railway guidance.

### Recreate steps

1. Create a Railway project, link the GitHub repo (`GustaveDjoutsop/smart-laundry-platform`).
2. Per service: set root directory (monorepo — e.g. `/api-gateway`), confirm
   `Dockerfile` builder is picked up, set the `production` branch to `master`.
3. Re-add every service's environment variables — cross-reference each service's
   `application.yml`/`.yaml` `${VAR:default}` placeholders for the full list; secret
   values themselves live in Doppler (§7) or must be re-obtained from each upstream
   provider (Auth0, Supabase, Redis Cloud, CamPay/MTN/Orange, WhatsApp, Sentry,
   Grafana Cloud, Stripe).
4. Re-provision the managed Redis instance, or point `REDIS_URL` at an external one.
5. Re-set healthcheck path (`/actuator/health` for the Java services) and replica
   count per service — none of this is currently captured as config-as-code except
   where a `railway.toml` exists (see above).

---

## 5. Grafana Cloud

Referenced via `GRAFANA_CLOUD_PROMETHEUS_URL` / `GRAFANA_CLOUD_USERNAME` /
`GRAFANA_CLOUD_API_KEY` (Prometheus `remote_write` target,
`monitoring/prometheus/prometheus.yml`) and `GRAFANA_OTLP_BASIC_AUTH` (OTLP trace
export, every Java service's `management.otlp.tracing` block) plus
`loki-logback-appender` (structured log shipping, `spring-bot-manager-only`,
`PaymentManagementService`, `MachineStateService`). Together this is Grafana Cloud's
combined Mimir (metrics)/Loki (logs)/Tempo (traces) stack under one API key. Stack
name, org slug, and exact plan tier are **not verified live** in this pass —
cross-check against the Grafana Cloud portal.

### Recreate steps

1. Create a Grafana Cloud stack (the free tier's included quota has historically been
   enough at this scale — confirm current limits before assuming that still holds).
2. Generate a Cloud Access Policy token scoped to metrics `write` + logs `write` +
   traces `write`.
3. Set `GRAFANA_CLOUD_PROMETHEUS_URL`/`_USERNAME`/`_API_KEY` and
   `GRAFANA_OTLP_BASIC_AUTH` (base64 `instanceId:token`) across the services listed
   above.
4. Re-import/rebuild dashboards — none are currently checked into this repo as
   provisioned-as-code; `monitoring/prometheus/alerts.yml` is the alerting-rules
   source of truth and *is* version-controlled, but Grafana dashboard JSON is not.
5. Note the coverage gap already surfaced during R12: `monitoring/prometheus/*.yml`
   currently only scrapes `host.docker.internal` (local/dev) targets — the alerting
   rules in this repo don't yet monitor the actual Railway-hosted services in
   production. Wiring that up is unfinished work, not part of this recreate procedure.

---

## 6. Cloudflare

**Account:** hash `b5ca359f32147b7731881dcc227e0bda` (live-checked, R11).

| Resource | Status | Purpose |
|---|---|---|
| R2 bucket | provisioned (R2 roadmap item) | Postgres backup dumps (`scripts/backup-databases.sh`) **and** reused as the target for R13 item 4's invoice-PDF object storage, once that's built |
| Workers ("smart-laundry-platform") | placeholder only (R11) | Free tier, not routed to any domain — exists so the Git-integration build check passes; no real functionality yet |
| DNS / CDN proxying | **not set up** | R10 item 1 — flagged there as needing DNS registrar + Cloudflare account access; still open |

### Recreate steps (R2 bucket)

1. Cloudflare dashboard → R2 → create bucket, free tier (10 GB free, no egress fees).
2. Generate an R2 API token (Account API token, object read/write scoped to the
   bucket), yielding `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`.
3. Set those plus `R2_BUCKET` via Doppler/GitHub Actions secrets (consumed by
   `scripts/backup-databases.sh` in the `backup-databases.yml` / `restore-drill.yml`
   workflows).
4. Apply the lifecycle rule via `scripts/apply-r2-lifecycle.sh` (7 daily + 4 weekly +
   3 monthly retention, per R2's spec).

### Recreate steps (Workers placeholder)

1. `wrangler.jsonc` + `src/index.ts` are committed at the repo root (R11) — `npx
   wrangler versions upload` from the repo root reproduces it.
2. Reconnect the Git integration in the Cloudflare dashboard (Workers & Pages →
   the service → Settings → Builds) if it's ever disconnected; root directory `/`,
   deploy command `npx wrangler versions upload`.

---

## 7. Doppler

Doppler covers **three** of the platform's services for local-dev secrets; it does
**not** cover `api-gateway`, `reporting-bff`, `smart-laundry-dashboard`, or
`BotManagerService` — those rely entirely on Railway's own dashboard-managed
environment variables (confirmed by the absence of a `doppler.yaml` in any of the
four).

| Doppler project | Repo/service | Configs |
|---|---|---|
| `payment-management-service` | PaymentManagementService | `dev`, `ci`, `tst`/`stg` — no `prd` yet (no `smartlaundry-prod` to point at) |
| `machine-state-service` | MachineStateService | same pattern |
| `spring-bot-manager` | spring-bot-manager-only | same pattern |

`architecture-review/04-SECRETS-MANAGEMENT.md` (dated 2026-06-13) describes rollout
against a "prod K8s" target — **stale**, superseded by the Railway-only deployment
reality (see `CLAUDE.md`'s Deployment Reality section). Read it for the *secrets
inventory* (which env vars each service needs), not for the *how it's deployed* part.

### Recreate steps

1. `doppler login`; per repo, `doppler setup` → matching project → `dev` config.
   `MachineStateService/doppler.yaml` and `spring-bot-manager-only/doppler.yaml`
   already declare their project, so `doppler setup` picks it automatically;
   `PaymentManagementService` has no committed `doppler.yaml` in this checkout, so
   its project (`payment-management-service`, per the table above) has to be
   selected manually the first time.
2. Populate each config's secrets — full variable-name inventory in
   `04-SECRETS-MANAGEMENT.md` §2 (still accurate for *which secrets exist*, just not
   for *how they reach prod*).
3. Doppler → GitHub Actions integration, per repo, `ci` config, so CI pulls secrets
   automatically into `${{ secrets.* }}`.
4. Production secrets for the Doppler-wired services still go through Railway's
   dashboard variables today, not a Doppler→Railway sync — set them there directly.

---

## 8. GitHub

- **Repo:** `GustaveDjoutsop/smart-laundry-platform`, `master` is the default/protected
  branch (no direct pushes — see `CLAUDE.md`'s Git workflow section).
- **Actions:** per-service CI workflows (`.github/workflows/*.yml`), path-filtered so
  only a changed service's pipeline runs; `gitleaks` blocking gate (R1); Checkstyle
  blocking gate (R5) on the four pre-R8 Java workflows (MachineStateService,
  PaymentManagementService, spring-bot-manager-only, laundry-contracts) — `api-gateway`
  and `reporting-bff` are also Java but aren't Checkstyle-gated, so six Java services
  exist in total, not four; Dependabot open on `chore(deps)`/`deps-dev` PRs across
  every ecosystem in the repo.
- **GitHub Packages:** hosts `com.smartlaundromat:laundry-contracts` (R8), consumed by
  PMS/MSS/spring-bot-manager-only via a `GITHUB_PACKAGES_TOKEN` baked into each
  service's Dockerfile build stage — **PR-preview Railway environments don't inherit
  variables from `production`**, so this token (and every other secret a PR's changed
  service needs) must be set on each new PR environment individually. Learned the hard
  way across PRs #184/#185 when this wasn't done and the Railway PR-preview deploy
  failed for a missing token.

### Recreate steps

Forking/re-creating the repo itself is out of scope for "infrastructure" in the sense
this doc means — the meaningful recreate step here is **repo settings**: branch
protection on `master`, the required-checks list per workflow, and re-issuing a
`GITHUB_PACKAGES_TOKEN` (classic PAT, `read:packages` scope minimum) for each
consuming service.

---

## 9. Third-party business/provider accounts

These are provisioned in each provider's own portal, not something this repo's infra
can recreate directly — documented here as a directory (what exists, what env var
holds its credentials) rather than a deep provisioning guide, since re-establishing
the actual business relationship (KYC, merchant agreements) isn't a technical step.

| Provider | Used by | Credentials env vars | Notes |
|---|---|---|---|
| **Meta / WhatsApp Business Cloud API** | spring-bot-manager-only (multi-tenant), BotManagerService (multi-tenant) | `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN_<BOTID>`, per-bot `phoneNumberId`/`verifyToken` in each `*.bot.json` | One Meta Business app + phone number per tenant bot; the ToS-accept step Meta requires for a *new* bot has no reachable UI/API automation path as of the last check (confirmed on both a test and a production WABA) — re-verify before assuming a new bot can self-provision without manual dashboard clicking |
| **CamPay** | PaymentManagementService, spring-bot-manager-only (webhook verification) | `CAMPAY_APP_KEY`/`_APP_SECRET`/`_WEBHOOK_SECRET` (PMS), `CAMPAY_TOKEN`/`_WEBHOOK_SECRET` (bot) | Cameroon mobile money |
| **MTN MoMo** | PaymentManagementService | `MTN_SUBSCRIPTION_KEY`/`_API_USER_ID`/`_API_KEY` | |
| **Orange Money** | PaymentManagementService | `ORANGE_CLIENT_ID`/`_CLIENT_SECRET`/`_MERCHANT_KEY` | |
| **Stripe** | BotManagerService (AfroMarket bot only) | not yet inventoried here | A B2B billing module exists in the codebase but no client currently uses it — Stripe is only actually wired up for the AfroMarket bot's own checkout flow |
| **Sentry** | All 3 original Java services + dashboard | `SENTRY_DSN` (backend), `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` (dashboard source maps) | Org/project names not verified live in this pass |
| **MQTT broker** | MachineStateService, spring-bot-manager-only (ESP32 telemetry) | `MQTT_BROKER_URL` / `MQTT_URL` | No managed broker confirmed provisioned — the dev machines this platform controls are currently offline (no live hardware connected), so this may still be `tcp://localhost:1883`-only in practice. Production requirement per `CLAUDE.md`: `ssl://` + port 8883 + auth. |

---

## Terraform scope (R13 item 2 — tracked separately, not in this doc)

Per the roadmap's explicit call: only the **Auth0 tenant** (applications, the API and
its `sls-*` scopes, roles) and **Cloudflare DNS** get Terraform — both have real drift
risk and mature providers. Everything else above stays documented-but-manual per item
3's explicit instruction (Supabase/Railway/Redis Cloud providers are "immature and the
setup cost exceeds the benefit for a single environment").

That work needs a live audit of the current Auth0 tenant (§3 above already flags the
M2M application inventory as incomplete) before any Terraform config — and, given
`terraform apply` against already-hand-provisioned resources risks destroy/recreate on
a misconfigured import, a human review of the plan before every apply. Not started in
this pass; see the R13 PR discussion for sequencing.
