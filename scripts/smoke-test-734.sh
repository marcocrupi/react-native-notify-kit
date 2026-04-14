#!/usr/bin/env bash
#
# smoke-test-734.sh — composable helpers for manually smoke-testing the fix
# for upstream invertase/notifee#734 (reboot recovery on OEM devices).
#
# Each subcommand is independent — invoke one at a time and inspect the result
# before moving on to the next. Run without arguments to see usage.
#
# SAFETY
# ──────
# Some subcommands are DESTRUCTIVE. They wipe the notifee Room DB on the target
# device and/or reboot it:
#   - reset-state
#   - instrumented-tests     (RebootRecoveryTest calls deleteAll() in setUp/tearDown)
#   - reboot
#
# Only run destructive subcommands on:
#   - Emulators
#   - Dedicated test devices
#   - Physical devices whose notifee state you are willing to lose
#
# Destructive subcommands require the --i-know flag as an explicit acknowledgment.
#
# USAGE
# ─────
#   scripts/smoke-test-734.sh <subcommand> [args]
#
# Subcommands:
#   help                 Show this message and exit.
#   device               Print the target device identifier and model.
#   build                Build and install the smoke app (debug) on the target device.
#   boot-count           Print the current value of Settings.Global.BOOT_COUNT.
#   prefs-dump           Dump the notifee SharedPreferences XML (including
#                        notifee_last_known_boot_count).
#   db-dump              Dump the notifee work_data table (count + id + with_alarm_manager).
#                        Force-stops the app first to avoid contending with a
#                        live Room writer. Does NOT decode the trigger BLOB.
#   logcat-clear         Clear the device logcat buffer.
#   logcat-tail          Tail (follow) notifee-tagged lines. Ctrl-C to stop.
#   logcat-dump FILE     Dump the current notifee-tagged logcat contents to FILE.
#   reboot --i-know      Reboot the device and wait for it to come back up.
#   reset-state --i-know Force-stop the smoke app, wipe its Room DB, and clear its
#                        SharedPreferences (including the BOOT_COUNT baseline).
#   instrumented-tests --i-know
#                        Run RebootRecoveryTest including the new #734 cases.
#                        DESTRUCTIVE: wipes the notifee Room DB in setUp/tearDown.
#
# Expected output patterns per scenario live in smoke-test-734-scenarios.md.

set -euo pipefail

SMOKE_PACKAGE="com.notifeeexample"
DB_NAME="notifee_core_database"
PREFS_FILE="app.notifee.core"  # matches Preferences.PREFERENCES_FILE
LOGCAT_TAG="NOTIFEE"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── shared helpers ─────────────────────────────────────────────────────────

log()  { printf '[smoke-734] %s\n' "$*"; }
fail() { printf '[smoke-734] ERROR: %s\n' "$*" >&2; exit 1; }

# Prints exactly one connected device serial, or bails out. Populates SERIAL.
resolve_device() {
  local devices
  devices=$(adb devices | awk 'NR>1 && $2=="device" {print $1}')
  local count
  count=$(printf '%s\n' "$devices" | sed '/^$/d' | wc -l | tr -d ' ')
  if [[ "$count" == "0" ]]; then
    fail "no device connected (adb devices)"
  fi
  if [[ "$count" != "1" ]]; then
    printf 'connected devices:\n%s\n' "$devices" >&2
    fail "expected exactly 1 connected device, found $count"
  fi
  SERIAL=$(printf '%s\n' "$devices" | head -n1)
  local model
  model=$(adb -s "$SERIAL" shell getprop ro.product.model | tr -d '\r')
  log "target: $SERIAL ($model)"
}

require_flag() {
  local flag="$1"; shift
  for arg in "$@"; do
    if [[ "$arg" == "$flag" ]]; then
      return 0
    fi
  done
  fail "this subcommand is destructive. Re-run with $flag to proceed."
}

# ─── subcommands ────────────────────────────────────────────────────────────

cmd_help() {
  # Print the comment block that starts at line 2 and ends on the first
  # non-comment line. Strips the leading '# ' or '#' prefix so the message
  # reads naturally. Robust against future edits that move `set -euo pipefail`.
  awk 'NR==1 {next} /^[^#]/ {exit} {sub(/^# ?/, ""); print}' "$0"
}

cmd_device() {
  resolve_device
}

cmd_build() {
  resolve_device
  log "building and installing smoke app (debug) on $SERIAL"
  (cd "$REPO_ROOT/apps/smoke" && ANDROID_SERIAL="$SERIAL" npx react-native run-android)
}

cmd_boot_count() {
  resolve_device
  local val
  val=$(adb -s "$SERIAL" shell settings get global boot_count | tr -d '\r')
  printf 'Settings.Global.BOOT_COUNT = %s\n' "$val"
}

cmd_prefs_dump() {
  resolve_device
  adb -s "$SERIAL" shell "run-as $SMOKE_PACKAGE cat shared_prefs/${PREFS_FILE}.xml 2>/dev/null || echo '(no prefs file yet — app has not run, or cleared)'"
}

cmd_db_dump() {
  resolve_device
  log "force-stopping $SMOKE_PACKAGE to release Room file lock"
  adb -s "$SERIAL" shell am force-stop "$SMOKE_PACKAGE"
  log "dumping work_data table"
  # The trigger column is a serialized Android Parcel/Bundle, not usable as
  # plain-text SQL. We only report row presence + the with_alarm_manager flag;
  # the timestamp encoded inside the trigger BLOB can only be inspected by
  # reading the entity via Java or by adding instrumentation logs.
  adb -s "$SERIAL" shell "run-as $SMOKE_PACKAGE sqlite3 databases/$DB_NAME \"SELECT COUNT(*) FROM work_data;\""
  echo "--- rows (id | with_alarm_manager) ---"
  adb -s "$SERIAL" shell "run-as $SMOKE_PACKAGE sqlite3 -header -column databases/$DB_NAME \"SELECT id, with_alarm_manager FROM work_data;\""
}

cmd_logcat_clear() {
  resolve_device
  adb -s "$SERIAL" logcat -c
  log "logcat buffer cleared"
}

cmd_logcat_tail() {
  resolve_device
  log "tailing logcat filtered to $LOGCAT_TAG (Ctrl-C to stop)"
  adb -s "$SERIAL" logcat -v time "$LOGCAT_TAG:V" '*:S'
}

cmd_logcat_dump() {
  resolve_device
  local dest="${1:-}"
  if [[ -z "$dest" ]]; then
    fail "logcat-dump requires a destination file path"
  fi
  adb -s "$SERIAL" logcat -d -v time "$LOGCAT_TAG:V" '*:S' > "$dest"
  log "notifee logcat dumped to $dest"
  local lines
  lines=$(wc -l < "$dest" | tr -d ' ')
  log "captured $lines lines"
}

cmd_reboot() {
  require_flag "--i-know" "$@"
  resolve_device
  log "rebooting $SERIAL — this may take ~60s"
  adb -s "$SERIAL" reboot
  adb -s "$SERIAL" wait-for-device
  # Additional grace period: wait-for-device returns once adbd is up, not when
  # the system is idle. BOOT_COMPLETED may still be pending.
  log "device reconnected, waiting 20s for boot to settle"
  sleep 20
  log "done"
}

cmd_reset_state() {
  require_flag "--i-know" "$@"
  resolve_device
  log "force-stopping $SMOKE_PACKAGE"
  adb -s "$SERIAL" shell am force-stop "$SMOKE_PACKAGE"
  log "wiping Room DB and shared prefs"
  adb -s "$SERIAL" shell "run-as $SMOKE_PACKAGE sh -c 'rm -f databases/${DB_NAME}* shared_prefs/${PREFS_FILE}.xml'"
  log "state reset complete"
}

cmd_instrumented_tests() {
  require_flag "--i-know" "$@"
  resolve_device
  log "running RebootRecoveryTest on $SERIAL (DESTRUCTIVE — wipes Room DB)"
  # connectedDebugAndroidTest is a DeviceProviderInstrumentTestTask from the Android
  # Gradle Plugin, not a JVM Test task — so the `--tests <pattern>` command-line
  # option is not recognized. Instrumentation test filtering is done via the AGP
  # property `android.testInstrumentationRunnerArguments.class` (and related keys
  # for method/package/annotation). Bug surfaced in the Step 6 smoke dry-run.
  (cd "$REPO_ROOT/apps/smoke/android" && \
    ANDROID_SERIAL="$SERIAL" ./gradlew \
      :react-native-notify-kit:connectedDebugAndroidTest \
      -Pandroid.testInstrumentationRunnerArguments.class=app.notifee.core.RebootRecoveryTest)
}

# ─── main ──────────────────────────────────────────────────────────────────

if [[ $# -eq 0 ]]; then
  cmd_help
  exit 0
fi

subcommand="$1"; shift || true

case "$subcommand" in
  help|--help|-h)          cmd_help ;;
  device)                  cmd_device ;;
  build)                   cmd_build ;;
  boot-count)              cmd_boot_count ;;
  prefs-dump)              cmd_prefs_dump ;;
  db-dump)                 cmd_db_dump ;;
  logcat-clear)            cmd_logcat_clear ;;
  logcat-tail)             cmd_logcat_tail ;;
  logcat-dump)             cmd_logcat_dump "$@" ;;
  reboot)                  cmd_reboot "$@" ;;
  reset-state)             cmd_reset_state "$@" ;;
  instrumented-tests)      cmd_instrumented_tests "$@" ;;
  *)
    printf 'unknown subcommand: %s\n\n' "$subcommand" >&2
    cmd_help >&2
    exit 2
    ;;
esac
