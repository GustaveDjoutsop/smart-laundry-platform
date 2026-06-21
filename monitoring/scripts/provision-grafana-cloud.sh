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

# Convert Unix path to Windows path for PowerShell's Get-Content
DASHBOARD_JSON_WIN=$(cygpath -w "$DASHBOARD_JSON")
IMPORT_PAYLOAD_FILE=$(mktemp /tmp/grafana-dashboard-XXXXXX.json)
trap "rm -f '$IMPORT_PAYLOAD_FILE'" EXIT

# Use PowerShell to wrap dashboard JSON in the Grafana import envelope and write
# to a temp file. Writing to a file (not a shell variable) avoids bash expanding
# the ${datasource} template variables in the panel datasource UIDs.
powershell.exe -NoProfile -NonInteractive -Command "
  \$db = Get-Content -Raw -Encoding UTF8 '$DASHBOARD_JSON_WIN' | ConvertFrom-Json
  \$wrapper = @{ dashboard = \$db; overwrite = \$true; folderId = 0 }
  \$json = \$wrapper | ConvertTo-Json -Depth 20 -Compress
  [System.IO.File]::WriteAllText('$(cygpath -w "$IMPORT_PAYLOAD_FILE")', \$json, [System.Text.UTF8Encoding]::new(\$false))
" 2>/dev/null

if [ ! -s "$IMPORT_PAYLOAD_FILE" ]; then
  echo "ERROR: failed to build dashboard import payload (PowerShell not available?)" >&2
  exit 1
fi

# Use @file so curl reads the JSON directly — prevents bash expanding ${datasource}
IMPORT_RESULT=$(curl -sf \
  -X POST "$GRAFANA_URL/api/dashboards/db" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GRAFANA_CLOUD_SA_TOKEN" \
  -d "@$IMPORT_PAYLOAD_FILE")

echo "Dashboard import result: $IMPORT_RESULT"
echo ""

# ── T3: Upload alert rules via Grafana Alerting Provisioning API ──────────────
# Rules must be POSTed individually to /api/v1/provisioning/alert-rules.
# Each rule JSON is read from grafana-alert-rules.json (Grafana-managed format,
# datasourceUid: grafanacloud-prom). Uses PowerShell to iterate the array and
# write each rule to a BOM-free temp file before curling.
echo "--- Uploading 10 alert rules to Grafana Cloud Alerting ---"
RULES_JSON_WIN=$(cygpath -w "$SCRIPT_DIR/grafana-alert-rules.json")

RULE_COUNT=$(powershell.exe -NoProfile -NonInteractive -Command "
  \$rules = Get-Content -Raw -Encoding UTF8 '$RULES_JSON_WIN' | ConvertFrom-Json
  Write-Output \$rules.Count
" 2>/dev/null)

echo "Rules to upload: $RULE_COUNT"

for i in $(seq 0 $((RULE_COUNT - 1))); do
  RULE_TMPFILE=$(mktemp /tmp/gf-rule-XXXXXX.json)
  trap "rm -f '$RULE_TMPFILE'" EXIT

  RULE_TITLE=$(powershell.exe -NoProfile -NonInteractive -Command "
    \$rules = Get-Content -Raw -Encoding UTF8 '$RULES_JSON_WIN' | ConvertFrom-Json
    \$rule = \$rules[$i]
    [System.IO.File]::WriteAllText('$(cygpath -w "$RULE_TMPFILE")', (\$rule | ConvertTo-Json -Depth 10 -Compress), [System.Text.UTF8Encoding]::new(\$false))
    Write-Output \$rule.title
  " 2>/dev/null)

  RULE_RESULT=$(curl -sf \
    -X POST "$GRAFANA_URL/api/v1/provisioning/alert-rules" \
    -H "Content-Type: application/json" \
    -H "X-Disable-Provenance:" \
    -H "Authorization: Bearer $GRAFANA_CLOUD_SA_TOKEN" \
    -d "@$RULE_TMPFILE")
  echo "  [$((i+1))/$RULE_COUNT] $RULE_TITLE → $(echo "$RULE_RESULT" | grep -o '"uid":"[^"]*"' | head -1)"
  rm -f "$RULE_TMPFILE"
done
echo ""

echo "==> Done. Verify at:"
echo "    Dashboard : $GRAFANA_URL/d/smart-laundry-slos"
echo "    Alerting  : $GRAFANA_URL/alerting/list"
