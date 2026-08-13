#!/usr/bin/env bash
#
# Tests for scripts/restore-drill.sh
#
# A verification script that never fails its own checks is decoration. These
# tests deliberately feed the drill broken archives, stale data and dangerous
# targets, and assert that it says no.
#
# Two groups:
#
#   UNIT   — URL parsing and target guards. No database needed. Always run.
#   LIVE   — real pg_restore into a real scratch database. Requires
#            DRILL_TEST_ADMIN_URL to point at a Postgres superuser connection
#            where the harness may create and drop `drill_selftest`.
#            Skipped, not failed, when unavailable.
#
# Usage:
#   ./scripts/test/restore-drill.test.sh
#   DRILL_TEST_ADMIN_URL='postgresql://postgres@localhost:5432/postgres' \
#     ./scripts/test/restore-drill.test.sh
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DRILL="${SCRIPT_DIR}/scripts/restore-drill.sh"
[[ -x "$DRILL" ]] || { echo "Cannot find executable ${DRILL}"; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# A real, non-empty placeholder archive. The guard and argument tests must reach
# the code under test, so they need a path that passes the early "does this file
# exist" check. /dev/null is NOT usable here: it is a character device, so `-f`
# is false and the drill correctly rejects it before any guard runs.
PLACEHOLDER="${TMP}/placeholder.dump"
printf 'placeholder-not-a-real-archive' > "$PLACEHOLDER"

PASS=0; FAIL=0; SKIP=0
GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'

pass() { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; PASS=$((PASS+1)); }
fail() { printf '  %s✗%s %s\n' "$RED" "$RESET" "$1"; [[ -n "${2:-}" ]] && printf '      %s\n' "$2"; FAIL=$((FAIL+1)); }
skip() { printf '  %s−%s %s %s(%s)%s\n' "$YELLOW" "$RESET" "$1" "$DIM" "${2:-skipped}" "$RESET"; SKIP=$((SKIP+1)); }
group(){ printf '\n%s%s%s\n' "$BOLD" "$1" "$RESET"; }

# assert_exit <expected_code> <description> <command...>
assert_exit() {
  local want="$1" desc="$2"; shift 2
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  if [[ "$rc" == "$want" ]]; then pass "$desc"
  else fail "$desc" "expected exit ${want}, got ${rc}: $(printf '%s' "$out" | tr -d '\033' | grep -iE 'fail|error|refus' | head -2 | tr '\n' ' ')"; fi
}

# assert_output <regex> <description> <command...>
assert_output() {
  local want="$1" desc="$2"; shift 2
  local out
  out="$("$@" 2>&1 | sed 's/\x1b\[[0-9;]*m//g')"
  if grep -qiE "$want" <<<"$out"; then pass "$desc"
  else fail "$desc" "output did not match /${want}/: $(printf '%s' "$out" | tail -3 | tr '\n' ' ')"; fi
}

# ────────────────────────────────────────────────────────────────────────────
group "UNIT — argument handling"

assert_exit 2 "no database selected is rejected" \
  env DRILL_TARGET_URL='postgresql://u@h/drill_x' bash "$DRILL"

assert_exit 2 "unknown flag is rejected" \
  env DRILL_TARGET_URL='postgresql://u@h/drill_x' bash "$DRILL" --db paymentdb --wat

assert_exit 2 "invalid --tier is rejected" \
  env DRILL_TARGET_URL='postgresql://u@h/drill_x' bash "$DRILL" --db paymentdb --tier hourly

assert_exit 2 "missing DRILL_TARGET_URL is rejected" \
  env -u DRILL_TARGET_URL bash "$DRILL" --db paymentdb --dump-file "$PLACEHOLDER"

assert_output "cannot be combined" "--dump-file with --all is rejected" \
  env DRILL_TARGET_URL='postgresql://u@h/drill_x' bash "$DRILL" --all --dump-file "$PLACEHOLDER"

# ────────────────────────────────────────────────────────────────────────────
group "UNIT — target safety guards"

# Guard 1: identical to a configured production URL.
assert_output "identical to DATABASE_URL_PAYMENTDB" "guard 1 refuses a target equal to a production URL" \
  env DRILL_TARGET_URL='postgresql://u@prod/drill_x' \
      DATABASE_URL_PAYMENTDB='postgresql://u@prod/drill_x' \
      bash "$DRILL" --db paymentdb --dump-file "$PLACEHOLDER"

# Guard 2: name must be obviously scratch.
assert_output "does not start with 'drill_'" "guard 2 refuses a non-scratch database name" \
  env DRILL_TARGET_URL='postgresql://u@localhost/paymentdb' \
      bash "$DRILL" --db paymentdb --dump-file "$PLACEHOLDER"

assert_exit 2 "guard 2 exits 2 on a non-scratch name" \
  env DRILL_TARGET_URL='postgresql://u@localhost/paymentdb' \
      bash "$DRILL" --db paymentdb --dump-file "$PLACEHOLDER"

# Guard 3: managed production hosts.
for host in "db.abcdefgh.supabase.co" "containers-us-west-1.railway.app" "ep-cool-x.neon.tech"; do
  assert_output "production denylist" "guard 3 refuses host ${host}" \
    env DRILL_TARGET_URL="postgresql://u@${host}/drill_scratch" \
        bash "$DRILL" --db paymentdb --dump-file "$PLACEHOLDER"
done

# Guard 3 must not fire on a legitimate local target. It should get PAST the
# guards and fail later, on connectivity — a different error entirely.
assert_output "cannot connect" "guards pass for a plainly local target" \
  env DRILL_TARGET_URL='postgresql://u@127.0.0.1:1/drill_scratch' \
      bash "$DRILL" --db paymentdb --dump-file "$PLACEHOLDER"

# --allow-unsafe-target must defeat guards 2 and 3, and only those.
assert_output "cannot connect" "--allow-unsafe-target bypasses the name guard" \
  env DRILL_TARGET_URL='postgresql://u@127.0.0.1:1/paymentdb' \
      bash "$DRILL" --db paymentdb --dump-file "$PLACEHOLDER" --allow-unsafe-target

# ...but must NOT defeat guard 1. Overriding a naming convention is a judgement
# call; restoring onto the configured production URL never is.
assert_output "identical to DATABASE_URL_PAYMENTDB" "--allow-unsafe-target does NOT bypass guard 1" \
  env DRILL_TARGET_URL='postgresql://u@prod/paymentdb' \
      DATABASE_URL_PAYMENTDB='postgresql://u@prod/paymentdb' \
      bash "$DRILL" --db paymentdb --dump-file "$PLACEHOLDER" --allow-unsafe-target

# ────────────────────────────────────────────────────────────────────────────
group "UNIT — Flyway minimums match the repo"

# The drill only catches a partial or stale restore if MIN_FLYWAY_VERSION is
# kept at the current migration head. It had already drifted once (paymentdb was
# pinned at 12 while migrations had reached 15), which would have let a restore
# missing three migrations pass as VERIFIED. This test makes that drift fail
# loudly instead.
declare -A MIGRATION_DIR=(
  [smartbot]=spring-bot-manager-only
  [machinedb]=MachineStateService
  [paymentdb]=PaymentManagementService
)

repo_head_version() {
  find "${SCRIPT_DIR}/$1" -path '*db/migration*' -name 'V*.sql' -printf '%f\n' 2>/dev/null \
    | sed 's/^V//; s/__.*//' | sort -n | tail -1
}

declared_min() {
  sed -n '/declare -A MIN_FLYWAY_VERSION=(/,/^)/p' "${DRILL}" \
    | sed -n "s/.*\[$1\]=\([0-9]*\).*/\1/p"
}

for db in smartbot machinedb paymentdb; do
  head_v="$(repo_head_version "${MIGRATION_DIR[$db]}")"
  decl_v="$(declared_min "$db")"
  if [[ -z "$head_v" ]]; then
    skip "cannot locate migrations for ${db}"
  elif [[ "$decl_v" == "$head_v" ]]; then
    pass "${db} minimum (${decl_v}) matches migration head (${head_v})"
  else
    fail "${db} minimum is ${decl_v} but the repo migration head is ${head_v}" \
         "update MIN_FLYWAY_VERSION in scripts/restore-drill.sh"
  fi
done

group "UNIT — URL parsing (regression: libpq socket URLs)"

# These exercise the exact bug found in testing: taking the last path segment
# before stripping the query string turned a valid scratch target into
# "sock&port=5599" and tripped guard 2.
url_probe() {
  # Run the drill far enough to print the target it parsed, then read it back.
  env DRILL_TARGET_URL="$1" bash "$DRILL" --db paymentdb --dump-file "$PLACEHOLDER" 2>&1 \
    | sed 's/\x1b\[[0-9;]*m//g'
}

assert_output "127\.0\.0\.1/drill_scratch" "plain TCP URL parses host and dbname" \
  url_probe 'postgresql://user:pw@127.0.0.1:5432/drill_scratch'

assert_output "drill_scratch" "socket URL with ?host= keeps the right dbname" \
  url_probe 'postgresql://postgres@/drill_scratch?host=/tmp/pgtest/sock&port=5599'

assert_output "drill_scratch" "URL with several query params keeps the right dbname" \
  url_probe 'postgresql://u:p@127.0.0.1:5432/drill_scratch?sslmode=require&connect_timeout=5'

# A socket path must not be mistaken for a denylisted host, and a query-string
# host must still be checked against the denylist.
assert_output "production denylist" "?host= form is still denylist-checked" \
  url_probe 'postgresql://u@/drill_scratch?host=db.xyz.supabase.co'

# ────────────────────────────────────────────────────────────────────────────
group "UNIT — archive handling without a database"

echo "not a postgres archive" > "$TMP/garbage.dump"
assert_output "cannot connect|unreadable|table of contents" "a non-archive file is not silently accepted" \
  env DRILL_TARGET_URL='postgresql://u@127.0.0.1:1/drill_scratch' \
      bash "$DRILL" --db paymentdb --dump-file "$TMP/garbage.dump"

assert_output "no such dump file" "a missing dump file is reported" \
  env DRILL_TARGET_URL='postgresql://u@127.0.0.1:1/drill_scratch' \
      bash "$DRILL" --db paymentdb --dump-file "$TMP/does-not-exist.dump"

# ────────────────────────────────────────────────────────────────────────────
# LIVE tests
# ────────────────────────────────────────────────────────────────────────────
group "LIVE — real restore into a real database"

if [[ -z "${DRILL_TEST_ADMIN_URL:-}" ]] || ! command -v psql >/dev/null 2>&1 || ! command -v pg_dump >/dev/null 2>&1; then
  skip "live restore drill" "set DRILL_TEST_ADMIN_URL and install pg_dump/psql/pg_restore"
  skip "detects a dump with no flyway history"
  skip "detects a flyway version below the required minimum"
  skip "detects stale data beyond the RPO"
  skip "detects a truncated archive"
  skip "refuses to overwrite a non-empty target"
  skip "--recreate allows reuse of a non-empty target"
  skip "writes a JSON record with measured timings"
else
  ADMIN="$DRILL_TEST_ADMIN_URL"
  psqlq() { psql --dbname="$ADMIN" -v ON_ERROR_STOP=1 -tAqc "$1" >/dev/null 2>&1; }

  # Build the scratch target and a source database to dump from.
  psqlq "DROP DATABASE IF EXISTS drill_selftest" || true
  psqlq "DROP DATABASE IF EXISTS drill_selftest_src" || true
  if ! psqlq "CREATE DATABASE drill_selftest" || ! psqlq "CREATE DATABASE drill_selftest_src"; then
    skip "live restore drill" "could not create scratch databases via DRILL_TEST_ADMIN_URL"
  else
    # Derive per-database URLs from the admin URL by swapping the dbname,
    # preserving any query string (socket host, sslmode, ...).
    swap_db() {
      local u="$1" newdb="$2" q=""
      case "$u" in *\?*) q="?${u#*\?}"; u="${u%%\?*}" ;; esac
      printf '%s/%s%s' "${u%/*}" "$newdb" "$q"
    }
    TARGET="$(swap_db "$ADMIN" drill_selftest)"
    SRC="$(swap_db "$ADMIN" drill_selftest_src)"

    mkfixture() {
      # $1 = flyway max version ("none" for no flyway table), $2 = row age days,
      # $3 = output dump path
      local fv="$1" age="$2" out="$3"
      psql --dbname="$SRC" -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<SQL
DROP SCHEMA public CASCADE; CREATE SCHEMA public;
CREATE TABLE payments (
  id bigserial PRIMARY KEY,
  tx_reference varchar(64) NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL,
  CONSTRAINT uq_tx UNIQUE (tx_reference)
);
CREATE INDEX idx_payments_created ON payments (created_at DESC);
INSERT INTO payments (tx_reference, amount_minor, created_at)
SELECT 'TX-'||g, 500+g, now() - ('${age} days')::interval
FROM generate_series(1,500) g;
SQL
      if [[ "$fv" != "none" ]]; then
        psql --dbname="$SRC" -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<SQL
CREATE TABLE flyway_schema_history (
  installed_rank integer PRIMARY KEY, version varchar(50),
  description varchar(200) NOT NULL, type varchar(20) NOT NULL,
  script varchar(1000) NOT NULL, checksum integer,
  installed_by varchar(100) NOT NULL,
  installed_on timestamp NOT NULL DEFAULT now(),
  execution_time integer NOT NULL, success boolean NOT NULL
);
INSERT INTO flyway_schema_history VALUES
  (1,'${fv}','test','SQL','V${fv}__test.sql',1,'t',now(),1,true);
SQL
      fi
      pg_dump --dbname="$SRC" --format=custom --compress=9 --no-owner --no-privileges -f "$out" 2>/dev/null
    }

    run_drill() {
      env DRILL_TARGET_URL="$TARGET" bash "$DRILL" --db paymentdb "$@" 2>&1 | sed 's/\x1b\[[0-9;]*m//g'
    }

    # ── Happy path ──
    # Derived from the drill's own declared minimum rather than hardcoded: when
    # paymentdb's minimum moved from 12 to 15, a hardcoded 12 here turned the
    # happy-path test into a failing one for the wrong reason.
    GOOD_FV="$(declared_min paymentdb)"
    [[ -n "$GOOD_FV" ]] || GOOD_FV=15
    mkfixture "$GOOD_FV" 0 "$TMP/good.dump"
    out="$(run_drill --dump-file "$TMP/good.dump")"
    if grep -q "Verification passed" <<<"$out"; then pass "live restore drill verifies a good archive"
    else fail "live restore drill verifies a good archive" "$(tail -3 <<<"$out" | tr '\n' ' ')"; fi

    # Restore time must be a plausible number, not the 61393s the broken clock
    # produced before EPOCHREALTIME replaced date +%s%3N.
    rs="$(grep -oE 'Restore completed in [0-9.]+s' <<<"$out" | grep -oE '[0-9.]+' | head -1)"
    if [[ -n "$rs" ]] && awk -v v="$rs" 'BEGIN{exit !(v >= 0 && v < 600)}'; then
      pass "measured restore time is plausible (${rs}s)"
    else
      fail "measured restore time is plausible" "got '${rs}'"
    fi

    # ── Missing flyway history ──
    mkfixture none 0 "$TMP/noflyway.dump"
    out="$(run_drill --dump-file "$TMP/noflyway.dump")"
    if grep -q "flyway_schema_history table is missing" <<<"$out" && ! grep -q "Verification passed" <<<"$out"; then
      pass "detects a dump with no flyway history"
    else fail "detects a dump with no flyway history" "$(tail -3 <<<"$out" | tr '\n' ' ')"; fi

    # ── Flyway below the declared minimum for paymentdb ──
    mkfixture 3 0 "$TMP/oldflyway.dump"
    out="$(run_drill --dump-file "$TMP/oldflyway.dump")"
    if grep -qE "below the expected minimum" <<<"$out"; then pass "detects a flyway version below the required minimum"
    else fail "detects a flyway version below the required minimum" "$(tail -3 <<<"$out" | tr '\n' ' ')"; fi

    # ── Stale data: a month-old dump must not pass a 24h RPO ──
    mkfixture "$GOOD_FV" 30 "$TMP/stale.dump"
    out="$(run_drill --dump-file "$TMP/stale.dump")"
    if grep -qE "beyond the 24h RPO" <<<"$out"; then pass "detects stale data beyond the RPO"
    else fail "detects stale data beyond the RPO" "$(tail -3 <<<"$out" | tr '\n' ' ')"; fi

    # ── Truncated archive ──
    head -c 4096 "$TMP/good.dump" > "$TMP/truncated.dump"
    out="$(run_drill --dump-file "$TMP/truncated.dump")"
    if ! grep -q "Verification passed" <<<"$out"; then pass "detects a truncated archive"
    else fail "detects a truncated archive" "a truncated dump was accepted"; fi

    # ── Non-empty target ──
    psql --dbname="$TARGET" -q -c "CREATE TABLE leftover(x int)" >/dev/null 2>&1
    out="$(run_drill --dump-file "$TMP/good.dump")"
    if grep -qE "Refusing to restore over it" <<<"$out"; then pass "refuses to overwrite a non-empty target"
    else fail "refuses to overwrite a non-empty target" "$(tail -3 <<<"$out" | tr '\n' ' ')"; fi

    out="$(run_drill --dump-file "$TMP/good.dump" --recreate)"
    if grep -q "Verification passed" <<<"$out"; then pass "--recreate allows reuse of a non-empty target"
    else fail "--recreate allows reuse of a non-empty target" "$(tail -3 <<<"$out" | tr '\n' ' ')"; fi

    # ── JSON record ──
    rm -rf "$TMP/records"
    run_drill --dump-file "$TMP/good.dump" --record-dir "$TMP/records" >/dev/null 2>&1
    rec="$(find "$TMP/records" -name '*paymentdb.json' 2>/dev/null | head -1)"
    if [[ -n "$rec" ]] && python3 -c "
import json,sys
d=json.load(open('$rec'))
assert d['outcome']=='VERIFIED', d['outcome']
assert d['database']=='paymentdb'
assert float(d['seconds']['restore'])>=0
assert d['verified']['total_rows']>0
assert d['problems']==[]
" 2>/dev/null; then
      pass "writes a JSON record with measured timings"
    else
      fail "writes a JSON record with measured timings" "${rec:-no record written}"
    fi

    # A failed drill must be recorded as FAILED, not quietly as verified.
    rm -rf "$TMP/records2"
    run_drill --dump-file "$TMP/stale.dump" --recreate --record-dir "$TMP/records2" >/dev/null 2>&1
    rec2="$(find "$TMP/records2" -name '*paymentdb.json' 2>/dev/null | head -1)"
    if [[ -n "$rec2" ]] && python3 -c "
import json
d=json.load(open('$rec2'))
assert d['outcome']=='FAILED', d['outcome']
assert len(d['problems'])>0, d['problems']
" 2>/dev/null; then
      pass "records a failed drill as FAILED with problems listed"
    else
      fail "records a failed drill as FAILED with problems listed" "${rec2:-no record}"
    fi

    # Exit code must be non-zero on a failed drill so CI actually goes red.
    env DRILL_TARGET_URL="$TARGET" bash "$DRILL" --db paymentdb \
        --dump-file "$TMP/stale.dump" --recreate >/dev/null 2>&1
    if (( $? != 0 )); then pass "exits non-zero when a drill fails"
    else fail "exits non-zero when a drill fails" "exit was 0"; fi

    psqlq "DROP DATABASE IF EXISTS drill_selftest" || true
    psqlq "DROP DATABASE IF EXISTS drill_selftest_src" || true
  fi
fi

# ────────────────────────────────────────────────────────────────────────────
printf '\n%s' "$BOLD"
printf '==============================================================\n'
printf ' %d passed · %d failed · %d skipped\n' "$PASS" "$FAIL" "$SKIP"
printf '==============================================================%s\n' "$RESET"
(( FAIL == 0 )) || exit 1
exit 0
