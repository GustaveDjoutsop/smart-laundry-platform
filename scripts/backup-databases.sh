#!/usr/bin/env bash
#
# backup-databases.sh — nightly logical backups of every platform database to
# Cloudflare R2 (S3-compatible object storage).
#
# Part of R2 in the architecture roadmap. Supabase point-in-time recovery
# requires the Pro plan; this gets us a 24-hour RPO for effectively zero cost
# using R2's 10 GB free tier and GitHub Actions' free scheduled runners.
#
# ── DESIGN NOTES ────────────────────────────────────────────────────────────
#
# 1. EVERY DUMP IS VERIFIED BEFORE UPLOAD. `pg_dump` can exit 0 and still
#    produce a truncated archive if the connection drops mid-stream. We run
#    `pg_restore --list` on each archive and require a non-empty table of
#    contents. An unverified backup is not a backup, it is a hope.
#
# 2. --format=custom, not plain SQL. Allows selective restore of individual
#    tables during an incident and compresses internally.
#
# 3. A SHA-256 sidecar is uploaded next to each dump so the restore drill (R3)
#    can prove the bytes it downloaded are the bytes we wrote.
#
# 4. Retention uses grandfather-father-son PREFIXES (daily/, weekly/, monthly/)
#    rather than deleting objects from this script. R2 lifecycle rules then
#    expire each prefix on its own schedule — see scripts/r2-lifecycle.json.
#    Deletion is left to the bucket so a compromised CI token cannot erase
#    history: the token only needs write access, never delete.
#
# ── USAGE ───────────────────────────────────────────────────────────────────
#
#   ./scripts/backup-databases.sh
#   ./scripts/backup-databases.sh --dry-run     # dump and verify, skip upload
#   ./scripts/backup-databases.sh --db smartbot # single database
#
# Required environment (from Doppler locally, GitHub Secrets in CI):
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
#   R2_JURISDICTION  optional; set to "eu" for an EU-jurisdiction bucket
#   R2_ENDPOINT      optional; overrides the computed endpoint entirely
#   DATABASE_URL_SMARTBOT, DATABASE_URL_MACHINEDB, DATABASE_URL_PAYMENTDB
#
# Connection strings must be full libpq URLs, e.g.
#   postgresql://user:pass@host:5432/smartbot?sslmode=require
#
set -Eeuo pipefail

# ── Configuration ───────────────────────────────────────────────────────────

# Databases to back up: logical name -> env var holding its connection URL.
# Keep in sync with the Flyway-managed schemas (bot V7+, MSS V4+, PMS V12+).
DATABASES=(
  "smartbot:DATABASE_URL_SMARTBOT"
  "machinedb:DATABASE_URL_MACHINEDB"
  "paymentdb:DATABASE_URL_PAYMENTDB"
)

WORKDIR="$(mktemp -d)"
DRY_RUN=false
ONLY_DB=""

# Timestamps computed once so every object in a run shares a prefix.
#
# BACKUP_DATE_OVERRIDE exists purely as a test seam: retention-tier promotion
# only happens on Sundays and the 1st, which is otherwise untestable without
# waiting for the calendar. Set it to a YYYY-MM-DD date to simulate a run.
REF_DATE="${BACKUP_DATE_OVERRIDE:-}"
if [[ -n "$REF_DATE" ]]; then
  date -u -d "$REF_DATE" +%Y-%m-%d >/dev/null 2>&1 \
    || { echo "BACKUP_DATE_OVERRIDE is not a valid date: ${REF_DATE}" >&2; exit 1; }
  DATE_ARGS=(-u -d "$REF_DATE")
else
  DATE_ARGS=(-u)
fi

RUN_DATE="$(date "${DATE_ARGS[@]}" +%Y-%m-%d)"
RUN_STAMP="$(date "${DATE_ARGS[@]}" +%Y-%m-%dT%H%M%SZ)"
DAY_OF_WEEK="$(date "${DATE_ARGS[@]}" +%u)"   # 1=Monday, 7=Sunday
DAY_OF_MONTH="$(date "${DATE_ARGS[@]}" +%d)"

# ── Plumbing ────────────────────────────────────────────────────────────────

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
[[ -t 1 ]] || { RED=""; GREEN=""; YELLOW=""; BOLD=""; RESET=""; }

log()  { printf '%s[%s]%s %s\n' "$BOLD" "$(date -u +%H:%M:%S)" "$RESET" "$*"; }
ok()   { printf '%s  OK%s   %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s  WARN%s %s\n' "$YELLOW" "$RESET" "$*"; }
die()  { printf '%s  FAIL%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

# Never let a connection string reach the log. Dumps are the one place where a
# careless `set -x` or error message leaks a database password.
redact() {
  sed -E 's#(postgres(ql)?://[^:]+:)[^@]+@#\1***@#g'
}

# The S3 endpoint for this account. Buckets created with a jurisdiction (EU,
# FedRAMP) are reachable ONLY via a jurisdiction-specific host, and requests to
# the generic host fail as if the bucket did not exist:
#
#   default   https://<ACCOUNT_ID>.r2.cloudflarestorage.com
#   eu        https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com
#
# https://developers.cloudflare.com/r2/reference/data-location/
#
# This project's bucket is in the EU jurisdiction for GDPR reasons (customer
# phone numbers and payment references), so R2_JURISDICTION must be set to "eu".
# Getting this wrong produces a confusing NoSuchBucket rather than a permission
# error, which is why it is computed once here instead of inline at each call.
r2_endpoint() {
  if [[ -n "${R2_ENDPOINT:-}" ]]; then
    printf '%s' "$R2_ENDPOINT"          # explicit override wins
  elif [[ -n "${R2_JURISDICTION:-}" && "${R2_JURISDICTION}" != "default" ]]; then
    printf 'https://%s.%s.r2.cloudflarestorage.com' "$R2_ACCOUNT_ID" "$R2_JURISDICTION"
  else
    printf 'https://%s.r2.cloudflarestorage.com' "$R2_ACCOUNT_ID"
  fi
}

# Upload one file to R2. Wrapped so endpoint, retries and credential handling
# live in exactly one place.
#
# `aws s3api put-object` is used rather than `aws s3 cp` because R2 does not
# implement every transfer-manager call `s3 cp` may reach for; put-object is the
# plain single-request path and is well supported.
r2_cp() {
  local src="$1" key="$2" attempt
  for attempt in 1 2 3; do
    if AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
       AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
       AWS_DEFAULT_REGION="auto" \
       aws s3api put-object \
         --endpoint-url "$(r2_endpoint)" \
         --bucket "$R2_BUCKET" \
         --key "$key" \
         --body "$src" \
         >/dev/null 2> >(redact >&2); then
      return 0
    fi
    warn "Upload attempt ${attempt}/3 failed for ${key}"
    sleep $((attempt * 5))
  done
  return 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --db)
      [[ -n "${2:-}" ]] || die "--db requires a database name"
      ONLY_DB="$2"
      shift 2
      ;;
    -h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)         die "Unknown argument: $1" ;;
  esac
done

# ── Preflight ───────────────────────────────────────────────────────────────

log "Preflight checks"

for tool in pg_dump pg_restore sha256sum; do
  command -v "$tool" >/dev/null 2>&1 || die "Required tool not found: $tool"
done

if [[ "$DRY_RUN" == false ]]; then
  command -v aws >/dev/null 2>&1 \
    || die "aws CLI not found (needed for R2 upload). Install it or pass --dry-run."
  for var in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
    [[ -n "${!var:-}" ]] || die "Environment variable $var is not set."
  done
fi

# pg_dump must be at least as new as the server it dumps. This repo runs a mix
# of Postgres 15, 16 and 17 across compose files, and Supabase is newer still,
# so CI pins the v17 client. A too-old client fails with a version mismatch
# rather than producing a bad dump, but check loudly anyway.
PG_DUMP_VERSION="$(pg_dump --version | grep -oE '[0-9]+' | head -1)"
log "pg_dump major version: ${PG_DUMP_VERSION}"
if (( PG_DUMP_VERSION < 16 )); then
  warn "pg_dump ${PG_DUMP_VERSION} is older than the newest server in this project (17)."
  warn "Dumps of newer servers will be refused. Install postgresql-client-17."
fi

if [[ -n "$ONLY_DB" ]]; then
  case "$ONLY_DB" in
    paymentdb|machinedb|smartbot) ;;
    *) die "Unknown database name for --db: $ONLY_DB" ;;
  esac
fi

# ── Retention tier for this run ─────────────────────────────────────────────
#
# One dump is taken and copied to each tier it qualifies for, so a single run
# costs one pg_dump regardless of how many prefixes it lands in.

TIERS=("daily")
[[ "$DAY_OF_WEEK"  == "7"  ]] && TIERS+=("weekly")    # Sunday
[[ "$DAY_OF_MONTH" == "01" ]] && TIERS+=("monthly")
log "Retention tiers for this run: ${TIERS[*]}"

# ── Backup loop ─────────────────────────────────────────────────────────────

declare -a SUMMARY=()
FAILED=0

for entry in "${DATABASES[@]}"; do
  db_name="${entry%%:*}"
  url_var="${entry##*:}"

  if [[ -n "$ONLY_DB" && "$ONLY_DB" != "$db_name" ]]; then
    continue
  fi

  echo
  log "── ${db_name} ────────────────────────────────────────────"

  conn="${!url_var:-}"
  if [[ -z "$conn" ]]; then
    warn "${url_var} is not set — cannot back up ${db_name}."
    SUMMARY+=("${db_name}|FAILED|missing connection string")
    FAILED=1
    continue
  fi

  dump_file="${WORKDIR}/${db_name}-${RUN_STAMP}.dump"

  # ── Dump ──
  log "Dumping ${db_name}"
  if ! pg_dump \
        --dbname="$conn" \
        --format=custom \
        --compress=9 \
        --no-owner \
        --no-privileges \
        --verbose \
        --file="$dump_file" 2> >(redact >&2); then
    warn "pg_dump failed for ${db_name}"
    SUMMARY+=("${db_name}|FAILED|pg_dump error")
    FAILED=1
    continue
  fi

  size_bytes="$(stat -c%s "$dump_file")"
  size_human="$(numfmt --to=iec-i --suffix=B "$size_bytes" 2>/dev/null || echo "${size_bytes}B")"

  # A "successful" pg_dump that produced almost nothing means an empty or wrong
  # database. 5 KB is far below a real dump of a Flyway-migrated schema.
  if (( size_bytes < 5120 )); then
    warn "${db_name} dump is only ${size_human} — suspiciously small, treating as failure."
    SUMMARY+=("${db_name}|FAILED|dump too small (${size_human})")
    FAILED=1
    continue
  fi

  # ── Verify ──
  # This is the step that distinguishes a backup from a file. pg_restore --list
  # parses the archive's table of contents; a truncated or corrupt archive fails
  # here even though pg_dump exited 0.
  log "Verifying archive integrity"
  toc_lines="$(pg_restore --list "$dump_file" 2>/dev/null | grep -c ';' || true)"
  if (( toc_lines < 5 )); then
    warn "${db_name} archive has an unreadable or near-empty table of contents."
    SUMMARY+=("${db_name}|FAILED|integrity check failed")
    FAILED=1
    continue
  fi
  ok "Archive readable — ${toc_lines} TOC entries, ${size_human}"

  # ── Checksum ──
  sha256sum "$dump_file" | awk '{print $1}' > "${dump_file}.sha256"
  checksum="$(cat "${dump_file}.sha256")"
  log "SHA-256 ${checksum:0:16}…"

  # ── Upload ──
  if [[ "$DRY_RUN" == true ]]; then
    ok "Dry run — not uploading"
    SUMMARY+=("${db_name}|DRY-RUN|${size_human}, ${toc_lines} TOC entries")
    continue
  fi

  base="$(basename "$dump_file")"
  upload_failed=0
  for tier in "${TIERS[@]}"; do
    key="${tier}/${RUN_DATE}/${base}"
    log "Uploading s3://${R2_BUCKET}/${key}"
    if ! r2_cp "$dump_file" "${key}"; then
      warn "Upload failed: ${key}"
      upload_failed=1
      continue
    fi
    if ! r2_cp "${dump_file}.sha256" "${key}.sha256"; then
      warn "Checksum sidecar upload failed: ${key}.sha256"
      upload_failed=1
    fi
    ok "Uploaded to ${tier}/"
  done

  if (( upload_failed )); then
    SUMMARY+=("${db_name}|FAILED|upload error")
    FAILED=1
  else
    SUMMARY+=("${db_name}|OK|${size_human}, ${toc_lines} TOC entries, tiers: ${TIERS[*]}")
  fi
done

# ── Report ──────────────────────────────────────────────────────────────────

echo
echo "=============================================================="
echo " Backup summary — ${RUN_STAMP}"
echo "=============================================================="
printf '%-14s %-9s %s\n' "DATABASE" "STATUS" "DETAIL"
for row in "${SUMMARY[@]}"; do
  IFS='|' read -r d s detail <<< "$row"
  printf '%-14s %-9s %s\n' "$d" "$s" "$detail"
done
echo

# A run where every database was skipped exits 0 without this guard, which
# would make a misconfigured schedule look healthy.
if [[ "${SUMMARY[*]}" != *"|OK|"* && "${SUMMARY[*]}" != *"|DRY-RUN|"* ]]; then
  die "No database was backed up successfully — check that the DATABASE_URL_* secrets are set."
fi

if (( FAILED )); then
  die "One or more databases failed to back up. See above."
fi

ok "All backups completed."
