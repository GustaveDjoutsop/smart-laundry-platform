# Smart Laundry — Monitoring

Two-layer monitoring: **local Prometheus + Grafana** for dev/LAN access, and
**Grafana Cloud** for remote access from anywhere (free tier, 10k series, 14-day
retention). Local Prometheus pushes metrics to Grafana Cloud via `remote_write`.

## Architecture

```
Services (host)          local Prometheus       Grafana Cloud (remote)
  :8080 gateway          (:9090)                prometheus-prod-65-eu-west-2
  :8081 payment   ──────> scrape every 15s ────> remote_write (Mimir)
  :8082 machine           │                      │
  :8083 bff               │                      ├─ Dashboards (anywhere)
  :8091 bot               ▼                      └─ Alerting (anywhere)
                     local Grafana
                     (:3002, LAN only)
```

## Quick start — local monitoring

Run via Doppler so `remote_write` credentials are injected automatically:

```bash
doppler run --project grafana --config dev -- \
  docker compose --profile monitoring up prometheus grafana
```

- Local Prometheus: http://localhost:9090
- Local Grafana: http://localhost:3002 (admin / see Doppler `GRAFANA_ADMIN_PASSWORD`)

To run **without** Grafana Cloud forwarding (local-only, no credentials needed):

```bash
docker compose --profile monitoring up prometheus grafana
# GRAFANA_CLOUD_* vars will be empty; Prometheus warns and skips remote_write
```

## Grafana Cloud — one-time setup

### 1. Create a Grafana Service Account token

In the hosted Grafana UI at https://dashingcape841.grafana.net:

1. **Administration → Service Accounts → Add service account**
2. Give it **Admin** role (needed to create dashboards and alert rules)
3. Click the SA → **Add service account token** → generate and copy it
4. Add it to Doppler `grafana` project as `GRAFANA_CLOUD_SA_TOKEN`

> **Why not the `glc_` key?** The `GRAFANA_CLOUD_API_KEY` in Doppler is a Grafana.com
> management token (org/stack management). The hosted Grafana UI and Grafana Cloud
> Alerting Ruler API require a Service Account token scoped to the Grafana instance.
> `GRAFANA_CLOUD_API_KEY` is still correct for `remote_write` (Mimir Basic Auth).

### 2. Add local Grafana admin credentials to Doppler (recommended)

```
GRAFANA_ADMIN_USER     = admin
GRAFANA_ADMIN_PASSWORD = <strong password>
```

### 3. Run the provisioning script

This uploads the SLO dashboard and all 10 alert rules to Grafana Cloud:

```bash
doppler run --project grafana --config dev -- \
  ./monitoring/scripts/provision-grafana-cloud.sh
```

The script:
- Imports `monitoring/grafana/dashboards/smart-laundry.json` via Grafana Dashboards API
- Uploads `monitoring/scripts/alert-rules.yaml` to Grafana Cloud Alerting Ruler API
  (`/api/ruler/grafana/api/v1/rules/smart-laundry`) — same YAML format as Prometheus
- Prints direct URLs to verify

### 4. In Grafana Cloud — select the right datasource

When opening the imported dashboard, use the **Data Source** dropdown at the
top to select your Cloud Prometheus datasource (usually named
`grafanacloud-<stackname>-prom`). The `$datasource` template variable makes
the same dashboard JSON work both locally and in the Cloud.

## Credentials (Doppler project: `grafana`)

| Secret | Purpose |
|---|---|
| `GRAFANA_CLOUD_PROMETHEUS_URL` | Mimir push endpoint (`remote_write` target) |
| `GRAFANA_CLOUD_USERNAME` | Mimir instance ID — Basic Auth username for `remote_write` |
| `GRAFANA_CLOUD_API_KEY` | Grafana.com management token — Basic Auth **password** for `remote_write` |
| `GRAFANA_CLOUD_SA_TOKEN` | Grafana Service Account token — Bearer token for Grafana API (dashboard + alerting). **Must be created** (see step 1) |
| `GRAFANA_ADMIN_USER` | Local Grafana admin user |
| `GRAFANA_ADMIN_PASSWORD` | Local Grafana admin password |

## Files

```
monitoring/
├── prometheus/
│   ├── prometheus.yml        # scrape configs + remote_write to Grafana Cloud
│   └── alerts.yml            # Prometheus-evaluated alert rules (local)
├── grafana/
│   ├── dashboards/
│   │   └── smart-laundry.json   # SLO dashboard (datasource variable — works locally + Cloud)
│   └── provisioning/
│       ├── datasources/prometheus.yml
│       └── dashboards/dashboards.yml
└── scripts/
    ├── alert-rules.yaml         # Mimir Ruler format — uploaded to Grafana Cloud
    └── provision-grafana-cloud.sh  # one-time Cloud setup script
```

## Alert rules

10 rules in both `prometheus/alerts.yml` (evaluated locally) and
`scripts/alert-rules.yaml` (uploaded to Grafana Cloud Alerting):

| Rule | Condition | Severity |
|---|---|---|
| ServiceDown | `up == 0` for 2m | critical |
| GatewayLatencyHigh | p95 > 2s for 5m | warning |
| BFFLatencyHigh | p95 > 1s for 5m | warning |
| WebhookLatencyHigh | p95 > 500ms for 5m | warning |
| HighErrorRate | 5xx > 5% for 5m | critical |
| OutboxDeadLetter | any dead-letter in 10m | critical |
| OutboxPendingHigh | pending > 50 for 5m | warning |
| OutboxRelayStalled | no progress + pending > 0 for 10m | critical |
| JVMHeapUsageHigh | heap > 90% for 5m | warning |
| HikariPoolExhausted | pending connections > 5 for 2m | warning |

## Custom metrics (business SLOs)

| Metric | Source | Tags |
|---|---|---|
| `outbox_relay_pending` | PMS OutboxRelayService | — |
| `outbox_relay_processed_total` | PMS OutboxRelayService | — |
| `outbox_relay_dead_letter_total` | PMS OutboxRelayService | — |
| `outbox_relay_batch_duration` | PMS OutboxRelayService | percentiles p50/p95/p99 |
| `machine_cycle_started_total` | MSS MachineService | `machine_id`, `cycle_type` |
| `machine_cycle_idempotent_total` | MSS MachineService | `machine_id` |
