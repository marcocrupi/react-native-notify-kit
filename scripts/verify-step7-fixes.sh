#!/usr/bin/env bash
#
# verify-step7-fixes.sh — runs the Step 7 regression guards for upstream
# invertase/notifee#734 on a connected device.
#
# Verifies:
#   1. NotifeeAlarmManagerHandleStaleTest (Robolectric + Mockito unit tests)
#      covering the Exception/Error branch narrowing and the submitAsync
#      sync-throw resilience.
#   2. RebootRecoveryTest (instrumented) — the pre-existing 5-case suite from
#      Steps 2 + 6 still passes after the Step 7 changes.
#
# SAFETY
#   - Runs the destructive RebootRecoveryTest on the connected device. That
#     test wipes the notifee Room DB in setUp/tearDown. Only run on an
#     emulator or a device whose notifee state you are willing to lose.
#   - Does NOT reboot the device.
#   - Does NOT touch any package other than com.notifeeexample.
#
# REQUIREMENTS
#   - adb on PATH, exactly one device connected.
#   - The notifeeexample smoke app installed (run
#     `scripts/smoke-test-734.sh build` first if needed).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT_ROOT="/tmp/step7-verify-$(date +%s)"

log()  { printf '[verify-step7] %s\n' "$*"; }
fail() { printf '[verify-step7] ERROR: %s\n' "$*" >&2; exit 1; }

# ─── Pre-req: exactly one device connected ─────────────────────────────────

devices=$(adb devices | awk 'NR>1 && $2=="device" {print $1}')
device_count=$(printf '%s\n' "$devices" | sed '/^$/d' | wc -l | tr -d ' ')
if [[ "$device_count" == "0" ]]; then
  fail "no device connected (adb devices)"
fi
if [[ "$device_count" != "1" ]]; then
  printf 'connected devices:\n%s\n' "$devices" >&2
  fail "expected exactly 1 connected device, found $device_count"
fi
serial=$(printf '%s\n' "$devices" | head -n1)
model=$(adb -s "$serial" shell getprop ro.product.model | tr -d '\r')
log "target: $serial ($model)"

mkdir -p "$REPORT_ROOT"
log "results will be saved to $REPORT_ROOT"

# ─── Phase 1: Robolectric/Mockito unit tests ───────────────────────────────

log "running unit tests (testDebugUnitTest)"
(cd "$REPO_ROOT/apps/smoke/android" && \
  ./gradlew :react-native-notify-kit:testDebugUnitTest \
    --tests 'app.notifee.core.NotifeeAlarmManagerHandleStaleTest' \
    --tests 'app.notifee.core.InitProviderBootCheckTest')

# Copy the JUnit XML reports so Marco can inspect them offline.
UNIT_REPORT_SRC="$REPO_ROOT/packages/react-native/android/build/test-results/testDebugUnitTest"
if [[ -d "$UNIT_REPORT_SRC" ]]; then
  cp -r "$UNIT_REPORT_SRC" "$REPORT_ROOT/unit" || true
fi

# ─── Phase 2: Instrumented RebootRecoveryTest on the target device ─────────

log "running RebootRecoveryTest on $serial (DESTRUCTIVE — wipes Room DB)"
(cd "$REPO_ROOT/apps/smoke/android" && \
  ANDROID_SERIAL="$serial" ./gradlew \
    :react-native-notify-kit:connectedDebugAndroidTest \
    -Pandroid.testInstrumentationRunnerArguments.class=app.notifee.core.RebootRecoveryTest)

INSTR_REPORT_SRC="$REPO_ROOT/packages/react-native/android/build/outputs/androidTest-results/connected"
if [[ -d "$INSTR_REPORT_SRC" ]]; then
  cp -r "$INSTR_REPORT_SRC" "$REPORT_ROOT/instrumented" || true
fi

# ─── Verdict ───────────────────────────────────────────────────────────────

pass=1
# Robolectric unit runner writes one XML per test class under testDebugUnitTest/
for xml in "$REPORT_ROOT"/unit/TEST-*.xml "$REPORT_ROOT"/instrumented/debug/TEST-*.xml; do
  [[ -f "$xml" ]] || continue
  if ! grep -q 'failures="0" errors="0"' "$xml"; then
    pass=0
    echo "FAILURE in $xml" >&2
  fi
done

if [[ "$pass" == "1" ]]; then
  log "✅ all Step 7 regression guards pass on $serial"
  log "reports saved to $REPORT_ROOT"
  exit 0
else
  fail "one or more test suites reported failures — inspect $REPORT_ROOT"
fi
