# Disaster Recovery

How to get the Smart Laundry platform running again after something breaks
badly. Written to be usable at 03:00 by one tired person, which is the realistic
operating assumption for this project.

Companion documents:

- [`docs/BACKUP.md`](./BACKUP.md) — how backups are produced and stored
- [`docs/SECRET-ROTATION.md`](./SECRET-ROTATION.md) — credential rotation

---

## 0. First 5 minutes

Do these in order. Resist the urge to start fixing before you know what broke.

1. **Is it actually down, or is it slow?** Check the gateway health endpoint
   first — it is the front door and depends on nothing else being healthy:

   ```bash
   curl -fsS -m 10 "$GATEWAY_URL/actuator/health" | python3 -m json.tool
   ```

2. **Is it us or a provider?** Open the status pages in §7 before debugging code.
   A CamPay or Auth0 outage looks exactly like a bug in our payment or login path.

3. **Is customer money involved?** If payments are being taken but machines are
   not starting, go to §5.3 immediately. That is the only failure mode here that
   costs customers money in real time, and it is recoverable.

4. **Write down the time you noticed.** You will need it to work out how much
   data is at risk (see §2) and, if you restore, which backup to use.

5. **Do not delete or reinitialise anything yet.** Most data loss in incidents
   like this is caused by the recovery attempt, not the original fault.

---

## 1. What is protected, and what is not

| Asset | Protection | Worst-case loss |
|---|---|---|
| `paymentdb`, `machinedb`, `smartbot` (Postgres) | Nightly logical dumps to Cloudflare R2, GFS retention | Up to 24 h of writes |
| Secrets / config | Doppler (own history and restore) | None expected |
| Application code | GitHub, plus every developer clone | None expected |
| MongoDB (bot conversation state) | **Not backed up** | All of it |
| Prometheus metrics | **Not backed up** (Grafana Cloud retention only) | Historical dashboards |
| Uploaded invoices / documents | Whatever the store does today; see R13 | Unclear — a known gap |

The last three rows are deliberate, cost-driven decisions, not oversights. They
are recorded in `ARCHITECTURE_TODO.md`. Do not discover them during an incident:
if MongoDB is lost, bot conversations restart from scratch, and that is the
accepted design.

---

## 2. RPO and RTO

**RPO (Recovery Point Objective) — how much data we can lose: 24 hours.**

This one is a real commitment, not an estimate. Backups run at 02:30 UTC daily
(`.github/workflows/backup-databases.yml`), so the worst case is a failure at
02:29 UTC, losing almost a full day of payments and machine cycles. Reducing it
requires Supabase Pro point-in-time recovery, deliberately deferred on cost
grounds (see `docs/BACKUP.md` §1).

**RTO (Recovery Time Objective) — how long recovery takes: not yet measured.**

> **This table is intentionally empty.** It must be filled in from a real drill
> against real production-sized data, by running the quarterly
> `Restore Drill` workflow or `scripts/restore-drill.sh` manually. Numbers
> produced in a development sandbox were discarded as meaningless: the same
> restore of the same 700k-row archive varied between 2 s and 23 s on shared
> CPU, and the archive itself was far smaller than production will be.
>
> Publishing a made-up RTO is worse than publishing none, because someone will
> plan around it.

| Database | Archive size | Restore time | Full recovery (incl. redeploy) | Date measured |
|---|---|---|---|---|
| `paymentdb` | | | | |
| `machinedb` | | | | |
| `smartbot` | | | | |

Fill this in from the drill's step summary or from
`drill-records/<db>-<date>.json`. Re-measure at least yearly, and after any
significant growth in `payments` or `outbox_event`.

Rough expectation until measured: restore is usually minutes, and the dominant
cost is the human steps around it — deciding to restore, locating credentials,
repointing services, verifying. Budget for hours end to end, not minutes.

---

## 3. Restoring a database

### 3.1 Drill first, if there is any doubt

If you are not certain the backups are good, restore into a scratch database
before touching anything real. This is exactly what the drill script does, and
it refuses to write to production:

```bash
export DRILL_TARGET_URL='postgresql://postgres:pw@localhost:5432/drill_scratch'
export R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=...

./scripts/restore-drill.sh --db paymentdb --tier daily --recreate
```

It downloads the newest dump for that tier, checks the SHA-256 against the
sidecar, restores it, then verifies table/index/constraint counts, Flyway
version, row counts and data freshness. Exit code 0 means the archive is good.

### 3.2 Restoring for real

Steps, in order. Do not skip step 1.

**1. Stop writers.** Otherwise you race the restore and end up with a mixture of
old and new data, which is harder to untangle than either alone. Scale the
relevant Railway services to zero, or pause deployments.

**2. Pick the archive.** Prefer the newest daily; step back a day if you suspect
the corruption is older than the last backup.

```bash
aws s3 ls "s3://$R2_BUCKET/daily/" --recursive \
  --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" | sort | tail -20
```

**3. Download it and its checksum, and verify before use.**

```bash
KEY='daily/2026-08-13/paymentdb-2026-08-13T023045Z.dump'
EP="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"
aws s3 cp "s3://$R2_BUCKET/$KEY"        ./restore.dump        --endpoint-url "$EP"
aws s3 cp "s3://$R2_BUCKET/$KEY.sha256" ./restore.dump.sha256 --endpoint-url "$EP"

# Must print OK. If it does not, STOP and use an older archive.
sha256sum -c <<<"$(cut -d' ' -f1 restore.dump.sha256)  restore.dump"
```

**4. Restore into a NEW database, never over the live one.** A new database
keeps the damaged original available for comparison, and makes the cutover a
config change you can revert.

```bash
createdb -h "$PGHOST" -U "$PGUSER" paymentdb_restored_20260813
pg_restore \
  --dbname="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:5432/paymentdb_restored_20260813" \
  --no-owner --no-privileges --jobs=2 --exit-on-error \
  ./restore.dump
```

`--exit-on-error` matters: without it `pg_restore` reports errors and still exits
0, so a partial restore looks like a success.

**5. Verify before cutting over.** At minimum:

```bash
# Schema version. Note flyway_schema_history.version is a VARCHAR, so a plain
# max() sorts '9' above '12'; cast for a correct answer.
psql "$RESTORED_URL" -tAc \
  "SELECT max(version::numeric) FROM flyway_schema_history WHERE success"
psql "$RESTORED_URL" -tAc \
  "SELECT count(*) FROM flyway_schema_history WHERE NOT success"   -- must be 0

# paymentdb data checks. The table is 'transactions', not 'payments'.
psql "$RESTORED_URL" -tAc "SELECT count(*) FROM transactions"
psql "$RESTORED_URL" -tAc "SELECT max(created_at) FROM transactions"

# Unprocessed outbox events. The 'outbox' table has no status column:
# pending means processed_at IS NULL.
psql "$RESTORED_URL" -tAc "SELECT count(*) FROM outbox WHERE processed_at IS NULL"
```

The Flyway version must be at least the minimum the application expects
(`paymentdb` 15, `smartbot` 7, `machinedb` 4 — the current migration heads). If it is lower, the application
will run migrations on startup — acceptable, but expect it and watch the logs.

**6. Repoint the application.** Update `DATABASE_URL` in Doppler for the
affected service, then redeploy. Do not edit the URL only in Railway's UI, or
the next Doppler sync will silently revert it.

**7. Drain the outbox deliberately.** After a `paymentdb` restore there will be
unprocessed rows in `outbox` (`processed_at IS NULL`) representing machine starts
that may or may not have already happened. `OutboxRelayService` will retry them,
which is what you want — the consumer dedupes on the transaction reference via
`idempotency_keys`. Watch the `OutboxPendingHigh` and `OutboxDeadLetter` alerts
and let it work through rather than clearing the table.

Dead-lettered events use a convention rather than a status column
(`V3__outbox_retry_fields.sql`): `processed_at IS NULL AND retry_count >= 5`.

```bash
psql "$RESTORED_URL" -tAc \
  "SELECT count(*) FROM outbox WHERE processed_at IS NULL AND retry_count >= 5"
```

**8. Write down what you did**, including timings, and update §2.

---

## 4. Backups exist but the restore fails

Work through these in order; they are ordered by how likely they are.

| Symptom | Likely cause | Action |
|---|---|---|
| `unsupported version in file header` | `pg_restore` older than the `pg_dump` that wrote it | Install `postgresql-client-17` or newer |
| Checksum mismatch | Corrupt object in the bucket | Use an older archive; treat the newer one as lost |
| `pg_restore` reports errors, exits 0 | Missing `--exit-on-error` | Re-run with it; the first restore was partial |
| Restore succeeds, app fails to start | Flyway version below the app's minimum | Let Flyway migrate; check for failed migrations |
| `role "..." does not exist` | Dump carried ownership | Confirm `--no-owner --no-privileges` |
| No archives for the tier at all | Nightly backup has never succeeded | Check the workflow; the RPO is not being met |

If **every** archive fails the same way, the fault is in the restore
environment, not the backups. Verify with the drill script against a local
Postgres before concluding data is lost.

---

## 5. Failure playbooks

### 5.1 Database is gone or corrupt

The case §3.2 covers. Key judgement: **is the data wrong, or is the database
unavailable?** If the managed provider is merely down, waiting is usually faster
and safer than restoring. Restore when data is damaged, not when it is
unreachable.

### 5.2 Railway is down or a deploy is bad

- A bad deploy is the common case. Roll back to the previous deployment in
  Railway before investigating; do not debug forward in production.
- Railway outage: nothing to restore, the databases are unaffected. Confirm on
  the status page, then wait. Do not attempt an emergency migration to another
  host during an incident — that is a project, not a fix.
- If it is prolonged and the kiosks must work, the only meaningful degradation is
  accepting cash on-site and reconciling later. Decide this explicitly rather
  than leaving customers guessing.

### 5.3 CamPay (payments) outage — money at risk

The important asymmetry: **a customer whose money was taken but whose machine
did not start must be made whole.** A customer who could not pay is merely
annoyed.

1. Confirm on CamPay's status page and by calling the API directly.
2. Check for stranded payments — money in, cycle not started. `outbox.aggregate_id`
   holds `transactions.external_reference` (set in `PaymentService`), which is
   what joins these two tables:

   ```sql
   SELECT t.external_reference, t.amount, t.machine_id, t.created_at,
          o.retry_count, o.last_error
   FROM transactions t
   LEFT JOIN outbox o
     ON o.aggregate_id = t.external_reference
    AND o.aggregate_type = 'Transaction'
   WHERE t.status = 'SUCCESSFUL'
     AND t.created_at > now() - interval '24 hours'
     AND (o.id IS NULL OR o.processed_at IS NULL)
   ORDER BY t.created_at;
   ```

   Two different problems show up here. `o.id IS NULL` means no event was ever
   written — the payment succeeded but nothing will ever retry it, so it needs
   manual attention. `o.processed_at IS NULL` means the event exists and the
   relay is still working on it; leave it alone unless `retry_count` has reached 5.

3. Do **not** manually insert machine-start commands for rows the relay is still
   retrying. Consumers dedupe on the transaction reference, but hand-written
   inserts bypass that reasoning and are how people accidentally double-start a
   machine or double-refund a customer.
4. If webhooks were missed, CamPay's transaction status endpoint is the source of
   truth — reconcile against it, not against our own records.
5. Keep a list of affected `external_reference` values for refunds or free cycles.

### 5.4 WhatsApp / Meta API outage

Customers cannot start cycles via the bot. Machines and payments are unaffected.
There is no queue to drain and no data to recover: inbound messages during a Meta
outage are lost at their end. Post a notice at the kiosks; that is the whole
remediation.

### 5.5 Secret leaked or compromised

Follow [`docs/SECRET-ROTATION.md`](./SECRET-ROTATION.md). Rotate at the
provider first, then update Doppler, then redeploy. Removing a secret from code
is not rotation — the old value stays valid until the provider is told otherwise.

### 5.6 Gateway is down

Currently a single point of failure: if `api-gateway` is down, everything is
down even though the services behind it are fine. Restart or roll it back first.
R12 in the roadmap adds a second instance; until then this is a known
single-instance risk.

---

## 6. Quarterly drill

Recovery procedures rot silently. The drill is what stops this document from
becoming fiction.

- **Automated:** the `Restore Drill` workflow runs on the 1st of January, April,
  July and October, and opens an issue if it fails.
- **Manual:** run it from the Actions tab after any Postgres version change,
  schema change large enough to worry you, or credential rotation.
- **Each time it passes:** transcribe the restore times into §2 with the date.
- **Once a year**, also do the parts a script cannot: actually repoint a service
  at a restored database and confirm the dashboard loads. The script proves the
  archive is good; only you can prove the cutover works.

A drill that has never been run is not a plan. Until §2 has real numbers in it,
treat this document as a proposal rather than a tested procedure.

---

## 7. Contacts and status pages

| Provider | Role | Status page |
|---|---|---|
| Railway | App hosting | https://status.railway.com |
| Supabase | Postgres | https://status.supabase.com |
| Cloudflare | R2 backup storage, CDN | https://www.cloudflarestatus.com |
| Auth0 | Authentication | https://status.auth0.com |
| CamPay | Mobile money payments | https://www.campay.net |
| Meta / WhatsApp | Customer messaging | https://metastatus.com |
| GitHub | Code, CI, backup scheduling | https://www.githubstatus.com |
| Grafana Cloud | Metrics and alerting | https://status.grafana.com |
| Doppler | Secrets | https://www.dopplerstatus.com |

**Escalation:** this is a solo-maintained platform. There is no second on-call.
Practical consequence: keep R2 and Doppler credentials recoverable from
somewhere that does not depend on this platform being up — a password manager,
not a file on the production host. If you are the only person who can restore
this system, write down where those credentials live and tell one other person.

---

## 8. Deliberate non-goals

Stated so nobody plans around capabilities that do not exist:

- **No multi-region failover.** One region, and an outage there is an outage.
- **No hot standby.** Recovery is restore-from-backup, not failover.
- **No sub-24 h RPO.** Requires paid PITR.
- **No automated failover of any kind.** Every recovery here is a human decision,
  on purpose — at this scale, automation would cause more incidents than it resolves.
