#!/usr/bin/env bash
#
# Tests for scripts/backup-databases.sh
#
# Runs the real script against STUBBED pg_dump / pg_restore / aws binaries
# placed ahead of the real ones on PATH. This exercises the parts we actually
# wrote — preflight, integrity gating, retention-tier selection, retry, summary
# and exit codes — without needing a live PostgreSQL server or R2 credentials.
#
# What this does NOT prove: that pg_dump can talk to Supabase, or that the R2
# credentials work. Those are covered by the first real scheduled run and by the
# restore drill (R3).
#
#   ./scripts/test/backup-databases.test.sh
#
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${SCRIPT_DIR}/backup-databases.sh"
[[ -x "$TARGET" ]] || { echo "FAIL: ${TARGET} not executable"; exit 1; }

PASS=0; FAIL=0
GREEN=$'\033[32m'; RED=$'\033[31m'; RESET=$'\033[0m'
[[ -t 1 ]] || { GREEN=""; RED=""; RESET=""; }

pass() { printf '%s  PASS%s %s\n' "$GREEN" "$RESET" "$1"; PASS=$((PASS+1)); }
fail() { printf '%s  FAIL%s %s\n' "$RED" "$RESET" "$1"; FAIL=$((FAIL+1)); }

check() { # name, expected-substring, actual
  if [[ "$3" == *"$2"* ]]; then pass "$1"; else
    fail "$1 — expected to find: $2"
    printf '        actual output:\n%s\n' "$(echo "$3" | sed 's/^/        | /' | tail -25)"
  fi
}

# ── Stub factory ────────────────────────────────────────────────────────────
# MODE controls stub behaviour, so one harness covers every scenario.

make_stubs() {
  local bin="$1"
  mkdir -p "$bin"

  cat > "${bin}/pg_dump" <<'STUB'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then echo "pg_dump (PostgreSQL) 17.2"; exit 0; fi
out=""; for a in "$@"; do case "$a" in --file=*) out="${a#--file=}";; esac; done
case "${MODE:-good}" in
  dump-fails) echo "pg_dump: error: connection to server failed" >&2; exit 1 ;;
  tiny)       head -c 100 /dev/zero | tr '\0' 'x' > "$out" ;;
  *)          head -c 20000 /dev/zero | tr '\0' 'D' > "$out" ;;
esac
exit 0
STUB

  cat > "${bin}/pg_restore" <<'STUB'
#!/usr/bin/env bash
if [[ "${1:-}" == "--list" ]]; then
  case "${MODE:-good}" in
    corrupt) echo "pg_restore: error: did not find magic string" >&2; exit 1 ;;
    *) for i in $(seq 1 12); do echo "; TABLE DATA public t${i} owner"; done ;;
  esac
  exit 0
fi
exit 0
STUB

  cat > "${bin}/aws" <<'STUB'
#!/usr/bin/env bash
key=""; prev=""
for a in "$@"; do [[ "$prev" == "--key" ]] && key="$a"; prev="$a"; done
case "${MODE:-good}" in
  upload-fails) echo "An error occurred (AccessDenied)" >&2; exit 1 ;;
esac
echo "$key" >> "${UPLOAD_LOG:-/dev/null}"
echo '{"ETag":"\"stub\""}'
exit 0
STUB

  chmod +x "${bin}/pg_dump" "${bin}/pg_restore" "${bin}/aws"
}

run_target() { # returns combined output; sets RC
  set +e
  OUTPUT="$("$@" 2>&1)"
  RC=$?
  set -e
}

BIN="$(mktemp -d)/bin"
make_stubs "$BIN"
export PATH="${BIN}:${PATH}"

BASE_ENV=(
  "R2_ACCOUNT_ID=stubaccount"
  "R2_ACCESS_KEY_ID=stubkey"
  "R2_SECRET_ACCESS_KEY=stubsecret"
  "R2_BUCKET=smart-laundry-backups"
  "DATABASE_URL_SMARTBOT=postgresql://u:p@h:5432/smartbot"
  "DATABASE_URL_MACHINEDB=postgresql://u:p@h:5432/machinedb"
  "DATABASE_URL_PAYMENTDB=postgresql://u:p@h:5432/paymentdb"
)

echo "=============================================================="
echo " backup-databases.sh — stubbed behaviour tests"
echo "=============================================================="

# 1. Happy path
UPLOAD_LOG="$(mktemp)"
run_target env MODE=good UPLOAD_LOG="$UPLOAD_LOG" "${BASE_ENV[@]}" "$TARGET"
[[ $RC -eq 0 ]] && pass "happy path exits 0" || fail "happy path exits 0 (got $RC)"
# Whitespace-collapsed so the assertion does not depend on printf column widths.
SUMMARY_FLAT="$(echo "$OUTPUT" | tr -s ' ')"
for db in smartbot machinedb paymentdb; do
  check "${db} reported OK in summary" "${db} OK" "$SUMMARY_FLAT"
done
check "integrity check runs" "Archive readable" "$OUTPUT"
check "final success line" "All backups completed." "$OUTPUT"

# Each DB should upload a dump plus a .sha256 sidecar per tier.
dumps=$(grep -c '\.dump$' "$UPLOAD_LOG" || true)
sums=$(grep -c '\.sha256$' "$UPLOAD_LOG" || true)
[[ "$dumps" -ge 3 ]] && pass "uploaded >=3 dumps (got $dumps)" || fail "uploaded >=3 dumps (got $dumps)"
[[ "$sums" -eq "$dumps" ]] && pass "one checksum sidecar per dump" || fail "one checksum sidecar per dump ($sums vs $dumps)"
check "uploads land under a retention prefix" "daily/" "$(cat "$UPLOAD_LOG")"

# 2. Corrupt archive must NOT be treated as a successful backup.
#    This is the single most important assertion in the file.
run_target env MODE=corrupt "${BASE_ENV[@]}" "$TARGET"
[[ $RC -ne 0 ]] && pass "corrupt archive fails the run" || fail "corrupt archive fails the run (got $RC)"
check "corrupt archive reported as integrity failure" "integrity check failed" "$OUTPUT"

# 3. Suspiciously small dump rejected
run_target env MODE=tiny "${BASE_ENV[@]}" "$TARGET"
[[ $RC -ne 0 ]] && pass "tiny dump fails the run" || fail "tiny dump fails the run (got $RC)"
check "tiny dump reported" "dump too small" "$OUTPUT"

# 4. pg_dump failure surfaces
run_target env MODE=dump-fails "${BASE_ENV[@]}" "$TARGET"
[[ $RC -ne 0 ]] && pass "pg_dump failure fails the run" || fail "pg_dump failure fails the run (got $RC)"
check "pg_dump failure reported" "pg_dump error" "$OUTPUT"

# 5. Upload failure fails the run (after retries)
run_target env MODE=upload-fails "${BASE_ENV[@]}" "$TARGET"
[[ $RC -ne 0 ]] && pass "upload failure fails the run" || fail "upload failure fails the run (got $RC)"
check "upload retried three times" "attempt 3/3" "$OUTPUT"

# 6. Missing R2 config is caught in preflight, before any dump
run_target env MODE=good \
  "DATABASE_URL_SMARTBOT=postgresql://u:p@h:5432/smartbot" "$TARGET"
[[ $RC -ne 0 ]] && pass "missing R2 config fails preflight" || fail "missing R2 config fails preflight"
check "names the missing variable" "R2_ACCOUNT_ID is not set" "$OUTPUT"

# 7. --dry-run needs no credentials and uploads nothing
UPLOAD_LOG2="$(mktemp)"
run_target env MODE=good UPLOAD_LOG="$UPLOAD_LOG2" \
  "DATABASE_URL_SMARTBOT=postgresql://u:p@h:5432/smartbot" \
  "DATABASE_URL_MACHINEDB=postgresql://u:p@h:5432/machinedb" \
  "DATABASE_URL_PAYMENTDB=postgresql://u:p@h:5432/paymentdb" \
  "$TARGET" --dry-run
[[ $RC -eq 0 ]] && pass "--dry-run exits 0 without R2 credentials" || fail "--dry-run exits 0 without R2 credentials (got $RC)"
[[ ! -s "$UPLOAD_LOG2" ]] && pass "--dry-run uploads nothing" || fail "--dry-run uploads nothing"

# 8. All databases skipped must FAIL, not silently succeed.
#    A misconfigured schedule that backs up nothing is the worst outcome:
#    it looks green while producing no backups at all.
run_target env MODE=good \
  "R2_ACCOUNT_ID=a" "R2_ACCESS_KEY_ID=b" "R2_SECRET_ACCESS_KEY=c" "R2_BUCKET=d" \
  "$TARGET"
[[ $RC -ne 0 ]] && pass "zero databases backed up fails the run" || fail "zero databases backed up fails the run (got $RC)"
check "explains why nothing was backed up" "No database was backed up successfully" "$OUTPUT"

# 9. --db targets a single database
UPLOAD_LOG3="$(mktemp)"
run_target env MODE=good UPLOAD_LOG="$UPLOAD_LOG3" "${BASE_ENV[@]}" "$TARGET" --db machinedb
[[ $RC -eq 0 ]] && pass "--db exits 0" || fail "--db exits 0 (got $RC)"
check "--db backed up the requested database" "machinedb" "$(cat "$UPLOAD_LOG3")"
[[ "$(cat "$UPLOAD_LOG3")" != *smartbot* ]] && pass "--db excluded other databases" || fail "--db excluded other databases"

# 10. Retention-tier promotion. Uses the BACKUP_DATE_OVERRIDE seam, since these
#     branches otherwise only execute on Sundays and on the 1st of the month.
#     2026-08-12 is a Wednesday, 2026-08-16 a Sunday, and 2026-11-01 is both a
#     Sunday and the 1st, so it must land in all three tiers at once.
assert_tiers() { # label, date, expected-tiers...
  local label="$1" d="$2"; shift 2
  local log t keys
  log="$(mktemp)"
  run_target env MODE=good UPLOAD_LOG="$log" BACKUP_DATE_OVERRIDE="$d" \
    "${BASE_ENV[@]}" "$TARGET"
  keys="$(cat "$log")"
  for t in "$@"; do
    if [[ "$keys" == *"${t}/"* ]]; then
      pass "${label}: lands in ${t}/"
    else
      fail "${label}: expected ${t}/ prefix"
    fi
  done
  for t in daily weekly monthly; do
    if [[ " $* " != *" ${t} "* && "$keys" == *"${t}/"* ]]; then
      fail "${label}: unexpectedly landed in ${t}/"
    fi
  done
}

assert_tiers "Wednesday"        2026-08-12 daily
assert_tiers "Sunday"           2026-08-16 daily weekly
assert_tiers "1st and a Sunday" 2026-11-01 daily weekly monthly

# An invalid override must be rejected rather than silently ignored.
run_target env MODE=good BACKUP_DATE_OVERRIDE="not-a-date" "${BASE_ENV[@]}" "$TARGET"
[[ $RC -ne 0 ]] && pass "invalid BACKUP_DATE_OVERRIDE rejected" || fail "invalid BACKUP_DATE_OVERRIDE rejected"

# 11. Passwords must never appear in output
run_target env MODE=dump-fails \
  "R2_ACCOUNT_ID=a" "R2_ACCESS_KEY_ID=b" "R2_SECRET_ACCESS_KEY=c" "R2_BUCKET=d" \
  "DATABASE_URL_SMARTBOT=postgresql://user:SUPERSECRETPW@host:5432/smartbot" \
  "$TARGET"
[[ "$OUTPUT" != *SUPERSECRETPW* ]] && pass "database password never printed" || fail "database password leaked into output"

echo
echo "=============================================================="
printf ' %d passed, %d failed\n' "$PASS" "$FAIL"
echo "=============================================================="
[[ $FAIL -eq 0 ]] || exit 1
