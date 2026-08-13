#!/usr/bin/env bash
#
# restore-drill.sh — restore a backup into a scratch database, time it, and
# verify it is actually usable.
#
# ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
#
# scripts/backup-databases.sh proves a dump can be *written*. It says nothing
# about whether the dump can be *read back into a working database*. Those are
# different claims, and only the second one matters during an incident.
#
# This script produces the two things docs/DISASTER-RECOVERY.md cannot honestly
# state without it:
#
#   1. A measured restore time (RTO input), not an estimate.
#   2. Evidence the restored database is complete — schema version, row counts,
#      constraints, and the most recent row all present.
#
# ── SAFETY ──────────────────────────────────────────────────────────────────
#
# This script writes to a database. A restore aimed at the wrong target would
# destroy production, which is a worse outcome than having no drill at all.
# Four independent guards must all pass before pg_restore runs:
#
#   1. The target URL must not match any DATABASE_URL_* in the environment.
#   2. The target database name must start with `drill_`, unless
#      --allow-unsafe-target is passed explicitly.
#   3. The target host must not be in the production host denylist.
#   4. The target must contain no user tables, unless --recreate is passed.
#
# The script never writes to the source database and never deletes from R2.
# Read-only R2 credentials are sufficient and recommended.
#
# ── USAGE ───────────────────────────────────────────────────────────────────
#
#   # Full drill against the latest daily backup in R2
#   export R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=…
#   export DRILL_TARGET_URL='postgresql://postgres:pw@localhost:5432/drill_scratch'
#   ./scripts/restore-drill.sh --db paymentdb
#
#   # Drill from a dump you already have on disk (no R2 access needed)
#   ./scripts/restore-drill.sh --db paymentdb --dump-file ./paymentdb.dump
#
#   # All three databases, writing a dated record
#   ./scripts/restore-drill.sh --all --record-dir docs/drills
#
# Exit codes: 0 all drills verified · 1 a drill failed · 2 misuse/missing deps
#
set -uo pipefail

# ── Configuration ───────────────────────────────────────────────────────────

# Minimum Flyway version each database must reach for a restore to count as
# complete. Sourced from the migration files in the repo: bot V7, MSS V4,
# PMS V12. A restore that lands below these silently lost migrations.
# The lowest Flyway version a restored database must report to be considered
# usable. Set these to the highest migration currently in the repo for each
# database: a backup of a healthy production database should be at head, so
# anything lower means either the dump predates a deploy or the restore was
# partial. Both are worth failing the drill over.
#
# Keep in step with:
#   smartbot   spring-bot-manager-only/**/db/migration
#   machinedb  MachineStateService/**/db/migration
#   paymentdb  PaymentManagementService/**/db/migration
# scripts/test/restore-drill.test.sh asserts these stay in sync with the repo,
# so adding a migration without updating this map fails the tests.
declare -A MIN_FLYWAY_VERSION=(
  [smartbot]=7
  [machinedb]=4
  [paymentdb]=15
)

# Hosts that must never be a restore target, matched as substrings.
PROD_HOST_DENYLIST=(
  "supabase.co"
  "supabase.com"
  "railway.app"
  "rlwy.net"
  "neon.tech"
)

ALL_DATABASES=(smartbot machinedb paymentdb)

DB_LIST=()
DUMP_FILE=""
TIER="daily"
RECORD_DIR=""
UPLOAD_RECORD=false
RECREATE=false
ALLOW_UNSAFE_TARGET=false
KEEP_SCRATCH=false
JOBS="${DRILL_JOBS:-2}"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'
log()  { printf '%s[%s]%s %s\n' "$DIM" "$(date -u +%H:%M:%S)" "$RESET" "$*"; }
ok()   { printf '  %sOK%s   %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '  %sWARN%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
err()  { printf '  %sFAIL%s %s\n' "$RED" "$RESET" "$*" >&2; }
die()  { err "$*"; exit 2; }

# ── Argument parsing ────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db)                  DB_LIST+=("${2:?--db needs a database name}"); shift 2 ;;
    --all)                 DB_LIST=("${ALL_DATABASES[@]}"); shift ;;
    --dump-file)           DUMP_FILE="${2:?--dump-file needs a path}"; shift 2 ;;
    --tier)                TIER="${2:?--tier needs daily|weekly|monthly}"; shift 2 ;;
    --record-dir)          RECORD_DIR="${2:?--record-dir needs a path}"; shift 2 ;;
    --upload-record)       UPLOAD_RECORD=true; shift ;;
    --recreate)            RECREATE=true; shift ;;
    --allow-unsafe-target) ALLOW_UNSAFE_TARGET=true; shift ;;
    --keep-scratch)        KEEP_SCRATCH=true; shift ;;
    --jobs)                JOBS="${2:?--jobs needs a number}"; shift 2 ;;
    -h|--help)             sed -n '2,48p' "$0"; exit 0 ;;
    *)                     die "Unknown argument: $1 (try --help)" ;;
  esac
done

(( ${#DB_LIST[@]} )) || die "Nothing to do. Pass --db <name> or --all."

if [[ -n "$DUMP_FILE" && ${#DB_LIST[@]} -gt 1 ]]; then
  die "--dump-file restores one archive, so it cannot be combined with multiple databases."
fi

# Validate cheap, local preconditions before opening any network connection.
# Connecting first meant a typo'd --dump-file path was reported as a database
# connectivity failure, which sends you debugging the wrong thing.
if [[ -n "$DUMP_FILE" && ! -f "$DUMP_FILE" ]]; then
  die "No such dump file: ${DUMP_FILE}"
fi

[[ "$TIER" =~ ^(daily|weekly|monthly)$ ]] || die "--tier must be daily, weekly or monthly (got '$TIER')."

# ── Dependency check ────────────────────────────────────────────────────────

for tool in pg_restore psql sha256sum; do
  command -v "$tool" >/dev/null 2>&1 || die "Required tool '$tool' not found in PATH."
done

# The dump is written by pg_dump 17 in CI. pg_restore must be >= that, because
# newer archive format versions are not readable by older binaries. This is the
# single most common reason a restore fails at the worst possible moment.
RESTORE_MAJOR="$(pg_restore --version | grep -oE '[0-9]+' | head -1)"
if (( RESTORE_MAJOR < 17 )); then
  warn "pg_restore is version ${RESTORE_MAJOR}. Backups are produced with pg_dump 17."
  warn "An older pg_restore cannot read a newer archive. This drill may fail for"
  warn "reasons that have nothing to do with the backup itself."
fi

if [[ -z "$DUMP_FILE" ]]; then
  command -v aws >/dev/null 2>&1 || die "aws CLI is needed to fetch from R2. Install it, or pass --dump-file."
  for v in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
    [[ -n "${!v:-}" ]] || die "Environment variable $v is not set."
  done
fi

TARGET_URL="${DRILL_TARGET_URL:-}"
[[ -n "$TARGET_URL" ]] || die "DRILL_TARGET_URL is not set. It must point at a scratch database, never production."

# ── Target safety guards ────────────────────────────────────────────────────
#
# Each guard is independent on purpose. Any single one of them can be defeated
# by an unlucky configuration; all four together are hard to trip accidentally.

# Parsing these by hand is unpleasant but the alternative is a Python dependency
# in a disaster-recovery script, which is a worse trade. Note the ordering: the
# query string must be removed BEFORE taking the last path segment, otherwise a
# libpq socket URL such as
#   postgresql://user@/mydb?host=/var/run/postgresql&port=5432
# yields "postgresql&port=5432" as the database name. That bug caused Guard 2 to
# reject a perfectly valid scratch target during testing, so it is covered by
# scripts/test/restore-drill.test.sh.
url_dbname() {
  local u="$1"
  u="${u%%\?*}"        # drop query string first
  u="${u%%#*}"         # drop fragment
  u="${u#*://}"        # drop scheme
  u="${u#*@}"          # drop credentials
  printf '%s' "${u##*/}"
}
url_host() {
  local u="$1" q=""
  # A host given as a query parameter wins: that is how libpq addresses Unix
  # sockets, and in that form the authority section is empty.
  case "$u" in
    *\?*) q="${u#*\?}" ;;
  esac
  if [[ -n "$q" ]]; then
    local kv
    while IFS= read -r kv; do
      case "$kv" in
        host=*) printf '%s' "${kv#host=}"; return ;;
      esac
    done < <(printf '%s\n' "$q" | tr '&' '\n')
  fi
  u="${u%%\?*}"
  u="${u#*://}"
  u="${u#*@}"
  u="${u%%/*}"
  printf '%s' "${u%%:*}"
}

TARGET_DB="$(url_dbname "$TARGET_URL")"
TARGET_HOST="$(url_host "$TARGET_URL")"

# Guard 1 — the target must not be a configured production database.
for v in DATABASE_URL_SMARTBOT DATABASE_URL_MACHINEDB DATABASE_URL_PAYMENTDB DATABASE_URL; do
  if [[ -n "${!v:-}" && "${!v}" == "$TARGET_URL" ]]; then
    die "REFUSING TO RUN: DRILL_TARGET_URL is identical to $v. That is production."
  fi
done

# Guard 2 — scratch databases are named distinctively so a typo cannot land on
# a real database name.
if [[ "$TARGET_DB" != drill_* && "$ALLOW_UNSAFE_TARGET" != true ]]; then
  err "REFUSING TO RUN: target database '${TARGET_DB}' does not start with 'drill_'."
  err "Restoring into a database that is not obviously scratch risks destroying real data."
  err "Rename the target, or pass --allow-unsafe-target if you are certain."
  exit 2
fi

# Guard 3 — managed provider hostnames are where production actually lives.
for bad in "${PROD_HOST_DENYLIST[@]}"; do
  if [[ "$TARGET_HOST" == *"$bad"* && "$ALLOW_UNSAFE_TARGET" != true ]]; then
    err "REFUSING TO RUN: target host '${TARGET_HOST}' matches the production denylist ('${bad}')."
    err "Drills belong on a local or ephemeral database, not a managed production host."
    exit 2
  fi
done

psql_t() { psql --dbname="$TARGET_URL" -v ON_ERROR_STOP=1 -tAqc "$1" 2>/dev/null; }

psql_t "SELECT 1" >/dev/null || die "Cannot connect to the scratch database at ${TARGET_HOST}/${TARGET_DB}."
ok "Connected to scratch target ${TARGET_HOST}/${TARGET_DB}"

# ── Helpers ─────────────────────────────────────────────────────────────────

r2() {
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  AWS_DEFAULT_REGION=auto \
  aws s3api "$@" --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" --bucket "$R2_BUCKET"
}

human() {
  local b="$1"
  if   (( b >= 1048576 )); then printf '%dMiB' $(( b / 1048576 ))
  elif (( b >= 1024    )); then printf '%dKiB' $(( b / 1024 ))
  else printf '%dB' "$b"; fi
}

# Wall-clock seconds as a float.
#
# Deliberately NOT `date +%s%3N`: on the Ubuntu 26.04 coreutils this was written
# against, the field width in %3N is silently ignored and the full 9-digit
# nanosecond value is emitted, so `%s%3N` yields a 19-digit number and every
# measured duration comes out roughly a thousand times too large. The first test
# run reported a 0.1s restore as "61393.7s". Bash's EPOCHREALTIME is exact and
# needs no subprocess; `date +%s.%N` is the fallback for bash < 5.
#
# The comma substitution matters: EPOCHREALTIME is locale-formatted, so under a
# German locale (this project's primary one) it returns "1786647890,743084" and
# awk would otherwise truncate at the comma.
now_s() {
  if [[ -n "${EPOCHREALTIME:-}" ]]; then printf '%s' "${EPOCHREALTIME/,/.}"
  else date +%s.%N; fi
}
elapsed() { awk -v a="$1" -v b="$2" 'BEGIN{d=b-a; if(d<0)d=0; printf "%.1f",d}'; }

# ── Per-database drill ──────────────────────────────────────────────────────

RESULTS=()
FAILED=0

for db in "${DB_LIST[@]}"; do
  printf '\n%s── %s ─────────────────────────────────────────%s\n' "$BOLD" "$db" "$RESET"

  dump_path=""
  dl_secs="n/a"
  source_key="local file"

  # ── Obtain the archive ──
  if [[ -n "$DUMP_FILE" ]]; then
    [[ -f "$DUMP_FILE" ]] || { err "No such dump file: $DUMP_FILE"; RESULTS+=("${db}|FAILED|dump file missing"); FAILED=1; continue; }
    dump_path="$DUMP_FILE"
    source_key="$(basename "$DUMP_FILE")"
    log "Using local archive ${source_key}"
  else
    log "Locating the newest ${TIER} backup for ${db}"
    # Keys look like: daily/2026-08-13/paymentdb-2026-08-13T023045Z.dump
    latest_key="$(r2 list-objects-v2 --prefix "${TIER}/" --query 'Contents[].Key' --output text 2>/dev/null \
                  | tr '\t' '\n' | grep -E "/${db}-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z\.dump$" | sort | tail -1)"
    if [[ -z "$latest_key" ]]; then
      err "No ${TIER} backup found for ${db}. Has scripts/backup-databases.sh run yet?"
      RESULTS+=("${db}|FAILED|no backup found in ${TIER}/")
      FAILED=1
      continue
    fi
    source_key="$latest_key"
    log "Found s3://${R2_BUCKET}/${latest_key}"

    dump_path="${WORKDIR}/$(basename "$latest_key")"
    dl_start="$(now_s)"
    if ! r2 get-object --key "$latest_key" "$dump_path" >/dev/null 2>&1; then
      err "Download failed for ${latest_key}"
      RESULTS+=("${db}|FAILED|download failed")
      FAILED=1
      continue
    fi
    dl_secs="$(elapsed "$dl_start" "$(now_s)")"
    ok "Downloaded in ${dl_secs}s"

    # ── Checksum against the sidecar written at backup time ──
    if r2 get-object --key "${latest_key}.sha256" "${dump_path}.sha256" >/dev/null 2>&1; then
      expected="$(tr -d '[:space:]' < "${dump_path}.sha256")"
      actual="$(sha256sum "$dump_path" | awk '{print $1}')"
      if [[ "$expected" != "$actual" ]]; then
        err "CHECKSUM MISMATCH — the archive in R2 is corrupt or was modified."
        err "  expected ${expected:0:16}…  got ${actual:0:16}…"
        RESULTS+=("${db}|FAILED|checksum mismatch")
        FAILED=1
        continue
      fi
      ok "SHA-256 matches sidecar (${actual:0:16}…)"
    else
      warn "No .sha256 sidecar for this object; integrity not independently confirmed."
    fi
  fi

  size_bytes="$(stat -c %s "$dump_path" 2>/dev/null || echo 0)"

  # ── Readability before touching the target ──
  toc_count="$(pg_restore --list "$dump_path" 2>/dev/null | grep -c ';' || true)"
  if (( toc_count < 5 )); then
    err "Archive table of contents is unreadable or near-empty (${toc_count} entries)."
    RESULTS+=("${db}|FAILED|unreadable archive")
    FAILED=1
    continue
  fi
  ok "Archive readable — ${toc_count} TOC entries, $(human "$size_bytes")"

  # ── Guard 4 — refuse to overwrite a non-empty target ──
  existing="$(psql_t "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")"
  existing="${existing:-0}"
  if (( existing > 0 )); then
    if [[ "$RECREATE" != true ]]; then
      err "Scratch database already holds ${existing} table(s). Refusing to restore over it."
      err "Pass --recreate to drop and rebuild the public schema first."
      RESULTS+=("${db}|FAILED|target not empty")
      FAILED=1
      continue
    fi
    log "Resetting scratch schema (--recreate)"
    psql --dbname="$TARGET_URL" -v ON_ERROR_STOP=1 -qc \
      "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null \
      || { err "Could not reset the scratch schema."; RESULTS+=("${db}|FAILED|schema reset failed"); FAILED=1; continue; }
  fi

  # ── The restore itself — this is the number that matters ──
  log "Restoring with ${JOBS} parallel job(s)"
  restore_log="${WORKDIR}/${db}-restore.log"
  rs_start="$(now_s)"
  pg_restore --dbname="$TARGET_URL" --no-owner --no-privileges \
             --jobs="$JOBS" --exit-on-error "$dump_path" >"$restore_log" 2>&1
  restore_rc=$?
  rs_secs="$(elapsed "$rs_start" "$(now_s)")"

  if (( restore_rc != 0 )); then
    err "pg_restore exited ${restore_rc} after ${rs_secs}s. Last lines:"
    tail -12 "$restore_log" | sed 's/^/        /' >&2
    RESULTS+=("${db}|FAILED|pg_restore rc=${restore_rc}")
    FAILED=1
    continue
  fi
  ok "Restore completed in ${rs_secs}s"

  # ── Verification — a restore that "succeeds" but loses data is still a loss ──
  vf_start="$(now_s)"
  problems=()

  table_count="$(psql_t "SELECT count(*) FROM pg_tables WHERE schemaname='public'")"
  table_count="${table_count:-0}"
  (( table_count > 0 )) || problems+=("no tables in public schema")

  # Flyway version: the authoritative statement of "which migrations are here".
  flyway_version="absent"
  has_flyway="$(psql_t "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='flyway_schema_history'")"
  if [[ "${has_flyway:-0}" == "1" ]]; then
    flyway_version="$(psql_t "SELECT coalesce(max(version::numeric)::text,'none') FROM flyway_schema_history WHERE success")"
    min="${MIN_FLYWAY_VERSION[$db]:-0}"
    if [[ "$flyway_version" == "none" ]]; then
      problems+=("flyway_schema_history has no successful migrations")
    elif awk -v v="$flyway_version" -v m="$min" 'BEGIN{exit !(v < m)}'; then
      problems+=("flyway version ${flyway_version} is below the expected minimum ${min}")
    fi
    failed_migrations="$(psql_t "SELECT count(*) FROM flyway_schema_history WHERE NOT success")"
    (( ${failed_migrations:-0} == 0 )) || problems+=("${failed_migrations} failed migration(s) recorded")
  else
    problems+=("flyway_schema_history table is missing")
  fi

  # Constraints and indexes are part of a working database, not decoration.
  index_count="$(psql_t "SELECT count(*) FROM pg_indexes WHERE schemaname='public'")"
  constraint_count="$(psql_t "SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'")"
  (( ${index_count:-0} > 0 )) || problems+=("no indexes restored")

  # Total live rows across the public schema, plus the largest tables, so the
  # record shows whether data actually arrived rather than just schema.
  total_rows="$(psql_t "
    SELECT coalesce(sum(n_live_tup),0) FROM pg_stat_user_tables")"
  total_rows="${total_rows:-0}"
  # pg_stat counters are populated by ANALYZE; force it so counts are truthful.
  psql --dbname="$TARGET_URL" -qc "ANALYZE" >/dev/null 2>&1 || true
  total_rows="$(psql_t "SELECT coalesce(sum(n_live_tup),0) FROM pg_stat_user_tables")"
  total_rows="${total_rows:-0}"
  (( total_rows > 0 )) || problems+=("restored database contains zero rows")

  top_tables="$(psql_t "
    SELECT string_agg(relname||'='||n_live_tup, ', ' ORDER BY n_live_tup DESC)
    FROM (SELECT relname, n_live_tup FROM pg_stat_user_tables
          ORDER BY n_live_tup DESC LIMIT 5) t")"

  # Freshness: the newest timestamp anywhere is the real RPO evidence. Without
  # this, a restore of a month-old dump looks identical to a restore of
  # last night's.
  newest_row="unknown"
  ts_col="$(psql_t "
    SELECT c.table_name||'.'||c.column_name
    FROM information_schema.columns c
    JOIN pg_tables t ON t.tablename=c.table_name AND t.schemaname='public'
    WHERE c.table_schema='public'
      AND c.data_type IN ('timestamp with time zone','timestamp without time zone')
      AND c.column_name IN ('created_at','createdat','created_on','inserted_at','timestamp')
    ORDER BY 1 LIMIT 1")"
  if [[ -n "$ts_col" ]]; then
    tbl="${ts_col%%.*}"; col="${ts_col##*.}"
    newest_row="$(psql_t "SELECT coalesce(max(\"${col}\")::text,'empty') FROM \"${tbl}\"")"
    age_hours="$(psql_t "SELECT round(extract(epoch from (now() - max(\"${col}\")))/3600.0, 1) FROM \"${tbl}\"")"
    if [[ -n "$age_hours" ]] && awk -v a="$age_hours" 'BEGIN{exit !(a > 48)}'; then
      problems+=("newest row in ${ts_col} is ${age_hours}h old, beyond the 24h RPO plus margin")
    fi
  fi

  vf_secs="$(elapsed "$vf_start" "$(now_s)")"
  total_secs="$(awk -v a="${dl_secs/n\/a/0}" -v b="$rs_secs" -v c="$vf_secs" 'BEGIN{printf "%.1f",a+b+c}')"

  printf '        %-22s %s\n' "tables"        "${table_count}"
  printf '        %-22s %s\n' "indexes"       "${index_count:-0}"
  printf '        %-22s %s\n' "constraints"   "${constraint_count:-0}"
  printf '        %-22s %s\n' "flyway version" "${flyway_version}"
  printf '        %-22s %s\n' "total rows"    "${total_rows}"
  printf '        %-22s %s\n' "largest tables" "${top_tables:-n/a}"
  printf '        %-22s %s\n' "newest row"    "${newest_row}"
  printf '        %-22s download %ss · restore %ss · verify %ss\n' "timings" "$dl_secs" "$rs_secs" "$vf_secs"

  if (( ${#problems[@]} > 0 )); then
    err "Restore completed but verification found ${#problems[@]} problem(s):"
    for p in "${problems[@]}"; do err "  · $p"; done
    RESULTS+=("${db}|FAILED|${problems[0]}")
    FAILED=1
  else
    ok "Verification passed — restore is usable"
    RESULTS+=("${db}|VERIFIED|restore ${rs_secs}s, ${total_rows} rows, flyway ${flyway_version}")
  fi

  # ── Machine-readable record ──
  if [[ -n "$RECORD_DIR" ]]; then
    mkdir -p "$RECORD_DIR"
    rec="${RECORD_DIR}/$(date -u +%Y-%m-%d)-${db}.json"
    problems_json="$(printf '%s\n' "${problems[@]:-}" | awk 'NF' | sed 's/"/\\"/g' | awk '{printf "%s\"%s\"", (NR>1?",":""), $0}')"
    cat > "$rec" <<EOF
{
  "drill_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "database": "${db}",
  "source_key": "${source_key}",
  "tier": "${TIER}",
  "archive_bytes": ${size_bytes},
  "toc_entries": ${toc_count},
  "outcome": "$( (( ${#problems[@]} > 0 )) && echo FAILED || echo VERIFIED )",
  "seconds": { "download": "${dl_secs}", "restore": ${rs_secs}, "verify": ${vf_secs}, "total": ${total_secs} },
  "verified": {
    "tables": ${table_count},
    "indexes": ${index_count:-0},
    "constraints": ${constraint_count:-0},
    "flyway_version": "${flyway_version}",
    "total_rows": ${total_rows},
    "newest_row": "${newest_row}"
  },
  "problems": [${problems_json}],
  "pg_restore_version": "${RESTORE_MAJOR}"
}
EOF
    log "Record written to ${rec}"
    if [[ "$UPLOAD_RECORD" == true && -z "$DUMP_FILE" ]]; then
      r2 put-object --key "restore-drill/$(basename "$rec")" --body "$rec" \
        --content-type application/json >/dev/null 2>&1 \
        && ok "Record uploaded to restore-drill/" \
        || warn "Record upload failed (drill result itself is unaffected)"
    fi
  fi

  # ── Leave the scratch database clean for the next database in the loop ──
  if [[ "$KEEP_SCRATCH" != true ]]; then
    psql --dbname="$TARGET_URL" -qc "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null 2>&1 \
      && log "Scratch schema reset" \
      || warn "Could not reset scratch schema after the drill"
  fi
done

# ── Summary ─────────────────────────────────────────────────────────────────

printf '\n%s' "$BOLD"
printf '==============================================================\n'
printf ' Restore drill — %s\n' "$(date -u +%Y-%m-%dT%H%M%SZ)"
printf '==============================================================%s\n' "$RESET"
printf '%-14s %-9s %s\n' "DATABASE" "OUTCOME" "DETAIL"
for r in "${RESULTS[@]}"; do
  IFS='|' read -r n s d <<<"$r"
  printf '%-14s %-9s %s\n' "$n" "$s" "$d"
done
printf '\n'

if (( FAILED )); then
  err "At least one drill failed. The backups cannot be relied on until this is resolved."
  err "Do not record an RTO from a failed drill."
  exit 1
fi

ok "All drills verified."
printf '%sTranscribe the restore times into docs/DISASTER-RECOVERY.md §2 and date the entry.%s\n' "$DIM" "$RESET"
exit 0
