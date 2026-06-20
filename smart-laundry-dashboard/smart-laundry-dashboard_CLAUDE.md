# smart-laundry-dashboard

## What This Is
Operator-facing web UI (revenue, machines, reports, HR) for Smart Laundry &
Cafe Lounge. Next.js 14 / React / TypeScript / Tailwind, Recharts, axios,
socket.io-client. Port 3000.

## 🔴 Critical — this is the W1/W2/W9 epicenter (P5/P6 fix this)
- **This dashboard does NOT talk to `spring-bot-manager-only`,
  `PaymentManagementService`, or `MachineStateService`.** Its single
  `NEXT_PUBLIC_API_URL` points at the **legacy `SmartLaundromatControlSystem`
  Node/Express/MongoDB monolith on Heroku** — `/admin/*`, `/auth/login`,
  `/users`, `/timekeeping`, `/absences`, Mongo `_id`/`pages` conventions.
- **This is being fixed, not ignored** — see root `CLAUDE.md` and
  `architecture-review/03-MIGRATION-TODO.md`:
  - **P5** builds a Reporting BFF aggregating the 3 services' data (via SQL
    queries/views against the consolidated Supabase `payment`/`machine`/
    `bot` schemas) and reaches parity with the legacy monolith's reports.
  - **P6** repoints `NEXT_PUBLIC_API_URL` at the API Gateway (not legacy),
    unifies `src/services/api.ts`/`src/lib/api.ts` into one client, adopts
    Auth0 OIDC/PKCE (replacing localStorage JWT), and moves real-time
    (socket.io) behind the gateway.
  - Legacy-only domains (timekeeping, absences, feedback, expenses,
    reconciliation) move to a new `OperationsService` (`ops_db`) or get
    retired — decided per-feature in P5.
- **Until P6 lands**: if asked to "show payment X" or "display machine Y's
  status" and that data only exists in `paymentdb`/`machinedb` (pre-Mongo)
  or `payment_db`/`machine_db` (post-P3), **it is not reachable from this
  codebase as currently wired**. Don't fake it with mock data — say which
  phase (P5/P6) the feature depends on.
- **Auth is separate from the rest of the platform** (until P6). localStorage
  bearer token + custom `/auth/login` against the legacy system — not Auth0.
- **Two divergent API client files exist**: `src/services/api.ts` and
  `src/lib/api.ts` — P6 unifies these. **Before editing either now, grep for
  which one is actually imported** by the component/page you're touching —
  editing the unused one silently does nothing. Don't start the P6
  unification piecemeal unless that's explicitly the task; half-unifying
  creates a third divergent state.

## Tech Stack
- Next.js 14 (App Router), React, TypeScript, Tailwind CSS
- Recharts for charts/visualizations
- axios for HTTP, socket.io-client for real-time (verify what it actually
  connects to — likely the legacy backend's socket layer if any)

## Working Here — Practical Rules
- Before adding a new API call, check both `src/services/api.ts` and
  `src/lib/api.ts` for an existing equivalent — duplication here is already
  a known problem (W9), don't add a third version.
- If a feature requires data that only exists in the new Spring services,
  say so explicitly rather than silently building against the legacy API
  and hoping it has equivalent data — it likely doesn't (split-brain, W1).
- `NEXT_PUBLIC_API_URL` and the legacy Heroku host are the actual runtime
  dependency for *everything* this app shows. If that's down or
  misconfigured, nothing in this dashboard works, regardless of how healthy
  the 3 new Spring services are.
