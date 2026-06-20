# Connection strings (Supavisor pooler)

Supabase fronts Postgres with **Supavisor**. Use the pooler host for all
application connections (Spring `spring.datasource.url`); reserve the direct
`db.<ref>.supabase.co:5432` host for migrations/admin only.

Pooler host format for `eu-central-1`: `aws-0-eu-central-1.pooler.supabase.com`
(verify exact hostname per project via Dashboard → Connect, it can vary).

| Mode | Port | Use for |
|---|---|---|
| Transaction | 6543 | App runtime (Hibernate/HikariCP) — set `prepareThreshold=0` / `pgbouncer=true` in JDBC params, no session-level features (advisory locks, prepared statements, `SET` outside the txn) |
| Session | 5432 | Flyway migrations (needs session-level `SET`/locks) |

JDBC URL pattern (transaction mode, per service):

```
jdbc:postgresql://aws-0-eu-central-1.pooler.supabase.com:6543/postgres?user=<role>.<project_ref>&prepareThreshold=0&currentSchema=<schema>
```

## Per-project / per-service mapping

### smartlaundry-dev — `mmkxlwzmeercsncsseie`

| Service | Role | Schema | Doppler project |
|---|---|---|---|
| spring-bot-manager-only | `bot_svc` | `bot` | `spring-bot-manager` (config `dev`) |
| PaymentManagementService | `payment_svc` | `payment` | `payment-management-service` (config `dev`) |
| MachineStateService | `machine_svc` | `machine` | `machine-state-service` (config `dev`) |
| reporting-bff | `reporting_svc` | `ops` (Flyway) + cross-schema SELECT on payment/machine/bot | `reporting-bff` (config `dev`) |
| *(future)* OperationsService | `ops_svc` | `ops` | not yet created |

Dashboard: https://mmkxlwzmeercsncsseie.supabase.co

### smartlaundry-test — `sqbbircvgydrohhbypcd`

Same role/schema layout (originally provisioned as `smartlaundry-prod`,
repurposed as TEST on 2026-06-15 due to the org's 2-project free-tier cap —
see `README.md`). Use the `tst`/`stg` Doppler configs of each project.
Dashboard: https://sqbbircvgydrohhbypcd.supabase.co

| Service | Role | Schema | Doppler project |
|---|---|---|---|
| spring-bot-manager-only | `bot_svc` | `bot` | `spring-bot-manager` (config `tst`) |
| PaymentManagementService | `payment_svc` | `payment` | `payment-management-service` (config `tst`) |
| MachineStateService | `machine_svc` | `machine` | `machine-state-service` (config `tst`) |
| reporting-bff | `reporting_svc` | `ops` + cross-schema SELECT | `reporting-bff` (config `stg`) |
| *(future)* OperationsService | `ops_svc` | `ops` | not yet created |

### smartlaundry-prod — *not yet created*

Deferred (see `README.md` open items). When created, mirror the same
migration, role/schema layout, and add its mapping here under a `prd`
Doppler config per service.

## Setting secrets

Role passwords were generated once during provisioning and are **not stored
in this repo**. Set them via Doppler (already configured per `04-SECRETS-MANAGEMENT.md`):

```sh
# example for PaymentManagementService, tst config (smartlaundry-test)
doppler secrets set SPRING_DATASOURCE_URL \
  "jdbc:postgresql://aws-0-eu-central-1.pooler.supabase.com:6543/postgres?user=payment_svc.sqbbircvgydrohhbypcd&prepareThreshold=0&currentSchema=payment" \
  --project payment-management-service --config tst

doppler secrets set SPRING_DATASOURCE_PASSWORD "<payment_svc password>" \
  --project payment-management-service --config tst

# repeat for dev config against smartlaundry-dev / project ref mmkxlwzmeercsncsseie
# prod config will be added once smartlaundry-prod is created
```

Repeat for `spring-bot-manager` (`bot_svc`) and `machine-state-service`
(`machine_svc`), using each service's own role/schema/Doppler project.

The four generated passwords were shared with the operator (Gustave) once at
provisioning time, out of band — rotate via `ALTER ROLE ... WITH PASSWORD`
(execute_sql, not a migration) if they need to change.
