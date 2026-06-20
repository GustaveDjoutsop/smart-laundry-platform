#!/usr/bin/env bash
# reset-machine.sh
# Resets a SINGLE machine scenario back to IDLE.
#
# Usage:
#   bash eqlink-mock/scripts/reset-machine.sh washer_01 [WIREMOCK_URL]
#   bash eqlink-mock/scripts/reset-machine.sh dryer_03 http://localhost:9099

MACHINE="${1}"
WIREMOCK="${2:-http://localhost:9099}"

if [ -z "$MACHINE" ]; then
    echo "Usage: $0 <machine_id> [wiremock_url]"
    echo "Example: $0 washer_01"
    exit 1
fi

SCENARIO="machine-$MACHINE"

echo "Resetting $MACHINE to IDLE..."
curl -sf -X PUT \
     -H "Content-Type: application/json" \
     -d "{\"state\":\"Started\"}" \
     "$WIREMOCK/__admin/scenarios/$SCENARIO/state"

echo ""
echo "Done. $MACHINE is now IDLE."
