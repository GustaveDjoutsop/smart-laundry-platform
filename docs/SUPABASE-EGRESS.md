# Supabase Egress — Diagnosis and Remediation

**Purpose:** why the Supabase org blew through its Free-plan egress allowance in the
billing cycle starting 13 Oct 2026, how that was measured rather than guessed, and what
changed in response. Written alongside PR #294 so the reasoning survives the diff.

**Last verified:** 2026-11-11. Figures marked **(live-checked)** came from
`pg_stat_statements` on the `smartlaundry-dev` project and from Railway deployment logs
on that date. Byte estimates are explicitly derived, not measured — see
[Attributing bytes](#attributing-bytes).

---

## 1. The symptom

All Supabase services were restricted under the Fair Use Policy; projects returned HTTP
402:

| Metric | Usage | Allowance |
|---|---|---|
| **Egress** | **6.111 GB (122%)** | 5 GB |
| Database size | 0.029 GB (6%) | 0.5 GB |
| Log ingestion | 0.133 GB (13%) | 1 GB |
| Cached egress | 0 GB | 5 GB |

Egress is cumulative bandwidth out of the project over the billing cycle. It does not go
back down when rows are deleted — a database of 29 MB had shipped 6.1 GB. The question
was never "what is stored", it was "what is being read, and how often".

## 2. How it was diagnosed

The whole diagnosis is one query. Anyone re-investigating should start here rather than
reasoning from the code:

```sql
SELECT calls,
       rows,
       round(rows::numeric / greatest(calls, 1), 1) AS rows_per_call,
       round(total_exec_time::numeric / 1000, 1)    AS total_s,
       left(regexp_replace(query, '\s+', ' ', 'g'), 140) AS q
FROM pg_stat_statements
ORDER BY rows DESC
LIMIT 25;
```

Pair it with the window the counters cover, or the numbers mean nothing:

```sql
SELECT stats_reset,
       extract(epoch FROM (now() - stats_reset)) / 86400 AS days
FROM pg_stat_statements_info;
```

**Counters covered 147.2 days** (reset 2026-06-17, read 2026-11-11).

## 3. What the numbers said (live-checked)

| Query | Calls | Calls/day | Rows returned |
|---|---|---|---|
| `SELECT <30 cols> FROM machine.machines WHERE machine_id = ?` | 15,349,274 | **104,300** | 15.3M |
| `UPDATE machine.machines SET <23 cols> WHERE id = ?` | 12,680,192 | **86,160** | 12.7M |
| `SELECT <30 cols> FROM machine.machines` (16 rows) | 625,980 | 4,253 | 10.0M |
| `findByStatus(FINISHED)` | 625,978 | 4,253 | **0** |
| `findByLastHeartbeatBefore(...)` | 444,683 | 3,021 | 131,629 |
| `findByStatusAndEndsAtBefore(...)` | 351,654 | 2,389 | 285,696 |

The top two rows are the entire story. Everything below them is rounding error.

### Why that is the simulator

`SimulatorHeartbeatService` ran two scheduled jobs at 30-second intervals over
`machine.available-ids`. Each tick called `MachineService.processTelemetry` per machine,
which did a full 30-column `findByMachineId` followed by a whole-entity save —
unconditionally, whether or not anything had changed.

```
16 machines x 2 jobs x 2,880 ticks/day = 92,160 read+write pairs per day per instance
```

Measured: 104,300 reads and 86,160 writes per day. The arithmetic lands on one to two
instances' worth of simulator traffic, running continuously since June.

The two `findAll`-shaped queries at 4,253 calls/day are roughly 3x what a single 60-second
job produces, which was the first hint that **more than one instance** was pointed at this
database. Section 6 confirms where the extra ones came from.

### Attributing bytes

Row counts above are measured. The conversion to bytes is an estimate: a 30-column machine
row carries roughly 300–400 bytes of data, plus a `RowDescription` of ~30 field descriptors
on each response. At ~1.2 KB per single-row fetch:

| Source | Per 30 days | Share |
|---|---|---|
| `findByMachineId` (simulator) | ~3.8 GB | ~62% |
| `findAll` 16 full rows | ~0.8 GB | ~13% |
| `UPDATE` responses | ~0.3 GB | ~5% |
| Everything else (sweeps, metadata, Studio, auth) | remainder | ~20% |

That totals near the observed 6.1 GB. Treat the split as indicative; treat the call counts
as fact.

## 4. What was *not* the cause

Recorded because each of these is a plausible theory that cost real time, and all of them
measured as noise:

- **The scheduled sweeps.** `CycleMonitorService`, `ReservationService` and
  `ReservationReminderService` run at 60s, which is 1,440–4,253 calls/day each, mostly
  returning **zero rows**. Slowing them to 5 minutes would have saved ~1% of egress and
  cost real latency on cycle completion and reservation expiry. They were left alone
  deliberately.
- **`SELECT *` in `InvoiceRecordStore` / `MaintenanceService`.** Do not appear anywhere
  near the top by rows returned.
- **`EqLinkMachinePoller`.** `eqlink.enabled=false`; no EQLink queries in the statistics
  at all.
- **An event row per telemetry save.** `machine_events` held **70 rows** total across the
  whole 147-day window.
- **Prometheus scraping Supabase's metrics endpoint.** A classic cause of exactly this
  bill, but `monitoring/prometheus/prometheus.yml` only scrapes
  `host.docker.internal` service endpoints — it never touches Supabase.
- **The `botmanagerservice` project.** Effectively idle: 3,491 auth calls, no application
  queries. All of the egress is `smartlaundry-dev`. (Note: `docs/INFRASTRUCTURE.md` lists a
  third project, `smartlaundry-test`; it no longer appears in the org listing as of
  2026-11-11.)
- **Dashboard polling.** Real, but it goes through `reporting-bff`, which is already
  Redis-cached with ETag/304. It barely reaches Postgres.

## 5. What changed (PR #294)

| Change | Effect |
|---|---|
| Simulator heartbeat replaced with two set-based `UPDATE`s | Removes ~92k reads and ~92k writes/day. No per-machine `SELECT`, no entity save. |
| `RUNNING`/`FINISHED`/`ERROR`/`MAINTENANCE` excluded in the `WHERE` clause | The database decides which rows a heartbeat may touch. Also closes a start-cycle race that previously needed an application-code guard. |
| Simulator suspends itself against a non-local datasource | Fail-safe against this recurring, with `simulator.allow-non-local-database=true` as a deliberate override. |
| `MachineStatusRow` projection — 13 of 30 columns | Narrows the machine-list query, the hottest read in the service. |
| `@DynamicUpdate` on `Machine` | A save writes only the columns that changed. |

### Behaviour deliberately given up

- Idle ticks no longer persist simulated temperature, humidity, spin speed or power
  consumption. Only `temperature` is visible in any response, so a dev machine that
  finished a cycle hot now sits `IDLE` showing that temperature instead of drifting back
  down.
- `ERROR` and `MAINTENANCE` are **no longer reset to `IDLE`** every tick. The old path
  cleared them; once the override flag can point the simulator at a shared database,
  silently returning a faulted machine to service is not acceptable. The `STATUS_CHANGE`
  audit events those resets emitted are gone with them.

## 6. The preview-environment finding

The first push of PR #294 made the guard throw, and the Railway preview deploy failed with:

```
IllegalStateException: simulator.enabled=true but spring.datasource.url
is not a local database
```

That is the confirmation the measurement could only infer: **Railway builds a preview
environment per pull request from a template carrying `SIMULATOR_ENABLED=true` and a
managed datasource.** Every open PR touching `MachineStateService` has been running its own
simulator against the shared dev project, each adding ~92k reads and ~92k writes a day for
as long as that PR stayed open. That is where the 2–3x multiplier came from.

It also showed why *throwing* was the wrong response: no per-PR step sets that variable, so
failing the context bricks every preview deploy of this service instead of fixing anything.
The guard now suspends the simulator — identical egress outcome, service still boots, and
the misconfiguration is logged at `ERROR` on every startup. Verified in the preview
environment on 2026-11-11 (live-checked): started in 9.3s with the suspension logged and no
simulated telemetry produced.

## 7. Still open

These are **not** addressed by PR #294 and need action outside the repository:

1. **`SIMULATOR_ENABLED=false`** on dev, production, and — most importantly — the
   environment template that PR previews are cloned from. The code now makes a wrong value
   harmless rather than expensive, but while the simulator is nominally enabled the real
   command dispatcher stays disabled, so machine start commands are no-ops in those
   environments.
2. **The Free plan itself.** `smartlaundry-dev` holds live customer data with no backups
   and no PITR. 6.1 GB would be 2.4% of Pro's 250 GB allowance. The egress bill was never
   the real risk here.
3. **An egress budget alert**, so the next regression is caught by a notification rather
   than by a 402.

## 8. Re-checking later

```sql
-- biggest readers since the last counter reset
SELECT calls, rows, left(regexp_replace(query, '\s+', ' ', 'g'), 120) AS q
FROM pg_stat_statements ORDER BY rows DESC LIMIT 15;

-- who is actually connected right now
SELECT client_addr, application_name, usename, count(*)
FROM pg_stat_activity WHERE backend_type = 'client backend'
GROUP BY 1, 2, 3 ORDER BY 4 DESC;
```

The second query is how to spot a stray instance — an unexpected `PostgreSQL JDBC Driver`
client address is a service nobody remembered was running.
