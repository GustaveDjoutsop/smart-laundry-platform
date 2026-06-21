#!/usr/bin/env bash
# provision-grafana-cloud.sh
# One-time setup: uploads the SLO dashboard and alert rules to Grafana Cloud.
#
# Prerequisites:
#   - doppler CLI installed and authenticated
#   - curl available
#   - GRAFANA_CLOUD_SA_TOKEN in Doppler (project: grafana, config: dev/prd)
#     → Create at https://dashingcape841.grafana.net/org/serviceaccounts
#       (Administration → Service Accounts → Admin role → generate token)
#
# Usage:
#   doppler run --project grafana --config dev -- ./monitoring/scripts/provision-grafana-cloud.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── Validate required env vars ────────────────────────────────────────────────
: "${GRAFANA_CLOUD_SA_TOKEN:?Set GRAFANA_CLOUD_SA_TOKEN in Doppler (project: grafana). Create at https://dashingcape841.grafana.net/org/serviceaccounts}"
: "${GRAFANA_CLOUD_PROMETHEUS_URL:?Set GRAFANA_CLOUD_PROMETHEUS_URL in Doppler}"

# Derive Grafana stack URL from SA token name convention (or hardcode)
GRAFANA_URL="https://dashingcape841.grafana.net"
# Grafana exposes a Ruler-compatible API for Cloud Alerting
GRAFANA_RULER_URL="$GRAFANA_URL/api/ruler/grafana/api/v1/rules"

echo "==> Grafana Cloud stack : $GRAFANA_URL"
echo "==> Grafana Ruler URL   : $GRAFANA_RULER_URL"
echo ""

# ── T2: Import dashboard ──────────────────────────────────────────────────────
echo "--- Importing Smart Laundry SLO dashboard ---"
DASHBOARD_JSON="$REPO_ROOT/monitoring/grafana/dashboards/smart-laundry.json"

# Use PowerShell for JSON manipulation (avoids Python/jq dependency on Windows)
IMPORT_PAYLOAD=$(powershell.exe -NoProfile -NonInteractive -Command "
  \$db = Get-Content -Raw -Encoding UTF8 '$DASHBOARD_JSON' | ConvertFrom-Json
  \$db.id = \$null
  \$wrapper = @{ dashboard = \$db; overwrite = \$true; folderId = 0 }
  \$wrapper | ConvertTo-Json -Depth 20 -Compress
" 2>/dev/null)

if [ -z "$IMPORT_PAYLOAD" ]; then
  echo "ERROR: failed to build dashboard import payload (PowerShell not available?)" >&2
  exit 1
fi

IMPORT_RESULT=$(curl -sf \
  -X POST "$GRAFANA_URL/api/dashboards/db" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GRAFANA_CLOUD_SA_TOKEN" \
  -d "$IMPORT_PAYLOAD")

echo "Dashboard import result: $IMPORT_RESULT"
echo ""

# ── T3: Upload alert rules via Grafana Cloud Alerting Ruler API ───────────────
# Grafana Cloud exposes /api/ruler/grafana/api/v1/rules/{namespace} which
# accepts the same Prometheus/Mimir YAML format; auth is Bearer SA token.
echo "--- Uploading alert rules to Grafana Cloud Alerting ---"
RULES_YAML="$SCRIPT_DIR/alert-rules.yaml"
RULER_NS_URL="$GRAFANA_RULER_URL/smart-laundry"

RULES_RESULT=$(curl -sf \
  -X POST "$RULER_NS_URL" \
  -H "Content-Type: application/yaml" \
  -H "Authorization: Bearer $GRAFANA_CLOUD_SA_TOKEN" \
  --data-binary @"$RULES_YAML")

echo "Rules upload result: ${RULES_RESULT:-OK (empty 202 response is normal)}"
echo ""

echo "==> Done. Verify at:"
echo "    Dashboard : $GRAFANA_URL/d/smart-laundry-slos"
echo "    Alerting  : $GRAFANA_URL/alerting/list"
