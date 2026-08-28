# Error Tracking Runbook (R7)

**Status:** Code shipped; Sentry account/projects/DSNs not yet provisioned — see §2
**Owner:** @GustaveDjoutsop
**Related:** [`monitoring/README.md`](../monitoring/README.md) (Prometheus + Grafana Cloud alerting), `Implementation Roadmap — 13 Audit Recommendations.md` (R7)

---

## 1. What this PR ships

- `sentry-spring-boot-starter-jakarta` 8.16.0 in PaymentManagementService, MachineStateService, and spring-bot-manager-only (declared in `bot-core`, so `bot-app`'s Spring context picks it up).
- `@sentry/nextjs` 10.71.0 in `smart-laundry-dashboard` — App Router instrumentation (`src/instrumentation.ts`, `src/instrumentation-client.ts`, `src/sentry.server.config.ts`, `src/sentry.edge.config.ts`, `src/app/global-error.tsx`), and `next.config.js` wrapped with `withSentryConfig` for build-time source map upload.
- `SentryCorrelationIdEventProcessor` in each of the three Spring services — tags every Sentry event with the request's `X-Correlation-Id`, reading the same MDC key `CorrelationIdFilter` already populates. A Sentry issue now links straight to the matching structured log lines instead of needing a separate correlation step.
- Every DSN defaults to empty/unset. An empty DSN is a documented Sentry SDK no-op, so local dev and CI boots stay completely silent until `SENTRY_DSN` is actually set.
- `environment` and `release` are wired via env vars (`SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` / `NEXT_PUBLIC_SENTRY_RELEASE`) — no values are baked into the repo.
- No `traces-sample-rate` is set anywhere (Java: unset; Next.js: `0`). This ships error capture only, matching R7's scope — not full APM — to stay comfortably inside Sentry's free tier (5k errors/month) across four projects.

## 2. What still needs manual setup

I can't sign up for a third-party account or click through the Sentry/Railway dashboards on your behalf — this is the same shape as the CamPay/Auth0/Grafana Cloud credentials already in this repo's Doppler projects.

1. **Create a Sentry org** (if you don't have one) and **one project per service**, platform = Java Spring Boot for the three backend services, Next.js for the dashboard:
   - `payment-management-service`
   - `machine-state-service`
   - `spring-bot-manager`
   - `smart-laundry-dashboard`
2. **Copy each project's DSN into Doppler**, following the existing per-service Doppler project convention:
   - PMS / MSS / spring-bot-manager: `SENTRY_DSN`
   - `smart-laundry-dashboard`: both `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` (same value — a Sentry DSN is not a secret, the `NEXT_PUBLIC_` copy just controls what Next.js inlines into the browser bundle).
3. **Set `SENTRY_ENVIRONMENT=production`** in each service's production Doppler config / Railway variables. It defaults to `development` otherwise, so nothing breaks if this step is skipped — events would just be mislabeled.
4. **Set `SENTRY_RELEASE`** to the deployed git commit SHA, so Sentry can attribute regressions to a specific deploy:
   - Railway exposes `RAILWAY_GIT_COMMIT_SHA` automatically. Map it via a Railway service variable reference (`SENTRY_RELEASE=${{RAILWAY_GIT_COMMIT_SHA}}`) in each of the four services' Railway variable settings.
5. **Source map upload (dashboard only)** needs three more variables at **build time** (CI, not runtime): `SENTRY_ORG`, `SENTRY_PROJECT=smart-laundry-dashboard`, and `SENTRY_AUTH_TOKEN` — a scoped Sentry auth token (Sentry → Settings → Auth Tokens, needs `project:releases` scope). Treat `SENTRY_AUTH_TOKEN` as a real secret; it is not a DSN.
6. **Alert routing (R7 item 5 — route Sentry alerts to the same place as Prometheus alerts):** blocked on a prior gap, not a new one — `monitoring/README.md`'s Grafana Cloud alerting has no configured Slack/email contact point beyond Grafana's default yet (see that doc's Alert rules section). Once you decide where Prometheus alerts should land, add the same destination as a Sentry Alert Rule per project (Sentry → Project → Alerts). I can wire the actual notification-channel config once you tell me what it should be — Slack webhook, email, or something else.

## 3. Verification once DSNs are set

- Hit a route that throws (or add a temporary `throw new RuntimeException("sentry test")` behind a feature flag) in a non-production environment and confirm the event lands in the matching Sentry project.
- Confirm the event's tags include `correlationId`, and that grepping that value in the service's logs finds the matching request.
- In the dashboard, trigger a client-side error and confirm the stack trace resolves to real `.tsx` source, not a minified bundle (proves source map upload worked).

## 4. Cost

Sentry's free tier (5k errors/month) is expected to be sufficient at current volume. Self-hosted GlitchTip is the zero-cost fallback if that ceiling is ever hit — see the roadmap's R7 entry.
