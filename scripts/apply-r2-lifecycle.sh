#!/usr/bin/env bash
#
# apply-r2-lifecycle.sh — apply (or show) the backup bucket's retention rules.
#
# Retention is enforced by the bucket, not by backup-databases.sh, so that the
# CI credential only ever needs write permission. See scripts/r2-lifecycle.json
# for the reasoning.
#
#   ./scripts/apply-r2-lifecycle.sh          # apply the rules
#   ./scripts/apply-r2-lifecycle.sh --show   # print what is currently applied
#
# Requires: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
#
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="${HERE}/r2-lifecycle.json"
MODE="apply"
[[ "${1:-}" == "--show" ]] && MODE="show"

for var in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
  [[ -n "${!var:-}" ]] || { echo "Environment variable ${var} is not set." >&2; exit 1; }
done

command -v aws >/dev/null || { echo "aws CLI not found." >&2; exit 1; }
command -v jq  >/dev/null || { echo "jq not found (needed to strip the _comment key)." >&2; exit 1; }

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="auto"
# Jurisdictional buckets (EU, FedRAMP) are ONLY reachable via their own host;
# the generic host reports the bucket as nonexistent. This project's bucket is in
# the EU jurisdiction, so R2_JURISDICTION=eu is required.
# https://developers.cloudflare.com/r2/reference/data-location/
if [[ -n "${R2_ENDPOINT:-}" ]]; then
  ENDPOINT="$R2_ENDPOINT"
elif [[ -n "${R2_JURISDICTION:-}" && "${R2_JURISDICTION}" != "default" ]]; then
  ENDPOINT="https://${R2_ACCOUNT_ID}.${R2_JURISDICTION}.r2.cloudflarestorage.com"
else
  ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
fi

if [[ "$MODE" == "show" ]]; then
  echo "Lifecycle rules currently applied to ${R2_BUCKET}:"
  aws s3api get-bucket-lifecycle-configuration \
    --endpoint-url "$ENDPOINT" --bucket "$R2_BUCKET" \
    || echo "(none configured, or the credential lacks permission to read them)"
  exit 0
fi

# `aws s3api` rejects keys it does not recognise, so the documentation block in
# the JSON must be removed before submitting it.
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
jq 'del(._comment)' "$CONFIG" > "$TMP"

echo "Applying lifecycle rules from ${CONFIG} to bucket ${R2_BUCKET}"
jq -r '.Rules[] | "  \(.ID): \(.Filter.Prefix) expires after \(.Expiration.Days) days"' "$TMP"

aws s3api put-bucket-lifecycle-configuration \
  --endpoint-url "$ENDPOINT" \
  --bucket "$R2_BUCKET" \
  --lifecycle-configuration "file://${TMP}"

echo
echo "Applied. Verifying:"
aws s3api get-bucket-lifecycle-configuration \
  --endpoint-url "$ENDPOINT" --bucket "$R2_BUCKET"
