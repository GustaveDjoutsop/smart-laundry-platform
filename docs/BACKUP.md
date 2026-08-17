# Database Backups

**Recovery point objective (RPO): 24 hours.** **Recovery time objective (RTO): not yet measured** — that is established by the restore drill (`scripts/restore-drill.sh`, quarterly via `.github/workflows/restore-drill.yml`), whose measurements belong in [`docs/DISASTER-RECOVERY.md`](./DISASTER-RECOVERY.md) §2. Until a drill has run against real production backups the RTO number is unknown rather than optimistic.

Related: [`docs/SECRET-ROTATION.md`](./SECRET-ROTATION.md) · [`docs/DISASTER-RECOVERY.md`](./DISASTER-RECOVERY.md)

---

## 1. What this covers, and what it does not

| | |
|---|---|
| **What is backed up** | Logical `pg_dump` archives of `smartbot`, `machinedb` and `paymentdb` |
| **How often** | Nightly at 02:30 UTC (03:30 Berlin, 03:30 WAT) |
| **Where** | Cloudflare R2 bucket `smart-laundry-backups` |
| **Retention** | 7 daily, 4 weekly, 3 monthly — enforced by bucket lifecycle rules |
| **Cost** | Zero at current data volumes: R2 gives 10 GB free with no egress fees, and GitHub Actions scheduled runs are free on this repository |
| **Not covered** | Object storage contents, Doppler secrets, Auth0 tenant configuration, Grafana dashboards. Each is recreatable, but the recreation steps belong in [`docs/DISASTER-RECOVERY.md`](./DISASTER-RECOVERY.md) §1 |

### Why not Supabase PITR

`smartlaundry-infra/README.md` notes that point-in-time recovery and daily managed backups require the Supabase **Pro** plan. That is the better product — PITR gives an RPO measured in minutes rather than a day. It is deliberately deferred because:

- A 24-hour RPO for a laundromat kiosk business means at worst one day of cycle and payment records need reconstructing from CamPay's own transaction history, which is itself an independent record.
- Paying for PITR before ever testing a restore would be buying reassurance rather than recovery. R3 establishes whether restores actually work first.

**When to upgrade:** once transaction volume makes a lost day materially expensive, or once a regulator or partner requires a tighter RPO. Revisit after R3.

## 2. Design decisions worth knowing

**Every dump is verified before it is uploaded.** `pg_dump` can exit 0 and still write a truncated archive if the connection drops mid-stream. The script runs `pg_restore --list` on each archive and requires a readable table of contents with at least five entries, and rejects any dump smaller than 5 KB. An unverified backup is not a backup.

**Retention is enforced by the bucket, not by the backup script.** The script only ever writes; deletion is left to R2 lifecycle rules ([`scripts/r2-lifecycle.json`](../scripts/r2-lifecycle.json)). This means the CI credential needs **write permission only** — a compromised GitHub Actions token cannot erase backup history, which is precisely the scenario backups exist to survive. It also means expiry keeps working even if the backup workflow itself is broken.

**Retention tiers are prefixes, not separate dumps.** A run on a Sunday copies the same archive into `daily/` and `weekly/`; a run on the 1st also copies it into `monthly/`. One `pg_dump` per database per night regardless.

**`--format=custom`, not plain SQL.** Allows selective restore of individual tables during an incident, and compresses internally.

**A SHA-256 sidecar accompanies every dump.** The restore drill can then prove the bytes it downloaded are the bytes that were written.

## 3. Bucket layout

```
smart-laundry-backups/
  daily/2026-08-13/smartbot-2026-08-13T023014Z.dump
  daily/2026-08-13/smartbot-2026-08-13T023014Z.dump.sha256
  daily/2026-08-13/machinedb-…
  daily/2026-08-13/paymentdb-…
  weekly/2026-08-16/…      # Sundays
  monthly/2026-09-01/…     # 1st of each month
  restore-drill/…          # R3 scratch space, expires after 3 days
  status/last-success.json # heartbeat, overwritten on every successful run
```

## 4. One-time setup

Nothing runs until the bucket and secrets exist. Roughly fifteen minutes.

### 4.1 Create the R2 bucket

1. Open the [Cloudflare dashboard](https://dash.cloudflare.com/) → **R2 Object Storage**.
2. If prompted to onboard R2, note that Cloudflare may ask for a payment method even for the free tier. The 10 GB free allowance still applies.
3. **Create bucket** → name it exactly `smart-laundry-backups`.
4. Location: choose an EU hint if offered. Storage class: **Standard** (not Infrequent Access — restores from IA cost more, and a restore is exactly when you do not want a surprise).
5. Note the **S3 API endpoint** shown in the bucket's settings. The `<ACCOUNT_ID>` part is your `R2_ACCOUNT_ID`.

> **The jurisdiction changes the hostname.** A bucket created with an EU jurisdiction is reachable *only* at `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`, and requests to the generic `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` fail as though the bucket does not exist ([Cloudflare: data location](https://developers.cloudflare.com/r2/reference/data-location/)). That failure mode is misleading — it looks like a wrong bucket name, not a wrong host.
>
> This project's bucket **is** in the EU jurisdiction, so set `R2_JURISDICTION=eu` wherever the scripts run. The jurisdiction cannot be changed after the bucket is created.

### 4.2 Create a scoped API token

**Create this token yourself and paste it straight into GitHub Secrets. Do not send it through any chat, issue, or commit.** The whole point of R1 was that credentials leak through convenience.

1. R2 → **Manage API tokens** → **Create API token**.
2. Permission: **Object Read & Write** — *not* Admin.
3. Scope it to the single bucket `smart-laundry-backups`.
4. Leave the TTL as long-lived, or set a calendar reminder to rotate it if you choose an expiry.
5. Copy the **Access Key ID** and **Secret Access Key**. The secret is shown once.

Read-and-write rather than admin is deliberate: this token cannot delete objects or change lifecycle rules, so retention and history survive a compromise of CI.

### 4.3 Add GitHub Actions secrets

Repository → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `R2_ACCOUNT_ID` | account ID from the S3 endpoint URL |
| `R2_ACCESS_KEY_ID` | from the R2 token |
| `R2_SECRET_ACCESS_KEY` | from the R2 token |
| `R2_BUCKET` | `smart-laundry-backups` |
| `DATABASE_URL_SMARTBOT` | `postgresql://user:pass@host:5432/smartbot?sslmode=require` |
| `DATABASE_URL_MACHINEDB` | connection URL for `machinedb` |
| `DATABASE_URL_PAYMENTDB` | connection URL for `paymentdb` |

Also add one repository **variable** (Settings → Secrets and variables → Actions → *Variables* tab), not a secret, since it is not sensitive:

| Variable | Value |
|---|---|
| `R2_JURISDICTION` | `eu` |

The workflows default to `eu` if it is absent, so this is belt and braces rather than strictly required. Set it to `default` if you ever move to a non-jurisdictional bucket.

Use a **read-only** database role for the dumps if one exists; `pg_dump` needs no write access. Mirror the same values into Doppler so the scripts can be run locally.

### 4.4 Apply the lifecycle rules

Without this step, nothing is ever deleted and the free 10 GB fills up eventually.

```bash
export R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=smart-laundry-backups
export R2_JURISDICTION=eu
./scripts/apply-r2-lifecycle.sh
./scripts/apply-r2-lifecycle.sh --show   # confirm
```

The lifecycle-configuration API needs admin permission, so run this once with an Admin token (or via the dashboard UI), then keep only the scoped read-write token in CI.

### 4.5 First run

Trigger **Actions → Nightly Database Backups → Run workflow** with `dry_run: true` first. That dumps and verifies without uploading, which separates "can we reach the databases" from "can we write to R2". Then run it again with `dry_run: false`.

## 5. Running it manually

```bash
# Dump and verify, no upload, no credentials needed
./scripts/backup-databases.sh --dry-run

# Full run
./scripts/backup-databases.sh

# Single database
./scripts/backup-databases.sh --db paymentdb
```

Prefer `doppler run -- ./scripts/backup-databases.sh` over exporting connection strings into your shell.

## 6. Verifying backups are actually happening

Do not trust a green checkmark alone — check that objects exist.

```bash
export AWS_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY AWS_DEFAULT_REGION=auto
ENDPOINT=https://$R2_ACCOUNT_ID.eu.r2.cloudflarestorage.com   # .eu. because the bucket is EU-jurisdiction

# Last few days of dumps
aws s3 ls --endpoint-url $ENDPOINT s3://smart-laundry-backups/daily/ --recursive | tail -20

# Heartbeat
aws s3 cp --endpoint-url $ENDPOINT s3://smart-laundry-backups/status/last-success.json -
```

Expect three `.dump` files plus three `.sha256` files per day. **Two files instead of three means one database is silently not being backed up** — most likely a missing `DATABASE_URL_*` secret, which the script reports as `SKIPPED` rather than failing the run.

## 7. When a backup fails

The workflow opens a GitHub issue labelled `backup-failure` on a scheduled failure, and comments on the existing issue rather than opening a new one every night. Causes in rough order of likelihood:

| Symptom | Likely cause | Fix |
|---|---|---|
| `pg_dump error` | Database credentials rotated, or the host is unreachable | Update the `DATABASE_URL_*` secret; cross-check `docs/SECRET-ROTATION.md` |
| `AccessDenied` on upload | R2 token expired, or scoped to the wrong bucket | Reissue the token with Object Read & Write on `smart-laundry-backups` |
| `server version mismatch` | Server upgraded past the pinned client | Bump `postgresql-client-17` in the workflow |
| `integrity check failed` | Truncated archive — a genuine signal, not a workflow bug | Re-run manually; if it repeats, investigate the database itself |
| `dump too small` | Pointing at an empty or wrong database | Check the connection string names the right database |
| Run simply did not happen | GitHub disables scheduled workflows after 60 days of repository inactivity | Re-enable in the Actions tab; the heartbeat file is how you notice |

That last row is a real trap for a repository that goes quiet. The heartbeat in `status/last-success.json` is the thing to alert on, because a workflow that never ran produces no failure notification at all.

## 8. Testing the scripts

```bash
./scripts/test/backup-databases.test.sh
```

Runs the backup script against stubbed `pg_dump`, `pg_restore` and `aws` binaries. Covers the integrity gate, the too-small-dump guard, upload retries, preflight validation, retention-tier promotion on Sundays and month starts, the all-databases-skipped case, and that database passwords never reach the log. 34 assertions, no server or credentials required.

What these tests do **not** prove: that `pg_dump` can reach Supabase, or that the R2 credentials work. Only a real run proves that, and only R3 proves the dumps can be restored.

## 9. Next step

**A backup you have never restored is a hypothesis.** R3 adds `scripts/restore-drill.sh` and `docs/DISASTER-RECOVERY.md`, which restore the latest dump into a scratch database, assert row counts and Flyway schema version, and record a measured RTO. Do not consider this recommendation finished until that drill has passed once.
