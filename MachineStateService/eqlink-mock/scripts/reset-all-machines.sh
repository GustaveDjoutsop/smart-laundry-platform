#!/usr/bin/env bash
# reset-all-machines.sh
# Resets every machine scenario back to IDLE (WireMock "Started" state).
# Use this to clear any "Running" state after a test cycle.
#
# Usage:
#   bash eqlink-mock/scripts/reset-all-machines.sh [WIREMOCK_URL]
#   bash eqlink-mock/scripts/reset-all-machines.sh http://localhost:9099

WIREMOCK="${1:-http://localhost:9099}"

echo "Resetting all machine scenarios to IDLE on $WIREMOCK ..."

MACHINES=(washer_01 washer_02 washer_03 washer_04 washer_05 washer_06 dryer_01 dryer_02 dryer_03 dryer_04)

for machine in "${MACHINES[@]}"; do
    SCENARIO="machine-$machine"
    curl -sf -X PUT \
         -H "Content-Type: application/json" \
         -d "{\"state\":\"Started\"}" \
         "$WIREMOCK/__admin/scenarios/$SCENARIO/state" \
         > /dev/null 2>&1

    if [ $? -eq 0 ]; then
        echo "  ✓ $machine → IDLE"
    else
        echo "  ✗ $machine (scenario may not exist yet — start the service first)"
    fi
done

echo ""
echo "Done. All machines are now IDLE."
