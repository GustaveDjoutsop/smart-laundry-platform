#!/usr/bin/env bash
#
# audit-git-history-secrets.sh
#
# Enumerates credential-shaped strings that have EVER existed in this
# repository's git history, not just at HEAD.
#
# WHY THIS EXISTS
# ---------------
# Removing a hardcoded secret from a file does not remove it from git history.
# Anyone who has ever cloned the repo, and anyone with read access today, can
# recover the old value with `git log -p`. The only real remediation is
# rotation at the provider. This script produces the inventory that drives
# that rotation.
#
# USAGE
#   ./scripts/audit-git-history-secrets.sh            # summary to stdout
#   ./scripts/audit-git-history-secrets.sh --verbose  # include commit refs
#
# EXIT CODES
#   0  scan completed (findings are printed, not treated as failure — this is
#      an investigative tool, not a CI gate; see .github/workflows/secret-scan.yml
#      for the blocking control)
#   1  not run from inside a git repository
#
set -uo pipefail

VERBOSE=0
[[ "${1:-}" == "--verbose" ]] && VERBOSE=1

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "error: not inside a git repository" >&2
  exit 1
fi

# Ensure we are scanning full history, not a shallow clone. A shallow clone
# would silently produce a clean-looking report, which is worse than no report.
if [[ -f "$(git rev-parse --git-dir)/shallow" ]]; then
  echo "WARNING: this is a SHALLOW clone. Results are incomplete."
  echo "         Run 'git fetch --unshallow' before trusting this report."
  echo
fi

TOTAL_COMMITS=$(git rev-list --all --count)
echo "=============================================================="
echo " Git history secret audit"
echo " Repository : $(basename "$(git rev-parse --show-toplevel)")"
echo " Commits    : ${TOTAL_COMMITS}"
echo " Date       : $(date -u '+%Y-%m-%d %H:%M UTC')"
echo "=============================================================="
echo

# Strings that look like credentials but are documented placeholders, test
# fixtures, or local-dev throwaways. Kept in sync with the allowlist in
# .gitleaks.toml.
#
# A report that cries wolf gets ignored, so known-benign high-entropy values
# are suppressed by exact value with a stated reason:
#   2c67cc5ed1ea81a99d00f552b1f89625  Notion page ID in a documentation URL
#   9373795779eb...4722d574b6         synthetic BSUID in afromarketFlow.test.js
#   0102030405..., 0123456789abcdef   obvious AES test vectors
NOISE='your_|example|placeholder|change-me|xxxx|REDACTED|test-secret|testpass|generate_with|\$\{|process\.env|config\.|secrets\.|dummy|sample|<[a-z]|hashFiles|actions/|uses:|sha256|0102030405060708|0123456789abcdef|1234567890abcdefghij|sk_test_1234|2c67cc5ed1ea81a99d00f552b1f89625|9373795779eb6441c8adb2eaee5b848e7dd174ddd302d7db62142f4722d574b6'

section() {
  echo "--------------------------------------------------------------"
  echo " $1"
  echo "--------------------------------------------------------------"
}

report_pattern() {
  local label="$1" pattern="$2"
  local hits
  # -i on the extraction pass keeps the patterns portable: GNU grep -E has no
  # inline (?i) flag, so case-insensitivity must be a flag, not syntax.
  # -e guards against patterns that begin with '-' (e.g. PEM headers) being
  # mistaken for options.
  hits=$(git log -p --all 2>/dev/null \
    | grep -E '^\+' \
    | grep -oiE -e "${pattern}" \
    | grep -viE "${NOISE}" \
    | sort -u)

  if [[ -z "${hits}" ]]; then
    printf '  %-34s clean\n' "${label}"
    return
  fi

  printf '  %-34s %d distinct value(s)\n' "${label}" "$(echo "${hits}" | wc -l | tr -d ' ')"
  while IFS= read -r hit; do
    # Print a fingerprint, never the full value — this report is meant to be
    # pasteable into an issue or a chat without leaking further.
    local masked="${hit:0:10}...${hit: -4}"
    echo "      - ${masked}  (len ${#hit})"
    if [[ ${VERBOSE} -eq 1 ]]; then
      git log --all --oneline -S"${hit}" 2>/dev/null | sed 's/^/          commit /' | head -4
      if grep -rq --exclude-dir=.git -- "${hit}" . 2>/dev/null; then
        echo "          STILL PRESENT AT HEAD"
      fi
    fi
  done <<< "${hits}"
}

section "Provider credentials"
report_pattern "Meta/WhatsApp access token"  'EAA[A-Za-z0-9]{40,}'
report_pattern "Twilio account SID"          'AC[a-f0-9]{32}'
report_pattern "Twilio auth token"           'twilio[_-]?auth[_-]?token["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"']?[a-f0-9]{32}'
report_pattern "Slack token"                 'xox[baprs]-[A-Za-z0-9-]{10,}'
report_pattern "Stripe secret key"           'sk_(live|test)_[A-Za-z0-9]{16,}'
report_pattern "AWS access key id"           'AKIA[0-9A-Z]{16}'
report_pattern "Google API key"              'AIza[0-9A-Za-z_-]{35}'
echo

section "Cryptographic material"
report_pattern "64-hex key (AES-256 sized)"  '\b[a-f0-9]{64}\b'
report_pattern "32-hex key/token"            '\b[a-f0-9]{32}\b'
report_pattern "Private key block"           '-----BEGIN [A-Z ]*PRIVATE KEY-----'
report_pattern "JWT"                         'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
echo

section "Generic assignments in config files"
git log -p --all -- \
    '*/application.yml' '*/application.yaml' '*.env' '*.env.*' \
    '*/docker-compose*.yml' '*/values.yaml' '*/values.yml' 'docker-compose*.yml' \
    2>/dev/null \
  | grep -E '^\+' \
  | grep -iE '(secret|token|api[_-]?key|app[_-]?key|password|passwd|dsn)[a-z_]*\s*[:=]' \
  | grep -viE "${NOISE}" \
  | grep -oE '^\+\s*[A-Za-z0-9_.-]+\s*[:=]' \
  | sed 's/^+\s*//; s/\s*[:=]$//' \
  | sort -u \
  | sed 's/^/  /' \
  || echo "  clean"
echo

section "Personal data in fixtures"
report_pattern "E.164 phone number"          '\+(49|237|33)[0-9]{8,12}'
echo

echo "=============================================================="
echo " NEXT STEPS"
echo "=============================================================="
cat <<'EOF'
  Any value listed above must be treated as PUBLIC and rotated at the
  provider. Removing it from HEAD is not sufficient.

  Record each rotation in docs/SECRET-ROTATION.md so the next person can
  tell what has been handled and what has not.

  Re-run with --verbose to see which commits introduced each value and
  whether it is still present at HEAD.
EOF
