# smartlaundry-infra

Cross-cutting infrastructure for the SmartLaundromat / Smart Bot Platform
migration (see `architecture-review/` in the main workspace for the full
plan). This repo holds artifacts that don't belong to a single service:
Supabase schema/role provisioning, shared SQL migrations, and (later)
Outbox/event-relay config.

## Contents

- `supabase/migrations/` — SQL migrations applied directly via the Supabase
  MCP (`apply_migration`) to both the `smartlaundry-dev` and
  `smartlaundry-test` projects. These are the source of truth for the
  schema-per-service layout and table set; re-apply to any new project
  (e.g. `smartlaundry-prod` once created) to reproduce the same structure.
- `docs/connections.md` — Supavisor pooler connection strings and the
  per-service Doppler wiring (no secrets committed).

## Supabase projects

| Project | Ref | Region | Plan | Purpose |
|---|---|---|---|---|
| `smartlaundry-dev` | `mmkxlwzmeercsncsseie` | eu-central-1 | Free | DEV environment — schema-per-service |
| `smartlaundry-test` (formerly provisioned as `smartlaundry-prod` / "GustaveDjoutsop's Project") | `sqbbircvgydrohhbypcd` | eu-central-1 | Free | TEST environment — schema-per-service |
| `smartlaundry-prod` | *not yet created* | — | — | PROD environment — **deferred/skipped for now** |

### TEST project — repurposed (2026-06-15)

The org's free tier caps active free projects at 2 per admin, which blocked
creating a third project for TEST. `sqbbircvgydrohhbypcd` (originally
provisioned as `smartlaundry-prod`) was renamed and repurposed as
`smartlaundry-test` instead — it already has the P2 schema/role migration
applied, so no re-provisioning was needed.

**PROD is skipped for now.** A dedicated `smartlaundry-prod` project doesn't
exist. Creating one later will likely require a Pro-plan org upgrade (to get
past the 2-project free cap) — track alongside the PITR/backups item below.

## Schema-per-service layout

`smartlaundry-dev` and `smartlaundry-test` both have identical `bot` /
`payment` / `machine` / `ops` schemas, each with a dedicated least-privilege
login role (`bot_svc`, `payment_svc`, `machine_svc`, `ops_svc`) granted
`USAGE`/`CREATE` only on its own schema, with `search_path` defaulted to that
schema and `REVOKE ALL ... FROM PUBLIC` on each schema to prevent
cross-service access. Both currently have the schemas/roles provisioned but
**zero tables** — actual tables land via each service's Flyway migrations as
part of the P3 consolidation (in progress on the `feature/p3-*-supabase-consolidation`
branches).

`ops` / `ops_svc` is provisioned now but unused until the Phase 5
`OperationsService` exists.

### Tables provisioned (2026-06-15)

Both `smartlaundry-dev` and `smartlaundry-test` now have the full table set
for `bot`, `payment`, and `machine`, applied directly from each service's
Phase 3 Flyway baseline migrations (`feature/p3-*-supabase-consolidation`
branches):

- **`bot`**: `businesses` (seeded with `laundry`/`thomasnetwork` configs per
  V4/V5), `messages`, `payments`, `pharmacy_products`,
  `pharmacy_reservations` — V1-V5.
- **`payment`**: `transactions`, `rfid_cards`, `topup_transactions`,
  `outbox`, `idempotency_keys` — V1-V2.
- **`machine`**: `machines`, `machine_cycles`, `machine_events`,
  `reservations` — V1.

Each schema also has a `flyway_schema_history` table pre-seeded with a
`BASELINE` row (bot@V5, payment@V2, machine@V1), so each service's own Flyway
run won't try to recreate these objects on first connect — see
`architecture-review/03-MIGRATION-TODO.md` Phase 3.

This is schema/seed-data only; real production data (live `transactions`,
`machines`, the 204-row bot `messages` history, etc.) is migrated during the
per-service cutover, not yet done.

## Open items (see `architecture-review/03-MIGRATION-TODO.md` Phase 2)

- **`smartlaundry-prod` project** — deferred. Create once the org is past the
  2-project free-tier cap (Pro-plan upgrade), then apply the P2 migration and
  wire it into the PROD environment config.
- **Doppler secrets for DEV/TEST** — `doppler secrets set` commands with the
  generated role passwords (shared with the operator out-of-band) still need
  to be run for the `dev` and `tst` configs of each service.
- **PITR / daily backups** require the Supabase org to be on the Pro plan
  ($25/mo). Currently on Free — deferred pending a manual billing decision.
- **Network restrictions (IP allow-list)** are also a Pro-plan feature —
  deferred alongside the above.
- **SSL enforcement**: Supabase enforces TLS on all connections by default;
  verify "Enforce SSL on incoming connections" is on in each project's
  Settings → Database (dashboard-only, not exposed via the MCP tools used
  here).
