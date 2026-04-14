#!/usr/bin/env bash
#
# verify-549-fix.sh — automated 5-run regression verification harness for #549.
#
# Launches the smoke app's TriggerRaceTestScreen in auto-run mode five times on
# a connected Android device, captures the [RACE549] logcat summary lines,
# aggregates the counts, and writes a pass/fail report to
# post-fix-549-verification.md in the repo root. Exit 0 on PASS, 1 on FAIL.
#
# Pass criteria (strict):
#   - Scenario A canaryMissingAtZero  == 0   (aggregated over 5 runs × 20 = 100 attempts)
#   - Scenario A canaryLostPermanent  == 0
#   - Scenario B immediatelyNonZero   == 0   (aggregated over 5 runs × 30 = 150 attempts)
#   - Scenario C immediatelyMissing   == 0   (aggregated over 5 runs × 30 = 150 attempts)
#
# The script flips the VERIFY_549_AUTO_RUN constant in apps/smoke/App.tsx to
# `true` for the duration of the run and reverts it on exit (trap EXIT). The
# smoke app must already be installed and a Metro bundler running, OR use
# `--rebuild` to do a full gradle install.
#
# Usage:
#   scripts/verify-549-fix.sh            # assumes app already installed, metro running
#   scripts/verify-549-fix.sh --rebuild  # rebuild and install before running
#
# Requirements: adb, a connected Android device, the smoke app installed once.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_TSX="$REPO_ROOT/apps/smoke/App.tsx"
REPORT="$REPO_ROOT/post-fix-549-verification.md"
PACKAGE="com.notifeeexample"
ACTIVITY="com.notifeeexample/.MainActivity"
RUNS=5
PER_RUN_TIMEOUT=300 # seconds

log()  { printf '[verify-549] %s\n' "$*"; }
fail() { printf '[verify-549] ERROR: %s\n' "$*" >&2; exit 1; }

# ---- preconditions ----

command -v adb >/dev/null || fail "adb not found in PATH"

DEVICES="$(adb devices | awk 'NR>1 && $2=="device" {print $1}' | head -1 || true)"
[ -n "$DEVICES" ] || fail "no adb device; connect one and try again"
log "using device: $DEVICES"

adb shell pm list packages | grep -q "package:$PACKAGE" \
    || fail "$PACKAGE not installed. Run 'yarn smoke:android' once first."

[ -f "$APP_TSX" ] || fail "cannot find $APP_TSX"

grep -q "const VERIFY_549_AUTO_RUN = false;" "$APP_TSX" \
    || fail "expected 'const VERIFY_549_AUTO_RUN = false;' in App.tsx — maybe the file was modified"

# ---- flip the flag + single consolidated cleanup trap ----

REVERT_DONE=0
RUN_DATA=""
revert_flag() {
  if [ "$REVERT_DONE" -eq 0 ]; then
    log "reverting VERIFY_549_AUTO_RUN to false in App.tsx"
    # BSD sed (macOS) requires a backup suffix; use '' for in-place no backup.
    sed -i '' 's/const VERIFY_549_AUTO_RUN = true;/const VERIFY_549_AUTO_RUN = false;/' "$APP_TSX"
    REVERT_DONE=1
  fi
}
cleanup() {
  [ -n "${RUN_DATA:-}" ] && rm -f "$RUN_DATA"
  revert_flag
}
# Single trap that runs all cleanup in order. bash traps are not additive:
# `trap ... EXIT` replaces any prior EXIT handler, so we install ONCE here
# and update $RUN_DATA inside the handler's closure (via the outer variable).
trap cleanup EXIT INT TERM

log "flipping VERIFY_549_AUTO_RUN to true"
sed -i '' 's/const VERIFY_549_AUTO_RUN = false;/const VERIFY_549_AUTO_RUN = true;/' "$APP_TSX"
grep -q "const VERIFY_549_AUTO_RUN = true;" "$APP_TSX" || fail "sed failed to flip the flag"

# ---- optional rebuild ----

if [ "${1:-}" = "--rebuild" ]; then
  log "rebuilding smoke app (yarn smoke:android)"
  (cd "$REPO_ROOT" && yarn smoke:android) || fail "yarn smoke:android failed"
else
  log "skipping rebuild; relying on Metro dev bundle (ensure 'yarn smoke:start' is running)"
fi

# ---- run N times, capture summaries ----

RUN_DATA="$(mktemp -t verify549.XXXXXX)"

declare -a RUN_TIMESTAMPS
declare -a RUN_A_SUMMARIES
declare -a RUN_B_SUMMARIES
declare -a RUN_C_SUMMARIES
declare -a RUN_D_SUMMARIES

for i in $(seq 1 "$RUNS"); do
  log "run $i / $RUNS — force-stop + launch"
  adb shell am force-stop "$PACKAGE"
  adb logcat -c
  adb shell am start -n "$ACTIVITY" >/dev/null
  RUN_TIMESTAMPS[i]="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  log "waiting up to ${PER_RUN_TIMEOUT}s for RACE549:DONE"
  # Collect logcat output until we see -DONE or timeout.
  LOGFILE="$(mktemp -t verify549-run.XXXXXX)"
  (
    adb logcat 2>&1 | grep --line-buffered "RACE549" >"$LOGFILE" &
    LOGCAT_PID=$!
    SECONDS_WAITED=0
    while [ "$SECONDS_WAITED" -lt "$PER_RUN_TIMEOUT" ]; do
      if grep -q "RACE549:DONE" "$LOGFILE" 2>/dev/null; then
        kill -9 $LOGCAT_PID 2>/dev/null || true
        exit 0
      fi
      sleep 1
      SECONDS_WAITED=$((SECONDS_WAITED + 1))
    done
    kill -9 $LOGCAT_PID 2>/dev/null || true
    exit 1
  ) || fail "run $i did not finish within ${PER_RUN_TIMEOUT}s; see $LOGFILE"

  # Extract per-scenario summaries. Each is a single JSON object on one line.
  # The console.log TAG is "RACE549:" (no brackets — rename in commit 21
  # to avoid shell-regex escaping) and per-scenario suffixes are A / B / C / D.
  A="$(grep 'RACE549:A ' "$LOGFILE" | sed -n 's/.*RACE549:A //p' | tail -1)"
  B="$(grep 'RACE549:B ' "$LOGFILE" | sed -n 's/.*RACE549:B //p' | tail -1)"
  C="$(grep 'RACE549:C ' "$LOGFILE" | sed -n 's/.*RACE549:C //p' | tail -1)"
  D="$(grep 'RACE549:D ' "$LOGFILE" | sed -n 's/.*RACE549:D //p' | tail -1)"

  [ -n "$A" ] && [ -n "$B" ] && [ -n "$C" ] && [ -n "$D" ] \
      || fail "run $i: missing one or more summaries; see $LOGFILE"

  RUN_A_SUMMARIES[i]="$A"
  RUN_B_SUMMARIES[i]="$B"
  RUN_C_SUMMARIES[i]="$C"
  RUN_D_SUMMARIES[i]="$D"
  log "run $i captured ok"
  rm -f "$LOGFILE"
done

# ---- aggregate ----

# Pull integers out of the JSON with a lightweight node expression so we don't
# depend on jq. Node is required anyway by yarn install.
sum_field() {
  local field="$1"; shift
  local total=0
  for line in "$@"; do
    local v
    v="$(printf '%s' "$line" \
        | node -e 'let d=""; process.stdin.on("data",c=>d+=c); process.stdin.on("end",()=>{try{console.log(JSON.parse(d)["'"$field"'"]||0)}catch(e){console.log(0)}})')"
    total=$((total + v))
  done
  printf '%s' "$total"
}

A_CANARY_MISSING_AT_ZERO=$(sum_field canaryMissingAtZero "${RUN_A_SUMMARIES[@]}")
A_CANARY_LOST_PERMANENT=$(sum_field canaryLostPermanent "${RUN_A_SUMMARIES[@]}")
B_IMMEDIATELY_NONZERO=$(sum_field immediatelyNonZero "${RUN_B_SUMMARIES[@]}")
B_AFTER50_NONZERO=$(sum_field after50NonZero "${RUN_B_SUMMARIES[@]}")
B_AFTER500_NONZERO=$(sum_field after500NonZero "${RUN_B_SUMMARIES[@]}")
C_IMMEDIATELY_MISSING=$(sum_field immediatelyMissing "${RUN_C_SUMMARIES[@]}")
C_AFTER50_MISSING=$(sum_field after50Missing "${RUN_C_SUMMARIES[@]}")
C_AFTER500_MISSING=$(sum_field after500Missing "${RUN_C_SUMMARIES[@]}")

VERDICT="PASS"
FAIL_REASONS=""
[ "$A_CANARY_MISSING_AT_ZERO" -eq 0 ] || { VERDICT="FAIL"; FAIL_REASONS+="- Scenario A canaryMissingAtZero = $A_CANARY_MISSING_AT_ZERO / 100\n"; }
[ "$A_CANARY_LOST_PERMANENT"  -eq 0 ] || { VERDICT="FAIL"; FAIL_REASONS+="- Scenario A canaryLostPermanent = $A_CANARY_LOST_PERMANENT / 100\n"; }
[ "$B_IMMEDIATELY_NONZERO"    -eq 0 ] || { VERDICT="FAIL"; FAIL_REASONS+="- Scenario B immediatelyNonZero = $B_IMMEDIATELY_NONZERO / 150\n"; }
[ "$C_IMMEDIATELY_MISSING"    -eq 0 ] || { VERDICT="FAIL"; FAIL_REASONS+="- Scenario C immediatelyMissing = $C_IMMEDIATELY_MISSING / 150\n"; }

# ---- report ----

{
  echo "# Post-fix #549 verification"
  echo
  echo "- **Verdict**: **$VERDICT**"
  echo "- **Device**: $DEVICES ($(adb shell getprop ro.product.model | tr -d '\r'))"
  echo "- **Android**: $(adb shell getprop ro.build.version.release | tr -d '\r')"
  echo "- **Runs**: $RUNS"
  echo "- **Generated**: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  if [ "$VERDICT" = "FAIL" ]; then
    echo "## Failures"
    printf '%b\n' "$FAIL_REASONS"
  fi
  echo "## Aggregate (across all $RUNS runs)"
  echo
  echo "| Scenario | Metric | Count | Attempts | OK? |"
  echo "|---|---|---:|---:|---|"
  echo "| A | canaryMissingAtZero | $A_CANARY_MISSING_AT_ZERO | 100 | $([ "$A_CANARY_MISSING_AT_ZERO" -eq 0 ] && echo ✅ || echo ❌) |"
  echo "| A | canaryLostPermanent | $A_CANARY_LOST_PERMANENT | 100 | $([ "$A_CANARY_LOST_PERMANENT" -eq 0 ] && echo ✅ || echo ❌) |"
  echo "| B | immediatelyNonZero  | $B_IMMEDIATELY_NONZERO | 150 | $([ "$B_IMMEDIATELY_NONZERO" -eq 0 ] && echo ✅ || echo ❌) |"
  echo "| B | after50NonZero      | $B_AFTER50_NONZERO | 150 | $([ "$B_AFTER50_NONZERO" -eq 0 ] && echo ✅ || echo ❌) |"
  echo "| B | after500NonZero     | $B_AFTER500_NONZERO | 150 | $([ "$B_AFTER500_NONZERO" -eq 0 ] && echo ✅ || echo ❌) |"
  echo "| C | immediatelyMissing  | $C_IMMEDIATELY_MISSING | 150 | $([ "$C_IMMEDIATELY_MISSING" -eq 0 ] && echo ✅ || echo ❌) |"
  echo "| C | after50Missing      | $C_AFTER50_MISSING | 150 | $([ "$C_AFTER50_MISSING" -eq 0 ] && echo ✅ || echo ❌) |"
  echo "| C | after500Missing     | $C_AFTER500_MISSING | 150 | $([ "$C_AFTER500_MISSING" -eq 0 ] && echo ✅ || echo ❌) |"
  echo
  echo "## Per-run summaries"
  for i in $(seq 1 "$RUNS"); do
    echo
    echo "### Run $i — ${RUN_TIMESTAMPS[i]}"
    echo
    echo '```json'
    echo "A: ${RUN_A_SUMMARIES[i]}"
    echo "B: ${RUN_B_SUMMARIES[i]}"
    echo "C: ${RUN_C_SUMMARIES[i]}"
    echo "D: ${RUN_D_SUMMARIES[i]}"
    echo '```'
  done
} > "$REPORT"

log "wrote $REPORT"
log "verdict: $VERDICT"

if [ "$VERDICT" = "PASS" ]; then
  exit 0
fi
exit 1
