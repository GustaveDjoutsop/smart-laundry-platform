#!/usr/bin/env bash
# show-machine-states.sh
# Lists current scenario state for all 10 machines.
#
# Usage:
#   bash eqlink-mock/scripts/show-machine-states.sh [WIREMOCK_URL]

WIREMOCK="${1:-http://localhost:9099}"

echo "Machine states from $WIREMOCK:"
echo ""

RESPONSE=$(curl -sf "$WIREMOCK/__admin/scenarios" 2>/dev/null)
if [ -z "$RESPONSE" ]; then
    echo "ERROR: Cannot reach WireMock at $WIREMOCK"
    echo "Is it running? Try: docker compose -f eqlink-mock/docker-compose.yml up -d"
    exit 1
fi

MACHINES=(washer_01 washer_02 washer_03 washer_04 washer_05 washer_06 dryer_01 dryer_02 dryer_03 dryer_04)
DEVICES=(MOCK-W01   MOCK-W02   MOCK-W03   MOCK-W04   MOCK-W05   MOCK-W06   MOCK-D01  MOCK-D02  MOCK-D03  MOCK-D04)

for i in "${!MACHINES[@]}"; do
    machine="${MACHINES[$i]}"
    device="${DEVICES[$i]}"
    scenario="machine-$machine"

    # Extract state for this scenario
    STATE=$(echo "$RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
scenarios = data.get('scenarios', [])
for s in scenarios:
    if s.get('name') == '$scenario':
        print(s.get('state', 'unknown'))
        break
else:
    print('not-yet-triggered')
" 2>/dev/null || echo "not-yet-triggered")

    if [ "$STATE" = "Started" ] || [ "$STATE" = "not-yet-triggered" ]; then
        ICON="⚪ IDLE"
    elif [ "$STATE" = "Running" ]; then
        ICON="🟢 RUNNING"
    else
        ICON="❓ $STATE"
    fi

    printf "  %-12s  %-10s  %s\n" "$machine" "$device" "$ICON"
done
