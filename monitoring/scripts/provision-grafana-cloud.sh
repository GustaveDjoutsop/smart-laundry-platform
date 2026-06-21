#!/usr/bin/env bash
# provision-grafana-cloud.sh
# One-time setup: uploads the SLO dashboard and alert rules to Grafana Cloud.
#
# Prerequisites:
#   - doppler CLI installed and authenticated
#   - curl, python3 available
#   - GRAFANA_CLOUD_STACK_URL added to Doppler (project: grafana, config: dev)
#     e.g. https://sundaygustav.grafana.net  (no trailing slash)
#
# Usage:
#   doppler run --project grafana --config dev -- ./monitoring/scripts/provision-grafana-cloud.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── Validate required env vars ────────────────────────────────────────────────
: "${GRAFANA_CLOUD_STACK_URL:?Set GRAFANA_CLOUD_STACK_URL in Doppler (project: grafana). Example: https://yourstack.grafana.net}"
: "${GRAFANA_CLOUD_API_KEY:?Set GRAFANA_CLOUD_API_KEY in Doppler (project: grafana)}"
: "${GRAFANA_CLOUD_USERNAME:?Set GRAFANA_CLOUD_USERNAME in Doppler (project: grafana)}"
: "${GRAFANA_CLOUD_PROMETHEUS_URL:?Set GRAFANA_CLOUD_PROMETHEUS_URL in Doppler (project: grafana)}"

GRAFANA_URL="${GRAFANA_CLOUD_STACK_URL%/}"   # strip trailing slash
# Derive Mimir Ruler base from Prometheus push URL
MIMIR_RULER_BASE="${GRAFANA_CLOUD_PROMETHEUS_URL%/push}"   # → .../api/prom

echo "==> Grafana Cloud stack : $GRAFANA_URL"
echo "==> Mimir Ruler base    : $MIMIR_RULER_BASE"
echo ""

# ── T2: Import dashboard ──────────────────────────────────────────────────────
echo "--- Importing Smart Laundry SLO dashboard ---"
DASHBOARD_JSON="$REPO_ROOT/monitoring/grafana/dashboards/smart-laundry.json"

# Wrap the dashboard JSON in the import envelope Grafana API expects
IMPORT_PAYLOAD=$(python3 - <<EOF
import json, sys
with open("$DASHBOARD_JSON") as f:
    db = json.load(f)
db["id"] = None   # let Grafana assign a new ID
print(json.dumps({"dashboard": db, "overwrite": True, "folderId": 0}))
EOF
)

IMPORT_RESULT=$(curl -sf \
  -X POST "$GRAFANA_URL/api/dashboards/db" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GRAFANA_CLOUD_API_KEY" \
  -d "$IMPORT_PAYLOAD")

echo "Dashboard import result: $IMPORT_RESULT"
echo ""

# ── T3: Upload alert rules to Mimir Ruler ────────────────────────────────────
# Mimir uses Cortex-compatible Ruler API with Basic Auth.
# Namespace "smart-laundry" groups all SLO rules under one logical bucket.
echo "--- Uploading alert rules to Mimir Ruler ---"
RULES_YAML="$SCRIPT_DIR/alert-rules.yaml"
MIMIR_RULER_URL="$MIMIR_RULER_BASE/rules/smart-laundry"

RULES_RESULT=$(curl -sf \
  -X POST "$MIMIR_RULER_URL" \
  -H "Content-Type: application/yaml" \
  -u "${GRAFANA_CLOUD_USERNAME}:${GRAFANA_CLOUD_API_KEY}" \
  --data-binary @"$RULES_YAML")

echo "Rules upload result: ${RULES_RESULT:-OK (empty 202 response is normal)}"
echo ""

echo "==> Done. Open $GRAFANA_URL to verify."
echo "    Dashboard: $GRAFANA_URL/d/smart-laundry-slos"
echo "    Alert rules: $GRAFANA_URL/alerting/list"
