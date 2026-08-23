#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ADB="${ADB:-adb}"
APP_PACKAGE="com.notifeeexample"
MAIN_ACTIVITY="com.notifeeexample/.MainActivity"
NOTIFICATION_A_ID="issue69-a"
NOTIFICATION_B_ID="issue69-b"
# Android integer IDs produced for the two fixed public notification IDs.
NOTIFICATION_A_ANDROID_ID="183827504"
NOTIFICATION_B_ANDROID_ID="183827505"
ACTION_ID="issue69-done"

RESULT_TIMEOUT_SECONDS="${RESULT_TIMEOUT_SECONDS:-90}"
PROCESS_TIMEOUT_SECONDS="${PROCESS_TIMEOUT_SECONDS:-12}"
MANUAL_TIMEOUT_SECONDS="${MANUAL_TIMEOUT_SECONDS:-180}"

MODE=""
RUN_ACTION_B="0"
DEVICE_SERIAL="${ANDROID_SERIAL:-}"
SKIP_BUILD="0"
ADB_ARGS=()
DEVICE_MANUFACTURER="unknown"
DEVICE_MODEL="unknown"
ANDROID_RELEASE="unknown"
ANDROID_API="unknown"

TMP_ROOT=""
LOG_FILE=""
LOGCAT_PID=""
CURRENT_HEAD="unknown"
BUILD_MODE="not-run"
NOTIFICATION_LIST_SUPPORTED="0"
OBSERVED_A_STATE="unknown"
OBSERVED_B_STATE="unknown"
DISPLAYED_PAYLOAD=""
DISPLAYED_FAILURE=""
READY_PID=""

CURRENT_SCENARIO=""
CORRELATION_ID=""
P1=""
P1_TERMINATED="no"
P2=""
PIDS_DIFFER="no"
A_PRE_KILL="unknown"
A_POST_KILL="unknown"
AB_PRESENT="no"
A_FINAL="unknown"
B_FINAL="unknown"
DISPLAYED_AFTER_B="not-run"
DISPLAYED_FINAL="not-run"
EVENT_TYPE="none"
EVENT_SOURCE="none"
EVENT_NOTIFICATION_ID="none"
EVENT_WHICH="none"
EVENT_ACTION_ID="none"
OPTIONAL_B_EVENT="not-run"
EVENT_B_SOURCE="none"
EVENT_B_NOTIFICATION_ID="none"
EVENT_B_WHICH="none"
EVENT_B_ACTION_ID="none"
VERDICT="NOT RUN"
FAILURE_REASON=""
RUN_ACTIVE="0"
RUN_SUMMARY_PRINTED="0"

COMPLETED_SCENARIOS=()
COMPLETED_CORRELATIONS=()

usage() {
  cat <<EOF
Issue #69 Android physical-device PendingIntent smoke harness

Usage:
  bash scripts/smoke-test-69-android-pending-intent.sh action [--action-b] [options]
  bash scripts/smoke-test-69-android-pending-intent.sh dismiss [options]
  bash scripts/smoke-test-69-android-pending-intent.sh all [--action-b] [options]

Scenarios:
  action      Create A in P1, kill P1, create B in P2, then manually tap Done on A.
  dismiss     Recreate fresh A/P1 and B/P2, then manually swipe/dismiss A.
  all         Run action and then a separate, freshly correlated dismiss scenario.

Options:
  --action-b          After action A passes, also ask for a manual Done tap on B.
  --serial <serial>   Select an adb device. ANDROID_SERIAL is also supported.
  --skip-build        Trust the installed APK and current JS source/bundle. Its native
                      provenance is NOT verified against the current repository HEAD.
  -h, --help          Show this help without accessing a device or building.

Prerequisites:
  - A physical Android device with adb authorization and notification permission.
  - The default path runs yarn build:rn and yarn smoke:android for the selected device.
  - A debug install needs Metro reachable (normally handled by yarn smoke:android).
  - With --skip-build, arrange Metro/bundle availability yourself and accept the
    explicit stale-APK risk printed by the harness.

Manual operations:
  - action: open the tray and tap "Done" on "Issue 69 A" (optionally B afterward).
  - dismiss: open the tray and swipe/dismiss "Issue 69 A".

The script never force-stops, clears app data, uninstalls, reboots, resets device
settings, or uses coordinate-based notification taps.
EOF
}

log() {
  printf '[issue69] %s\n' "$*"
}

warn() {
  printf '[issue69] WARNING: %s\n' "$*" >&2
}

is_positive_integer() {
  [[ "${1:-}" =~ ^[1-9][0-9]*$ ]]
}

print_run_summary() {
  [[ "$RUN_ACTIVE" == "1" ]] || return 0
  [[ "$RUN_SUMMARY_PRINTED" == "0" ]] || return 0
  RUN_SUMMARY_PRINTED="1"

  printf '\n## Issue #69 Android smoke result\n'
  printf 'scenario: %s\n' "${CURRENT_SCENARIO:-unknown}"
  printf 'correlationId: %s\n' "${CORRELATION_ID:-unknown}"
  printf 'device: %s %s (%s)\n' "$DEVICE_MANUFACTURER" "$DEVICE_MODEL" \
    "${DEVICE_SERIAL:-unknown}"
  printf 'android: %s API %s\n' "$ANDROID_RELEASE" "$ANDROID_API"
  printf 'package: %s\n' "$APP_PACKAGE"
  printf 'repository HEAD: %s\n' "$CURRENT_HEAD"
  printf 'build mode: %s\n' "$BUILD_MODE"
  printf 'P1: %s\n' "${P1:-not-observed}"
  printf 'P1 terminated: %s\n' "$P1_TERMINATED"
  printf 'P2: %s\n' "${P2:-not-observed}"
  printf 'P2 != P1: %s\n' "$PIDS_DIFFER"
  printf 'A pre-kill: %s\n' "$A_PRE_KILL"
  printf 'A post-kill: %s\n' "$A_POST_KILL"
  printf 'A+B present: %s\n' "$AB_PRESENT"
  printf 'displayed after B: %s\n' "$DISPLAYED_AFTER_B"
  printf 'event type: %s\n' "$EVENT_TYPE"
  printf 'event source: %s\n' "$EVENT_SOURCE"
  printf 'event notification id: %s\n' "$EVENT_NOTIFICATION_ID"
  printf 'event which: %s\n' "$EVENT_WHICH"
  printf 'event pressAction id: %s\n' "$EVENT_ACTION_ID"
  printf 'optional B event: %s\n' "$OPTIONAL_B_EVENT"
  printf 'optional B event source: %s\n' "$EVENT_B_SOURCE"
  printf 'optional B notification id: %s\n' "$EVENT_B_NOTIFICATION_ID"
  printf 'optional B which: %s\n' "$EVENT_B_WHICH"
  printf 'optional B pressAction id: %s\n' "$EVENT_B_ACTION_ID"
  printf 'A final state: %s\n' "$A_FINAL"
  printf 'B final state: %s\n' "$B_FINAL"
  printf 'displayed final: %s\n' "$DISPLAYED_FINAL"
  printf 'verdict: %s\n' "$VERDICT"
  if [[ -n "$FAILURE_REASON" ]]; then
    printf 'reason: %s\n' "$FAILURE_REASON"
  fi
  printf 'logcat: %s\n' "${LOG_FILE:-not-started}"
  printf 'ISSUE69:VERDICT scenario=%s correlationId=%s verdict=%s\n' \
    "${CURRENT_SCENARIO:-unknown}" "${CORRELATION_ID:-unknown}" "$VERDICT"
}

cleanup() {
  local status=$?
  if [[ -n "$LOGCAT_PID" ]] && kill -0 "$LOGCAT_PID" >/dev/null 2>&1; then
    kill "$LOGCAT_PID" >/dev/null 2>&1 || true
    wait "$LOGCAT_PID" 2>/dev/null || true
  fi
  if [[ "$status" -ne 0 && "$RUN_ACTIVE" == "1" && "$VERDICT" != "FAIL" ]]; then
    VERDICT="FAIL"
    FAILURE_REASON="${FAILURE_REASON:-unexpected harness command failure (exit $status)}"
  fi
  print_run_summary
}

trap cleanup EXIT

fail() {
  FAILURE_REASON="$*"
  VERDICT="FAIL"
  printf '[issue69] FAIL: %s\n' "$*" >&2
  exit 1
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h | --help | help)
        usage
        exit 0
        ;;
      action | dismiss | all)
        [[ -z "$MODE" ]] || fail "scenario specified more than once"
        MODE="$1"
        shift
        ;;
      --action-b)
        RUN_ACTION_B="1"
        shift
        ;;
      --serial)
        [[ $# -ge 2 ]] || fail "--serial requires a value"
        DEVICE_SERIAL="$2"
        shift 2
        ;;
      --serial=*)
        DEVICE_SERIAL="${1#--serial=}"
        shift
        ;;
      --skip-build)
        SKIP_BUILD="1"
        shift
        ;;
      *)
        fail "unknown argument: $1 (use --help)"
        ;;
    esac
  done

  [[ -n "$MODE" ]] || fail "missing scenario: action, dismiss, or all"
  if [[ "$MODE" == "dismiss" && "$RUN_ACTION_B" == "1" ]]; then
    fail "--action-b is valid only with action or all"
  fi
  [[ -z "$DEVICE_SERIAL" || "$DEVICE_SERIAL" =~ ^[A-Za-z0-9._:-]+$ ]] || \
    fail "invalid adb serial: $DEVICE_SERIAL"
  is_positive_integer "$RESULT_TIMEOUT_SECONDS" || fail "RESULT_TIMEOUT_SECONDS must be positive"
  is_positive_integer "$PROCESS_TIMEOUT_SECONDS" || fail "PROCESS_TIMEOUT_SECONDS must be positive"
  is_positive_integer "$MANUAL_TIMEOUT_SECONDS" || fail "MANUAL_TIMEOUT_SECONDS must be positive"
}

ensure_tools() {
  command -v "$ADB" >/dev/null 2>&1 || fail "adb not found in PATH"
  command -v node >/dev/null 2>&1 || fail "node not found in PATH"
  command -v git >/dev/null 2>&1 || fail "git not found in PATH"
  if [[ "$SKIP_BUILD" != "1" ]]; then
    command -v yarn >/dev/null 2>&1 || fail "yarn not found in PATH"
  fi
}

resolve_device() {
  local state devices count
  if [[ -n "$DEVICE_SERIAL" ]]; then
    state="$("$ADB" -s "$DEVICE_SERIAL" get-state 2>/dev/null || true)"
    [[ "$state" == "device" ]] || fail "selected device $DEVICE_SERIAL is not ready (state=${state:-unavailable})"
    ADB_ARGS=(-s "$DEVICE_SERIAL")
    return
  fi

  devices="$("$ADB" devices | awk 'NR > 1 && $2 == "device" { print $1 }')"
  count="$(printf '%s\n' "$devices" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [[ "$count" == "0" ]]; then
    "$ADB" devices >&2 || true
    fail "no Android device connected"
  fi
  if [[ "$count" != "1" ]]; then
    "$ADB" devices -l >&2 || true
    fail "multiple Android devices connected; pass --serial or set ANDROID_SERIAL"
  fi
  DEVICE_SERIAL="$(printf '%s\n' "$devices" | sed '/^$/d' | head -n 1)"
  ADB_ARGS=(-s "$DEVICE_SERIAL")
}

adb_device() {
  "$ADB" "${ADB_ARGS[@]}" "$@"
}

load_device_info() {
  local is_emulator
  DEVICE_MANUFACTURER="$(adb_device shell getprop ro.product.manufacturer 2>/dev/null | tr -d '\r' || true)"
  DEVICE_MODEL="$(adb_device shell getprop ro.product.model 2>/dev/null | tr -d '\r' || true)"
  ANDROID_RELEASE="$(adb_device shell getprop ro.build.version.release 2>/dev/null | tr -d '\r' || true)"
  ANDROID_API="$(adb_device shell getprop ro.build.version.sdk 2>/dev/null | tr -d '\r' || true)"
  is_emulator="$(adb_device shell getprop ro.kernel.qemu 2>/dev/null | tr -d '\r' || true)"

  [[ "$is_emulator" != "1" && "$DEVICE_SERIAL" != emulator-* ]] || \
    fail "issue #69 requires a physical Android device; selected $DEVICE_SERIAL is an emulator"
  [[ "$ANDROID_API" =~ ^[0-9]+$ ]] || fail "unable to read Android API level"
  log "physical device: $DEVICE_MANUFACTURER $DEVICE_MODEL ($DEVICE_SERIAL), Android $ANDROID_RELEASE API $ANDROID_API"
}

maybe_build() {
  CURRENT_HEAD="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || printf unknown)"
  if [[ "$SKIP_BUILD" == "1" ]]; then
    BUILD_MODE="SKIP_BUILD (APK provenance unverified)"
    warn "--skip-build selected: the installed native APK is NOT verified against HEAD $CURRENT_HEAD"
    warn "A stale APK can invalidate the issue #69 runtime conclusion."
    return
  fi

  BUILD_MODE="built-and-installed from current worktree (HEAD $CURRENT_HEAD)"
  log "building the React Native package"
  (cd "$REPO_ROOT" && yarn build:rn) || fail "yarn build:rn failed"
  log "building/installing the smoke app for $DEVICE_SERIAL"
  (cd "$REPO_ROOT" && ANDROID_SERIAL="$DEVICE_SERIAL" yarn smoke:android) || \
    fail "yarn smoke:android failed"
}

ensure_package_installed() {
  local package_path
  package_path="$(adb_device shell pm path "$APP_PACKAGE" 2>/dev/null | tr -d '\r' || true)"
  [[ "$package_path" == package:* ]] || fail "$APP_PACKAGE is not installed on $DEVICE_SERIAL"
}

grant_notification_permission() {
  if [[ "$ANDROID_API" -ge 33 ]]; then
    adb_device shell pm grant "$APP_PACKAGE" android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 || \
      warn "could not grant POST_NOTIFICATIONS; ensure it is granted on the device"
  fi
}

app_pids() {
  local pids
  pids="$(adb_device shell pidof "$APP_PACKAGE" 2>/dev/null | tr -d '\r' || true)"
  if [[ -z "$pids" ]]; then
    pids="$(adb_device shell ps -A 2>/dev/null | tr -d '\r' | awk -v pkg="$APP_PACKAGE" '$NF == pkg { print $2 }' || true)"
  fi
  printf '%s\n' "$pids" | tr ' ' '\n' | sed '/^$/d'
}

wait_for_no_process() {
  local started="$SECONDS"
  while (( SECONDS - started < PROCESS_TIMEOUT_SECONDS )); do
    if [[ -z "$(app_pids)" ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_single_pid() {
  local started="$SECONDS" pids count
  while (( SECONDS - started < PROCESS_TIMEOUT_SECONDS )); do
    pids="$(app_pids)"
    count="$(printf '%s\n' "$pids" | sed '/^$/d' | wc -l | tr -d ' ')"
    if [[ "$count" == "1" && "$pids" =~ ^[0-9]+$ ]]; then
      printf '%s\n' "$pids"
      return 0
    fi
    sleep 1
  done
  return 1
}

go_home() {
  adb_device shell input keyevent KEYCODE_HOME >/dev/null || fail "unable to send HOME"
  sleep 1
}

kill_app_process() {
  local reason="$1"
  local require_present="${2:-0}"
  if [[ -z "$(app_pids)" ]]; then
    [[ "$require_present" != "1" ]] || fail "$APP_PACKAGE disappeared before controlled am kill ($reason)"
    return 0
  fi
  log "sending HOME and terminating the app process with am kill ($reason)"
  go_home
  adb_device shell am kill "$APP_PACKAGE" >/dev/null || fail "am kill failed ($reason)"
  wait_for_no_process || fail "$APP_PACKAGE process did not terminate after am kill ($reason)"
}

probe_notification_list() {
  local probe_file="$TMP_ROOT/notification-list-probe.txt"
  if adb_device shell cmd notification list 2>"$probe_file.stderr" | tr -d '\r' >"$probe_file" && \
    ! grep -Eiq 'unknown command|error occurred|exception|usage: cmd notification' "$probe_file" && \
    cmd_notification_keys_valid "$probe_file"; then
    NOTIFICATION_LIST_SUPPORTED="1"
    log "active notification source: cmd notification list"
  else
    NOTIFICATION_LIST_SUPPORTED="0"
    warn "cmd notification list is unavailable; using bounded active dumpsys records"
  fi
}

cmd_notification_keys_valid() {
  local file="$1"
  awk -F'|' '
    NF == 0 { next }
    NF < 5 || $1 !~ /^-?[0-9]+$/ || $2 == "" || $3 !~ /^-?[0-9]+$/ { bad=1 }
    END { exit(bad ? 1 : 0) }
  ' "$file"
}

capture_active_notifications() {
  local phase="$1"
  local keys_file="$TMP_ROOT/notifications-${CURRENT_SCENARIO}-${phase}.keys"
  local dump_file="$TMP_ROOT/notifications-${CURRENT_SCENARIO}-${phase}.txt"
  local headers_file="$TMP_ROOT/notifications-${CURRENT_SCENARIO}-${phase}.headers"

  if [[ "$NOTIFICATION_LIST_SUPPORTED" == "1" ]]; then
    if adb_device shell cmd notification list 2>"$keys_file.stderr" | tr -d '\r' >"$keys_file" && \
      ! grep -Eiq 'unknown command|error occurred|exception|usage: cmd notification' "$keys_file" && \
      cmd_notification_keys_valid "$keys_file"; then
      printf 'keys:%s\n' "$keys_file"
      return 0
    fi
    warn "cmd notification list was malformed during $phase; falling back to dumpsys"
  fi

  adb_device shell dumpsys notification --noredact 2>"$dump_file.stderr" | tr -d '\r' >"$dump_file" || \
    return 1
  if grep -Eiq \
    'permission denial|securityexception|unknown service|error dumping service|can.t find service' \
    "$dump_file" "$dump_file.stderr"; then
    return 1
  fi
  if ! grep -Eq '^[[:space:]]*Notification List:[[:space:]]*$' "$dump_file"; then
    grep -Fq 'NotificationRecord(' "$dump_file" && return 1
    grep -Eiq 'Notification Manager|NotificationManager' "$dump_file" || return 1
    : >"$headers_file"
    printf 'headers:%s\n' "$headers_file"
    return 0
  fi
  if ! awk '
      /^[[:space:]]*Notification List:[[:space:]]*$/ { active=1; next }
      active && /^[[:space:]]*$/ { exit }
      active && /NotificationRecord\(/ { print }
    ' "$dump_file" >"$headers_file"; then
    return 1
  fi
  printf 'headers:%s\n' "$headers_file"
}

notification_present_in_snapshot() {
  local snapshot="$1"
  local android_id="$2"
  local kind="${snapshot%%:*}"
  local file="${snapshot#*:}"
  if [[ "$kind" == "keys" ]]; then
    awk -F'|' -v pkg="$APP_PACKAGE" -v id="$android_id" \
      '$2 == pkg && $3 == id { found=1 } END { exit(found ? 0 : 1) }' "$file"
    return
  fi
  awk -v pkg="$APP_PACKAGE" -v id="$android_id" '
    index($0, " pkg=" pkg " ") && index($0, " id=" id " ") { found=1 }
    END { exit(found ? 0 : 1) }
  ' "$file"
}

observe_notification_state() {
  local phase="$1"
  local snapshot a_state="absent" b_state="absent"
  snapshot="$(capture_active_notifications "$phase")" || return 1
  if notification_present_in_snapshot "$snapshot" "$NOTIFICATION_A_ANDROID_ID"; then
    a_state="present"
  fi
  if notification_present_in_snapshot "$snapshot" "$NOTIFICATION_B_ANDROID_ID"; then
    b_state="present"
  fi
  OBSERVED_A_STATE="$a_state"
  OBSERVED_B_STATE="$b_state"
}

assert_notification_state() {
  local phase="$1" expected_a="$2" expected_b="$3" require_no_process="${4:-0}"
  local failure_prefix="${5:-}"
  if ! observe_notification_state "$phase"; then
    fail "${failure_prefix}unable to read active Android notification state during $phase"
  fi
  log "$phase notification state: A=$OBSERVED_A_STATE B=$OBSERVED_B_STATE"
  [[ "$expected_a" == "any" || "$OBSERVED_A_STATE" == "$expected_a" ]] || \
    fail "${failure_prefix}$phase expected A=$expected_a, observed A=$OBSERVED_A_STATE"
  [[ "$expected_b" == "any" || "$OBSERVED_B_STATE" == "$expected_b" ]] || \
    fail "${failure_prefix}$phase expected B=$expected_b, observed B=$OBSERVED_B_STATE"
  if [[ "$require_no_process" == "1" && -n "$(app_pids)" ]]; then
    fail "${failure_prefix}$phase notification-state query unexpectedly started $APP_PACKAGE"
  fi
}

start_logcat_capture() {
  adb_device logcat -c >/dev/null || fail "unable to clear logcat for the correlated test run"
  : >"$LOG_FILE"
  adb_device logcat -v raw >"$LOG_FILE" 2>&1 &
  LOGCAT_PID="$!"
  sleep 1
}

log_cursor() {
  wc -l <"$LOG_FILE" | tr -d ' '
}

parse_result_since() {
  local cursor="$1" scenario="$2" correlation="$3" expected_id="$4"
  node - "$LOG_FILE" "$cursor" "$scenario" "$correlation" "$expected_id" <<'NODE'
const fs = require('fs');
const [, , file, cursorRaw, scenario, correlationId, expectedId] = process.argv;
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(Number(cursorRaw));
for (const line of lines) {
  const marker = line.indexOf('SMOKE:RESULT');
  if (marker === -1) continue;
  const start = line.indexOf('{', marker);
  const end = line.lastIndexOf('}');
  if (start === -1 || end < start) continue;
  let payload;
  try { payload = JSON.parse(line.slice(start, end + 1)); } catch { continue; }
  if (payload.scenario !== scenario || payload.correlationId !== correlationId) continue;
  if (payload.status === 'PASS' && payload.id === expectedId && payload.which === expectedId) {
    process.stdout.write(JSON.stringify(payload));
    process.exit(0);
  }
  process.stdout.write(JSON.stringify(payload));
  process.exit(2);
}
process.exit(3);
NODE
}

parse_simple_result_since() {
  local cursor="$1" scenario="$2"
  node - "$LOG_FILE" "$cursor" "$scenario" <<'NODE'
const fs = require('fs');
const [, , file, cursorRaw, scenario] = process.argv;
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(Number(cursorRaw));
for (const line of lines) {
  const marker = line.indexOf('SMOKE:RESULT');
  if (marker === -1) continue;
  const start = line.indexOf('{', marker);
  const end = line.lastIndexOf('}');
  if (start === -1 || end < start) continue;
  let payload;
  try { payload = JSON.parse(line.slice(start, end + 1)); } catch { continue; }
  if (payload.scenario !== scenario) continue;
  process.stdout.write(JSON.stringify(payload));
  process.exit(payload.status === 'PASS' ? 0 : 2);
}
process.exit(3);
NODE
}

parse_displayed_since() {
  local cursor="$1" expected_a="$2" expected_b="$3"
  node - "$LOG_FILE" "$cursor" "$expected_a" "$expected_b" <<'NODE'
const fs = require('fs');
const [, , file, cursorRaw, expectedA, expectedB] = process.argv;
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(Number(cursorRaw));
for (const line of lines) {
  const marker = line.indexOf('SMOKE:RESULT');
  if (marker === -1) continue;
  const start = line.indexOf('{', marker);
  const end = line.lastIndexOf('}');
  if (start === -1 || end < start) continue;
  let payload;
  try { payload = JSON.parse(line.slice(start, end + 1)); } catch { continue; }
  if (payload.scenario !== 'displayed') continue;
  const ids = Array.isArray(payload.ids) ? payload.ids : [];
  const stateMatches = (expected, id) =>
    expected === 'any' || (expected === 'present' ? ids.includes(id) : !ids.includes(id));
  if (payload.status === 'PASS' && stateMatches(expectedA, 'issue69-a') && stateMatches(expectedB, 'issue69-b')) {
    process.stdout.write(JSON.stringify(payload));
    process.exit(0);
  }
  process.stdout.write(JSON.stringify(payload));
  process.exit(2);
}
process.exit(3);
NODE
}

parse_event_since() {
  local cursor="$1" event_type="$2" correlation="$3" expected_id="$4" expected_action="$5"
  node - "$LOG_FILE" "$cursor" "$event_type" "$correlation" "$expected_id" "$expected_action" <<'NODE'
const fs = require('fs');
const [, , file, cursorRaw, eventType, correlationId, expectedId, expectedAction] = process.argv;
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(Number(cursorRaw));
for (const line of lines) {
  const marker = line.indexOf('SMOKE:EVENT');
  if (marker === -1) continue;
  const start = line.indexOf('{', marker);
  const end = line.lastIndexOf('}');
  if (start === -1 || end < start) continue;
  let payload;
  try { payload = JSON.parse(line.slice(start, end + 1)); } catch { continue; }
  const notification = payload.notification || {};
  const data = notification.data || {};
  if (payload.type !== eventType || data.correlationId !== correlationId) continue;
  const sourceOk = payload.source === 'foreground' || payload.source === 'background';
  const actionOk = !expectedAction || payload.pressAction?.id === expectedAction;
  const exact = sourceOk && notification.id === expectedId && data.smokeScenario === 'issue69' &&
    data.which === expectedId && actionOk;
  process.stdout.write(`${String(payload.source || 'missing')}\n${JSON.stringify(payload)}`);
  process.exit(exact ? 0 : 2);
}
process.exit(3);
NODE
}

wait_for_result() {
  local cursor="$1" scenario="$2" correlation="$3" expected_id="$4"
  local started="$SECONDS" parsed status
  while (( SECONDS - started < RESULT_TIMEOUT_SECONDS )); do
    if parsed="$(parse_result_since "$cursor" "$scenario" "$correlation" "$expected_id")"; then
      log "validated $scenario result: $parsed"
      return 0
    else
      status=$?
      if [[ "$status" == "2" ]]; then
        fail "invalid current-run $scenario result: $parsed"
      fi
    fi
    sleep 1
  done
  fail "timed out waiting for $scenario result with correlationId=$correlation"
}

wait_for_simple_result() {
  local cursor="$1" scenario="$2"
  local started="$SECONDS" parsed status
  while (( SECONDS - started < RESULT_TIMEOUT_SECONDS )); do
    if parsed="$(parse_simple_result_since "$cursor" "$scenario")"; then
      log "validated $scenario readiness result: $parsed"
      return 0
    else
      status=$?
      if [[ "$status" == "2" ]]; then
        fail "invalid $scenario readiness result: $parsed"
      fi
    fi
    sleep 1
  done
  fail "timed out waiting for $scenario readiness result"
}

wait_for_displayed() {
  local cursor="$1" expected_a="$2" expected_b="$3"
  local started="$SECONDS" parsed status
  DISPLAYED_PAYLOAD=""
  DISPLAYED_FAILURE=""
  while (( SECONDS - started < RESULT_TIMEOUT_SECONDS )); do
    if parsed="$(parse_displayed_since "$cursor" "$expected_a" "$expected_b")"; then
      DISPLAYED_PAYLOAD="$parsed"
      return 0
    else
      status=$?
      if [[ "$status" == "2" ]]; then
        DISPLAYED_FAILURE="displayed readout did not match A=$expected_a B=$expected_b: $parsed"
        return 1
      fi
    fi
    sleep 1
  done
  DISPLAYED_FAILURE="timed out waiting for displayed readout"
  return 1
}

wait_for_event() {
  local cursor="$1" event_type="$2" expected_id="$3" expected_action="$4"
  local started="$SECONDS" parsed status source payload
  while (( SECONDS - started < MANUAL_TIMEOUT_SECONDS )); do
    if parsed="$(parse_event_since "$cursor" "$event_type" "$CORRELATION_ID" "$expected_id" "$expected_action")"; then
      source="${parsed%%$'\n'*}"
      payload="${parsed#*$'\n'}"
      EVENT_TYPE="$event_type"
      EVENT_SOURCE="$source"
      EVENT_NOTIFICATION_ID="$expected_id"
      EVENT_WHICH="$expected_id"
      EVENT_ACTION_ID="${expected_action:-n/a}"
      log "validated event: $payload"
      return 0
    else
      status=$?
      if [[ "$status" == "2" ]]; then
        if [[ "$CURRENT_SCENARIO" == "dismiss" ]]; then
          fail "POTENZIALE ROOT CAUSE AGGIUNTIVA: current-run $event_type payload was misrouted: $parsed"
        fi
        fail "current-run $event_type payload was misrouted: $parsed"
      fi
    fi
    sleep 1
  done
  fail "timed out waiting for $event_type on $expected_id (correlationId=$CORRELATION_ID)"
}

launch_uri() {
  local uri="$1" label="$2"
  local output_file="$TMP_ROOT/launch-${CURRENT_SCENARIO}-${label}.txt"
  if ! adb_device shell am start -W \
    -n "$MAIN_ACTIVITY" \
    -a android.intent.action.VIEW \
    -d "$uri" >"$output_file" 2>&1; then
    fail "failed to launch $label; see $output_file"
  fi
  if grep -Eiq 'Error:|Exception|unable to resolve|does not exist|not found' "$output_file"; then
    fail "$label did not launch cleanly; see $output_file"
  fi
}

launch_ready_process() {
  local phase="$1" cursor
  cursor="$(log_cursor)"
  launch_uri "notifykit://smoke/run/listener-only" "ready-$phase"
  wait_for_simple_result "$cursor" "listener-only"
  if ! READY_PID="$(wait_for_single_pid)"; then
    fail "$phase was not observed as one numeric app PID"
  fi
}

post_notification() {
  local which="$1" id scenario uri cursor
  if [[ "$which" == "a" ]]; then
    id="$NOTIFICATION_A_ID"
  else
    id="$NOTIFICATION_B_ID"
  fi
  scenario="issue69-post-$which"
  uri="notifykit://smoke/run/issue69/post-$which?correlationId=$CORRELATION_ID"
  cursor="$(log_cursor)"
  launch_uri "$uri" "post-$which"
  wait_for_result "$cursor" "$scenario" "$CORRELATION_ID" "$id"
}

run_displayed_readout() {
  local phase="$1" expected_a="$2" expected_b="$3" target_variable="$4" cursor
  local failure_prefix="${5:-}"
  cursor="$(log_cursor)"
  launch_uri "notifykit://smoke/run/displayed" "displayed-$phase"
  if ! wait_for_displayed "$cursor" "$expected_a" "$expected_b"; then
    fail "${failure_prefix}$phase $DISPLAYED_FAILURE"
  fi
  log "displayed $phase: $DISPLAYED_PAYLOAD"
  printf -v "$target_variable" '%s' "$DISPLAYED_PAYLOAD"
}

new_correlation_id() {
  local scenario="$1"
  printf 'issue69-%s-%s-%s-%s\n' "$scenario" "$(date -u +%Y%m%dT%H%M%SZ)" "$$" "$RANDOM"
}

reset_run_observations() {
  CURRENT_SCENARIO="$1"
  CORRELATION_ID="$(new_correlation_id "$CURRENT_SCENARIO")"
  P1=""
  P1_TERMINATED="no"
  P2=""
  PIDS_DIFFER="no"
  A_PRE_KILL="unknown"
  A_POST_KILL="unknown"
  AB_PRESENT="no"
  A_FINAL="unknown"
  B_FINAL="unknown"
  DISPLAYED_AFTER_B="not-run"
  DISPLAYED_FINAL="not-run"
  EVENT_TYPE="none"
  EVENT_SOURCE="none"
  EVENT_NOTIFICATION_ID="none"
  EVENT_WHICH="none"
  EVENT_ACTION_ID="none"
  OPTIONAL_B_EVENT="not-run"
  EVENT_B_SOURCE="none"
  EVENT_B_NOTIFICATION_ID="none"
  EVENT_B_WHICH="none"
  EVENT_B_ACTION_ID="none"
  VERDICT="RUNNING"
  FAILURE_REASON=""
  RUN_ACTIVE="1"
  RUN_SUMMARY_PRINTED="0"
  log "starting $CURRENT_SCENARIO correlationId=$CORRELATION_ID"
}

setup_a_and_b_across_processes() {
  local current_pid
  kill_app_process "pre-scenario normalization"

  launch_ready_process "P1"
  P1="$READY_PID"
  post_notification a
  assert_notification_state "pre-kill" present absent
  A_PRE_KILL="$OBSERVED_A_STATE"

  current_pid="$(app_pids)"
  [[ "$current_pid" == "$P1" ]] || fail "app PID changed before controlled P1 death (P1=$P1 current=${current_pid:-none})"
  kill_app_process "P1 process-death gate" 1
  P1_TERMINATED="yes"

  assert_notification_state "post-kill" present absent 1
  A_POST_KILL="$OBSERVED_A_STATE"

  launch_ready_process "P2"
  P2="$READY_PID"
  [[ "$P2" != "$P1" ]] || fail "P2 equals P1 ($P1); new process lifetime was not proven"
  PIDS_DIFFER="yes"
  post_notification b

  assert_notification_state "after-post-b" present present
  AB_PRESENT="yes"
  run_displayed_readout "after-b" present present DISPLAYED_AFTER_B
  current_pid="$(app_pids)"
  [[ "$current_pid" == "$P2" ]] || fail "app PID changed during B/displayed setup (P2=$P2 current=${current_pid:-none})"
}

finish_successful_run() {
  VERDICT="PASS"
  COMPLETED_SCENARIOS+=("$CURRENT_SCENARIO")
  COMPLETED_CORRELATIONS+=("$CORRELATION_ID")
  print_run_summary
  RUN_ACTIVE="0"
}

run_action_scenario() {
  local cursor primary_type primary_source primary_id primary_which primary_action
  reset_run_observations "action"
  setup_a_and_b_across_processes

  go_home
  cursor="$(log_cursor)"
  printf '\n[issue69] MANUAL: Open the notification tray and tap "Done" on "Issue 69 A".\n'
  printf '[issue69] Waiting up to %ss for the exact correlated ACTION_PRESS marker...\n' "$MANUAL_TIMEOUT_SECONDS"
  wait_for_event "$cursor" "ACTION_PRESS" "$NOTIFICATION_A_ID" "$ACTION_ID"
  primary_type="$EVENT_TYPE"
  primary_source="$EVENT_SOURCE"
  primary_id="$EVENT_NOTIFICATION_ID"
  primary_which="$EVENT_WHICH"
  primary_action="$EVENT_ACTION_ID"

  if [[ "$RUN_ACTION_B" == "1" ]]; then
    assert_notification_state "before-action-b" any present
    go_home
    cursor="$(log_cursor)"
    printf '\n[issue69] MANUAL: Open the tray and tap "Done" on "Issue 69 B".\n'
    printf '[issue69] Waiting up to %ss for the exact correlated ACTION_PRESS marker...\n' "$MANUAL_TIMEOUT_SECONDS"
    wait_for_event "$cursor" "ACTION_PRESS" "$NOTIFICATION_B_ID" "$ACTION_ID"
    OPTIONAL_B_EVENT="PASS"
    EVENT_B_SOURCE="$EVENT_SOURCE"
    EVENT_B_NOTIFICATION_ID="$EVENT_NOTIFICATION_ID"
    EVENT_B_WHICH="$EVENT_WHICH"
    EVENT_B_ACTION_ID="$EVENT_ACTION_ID"
    EVENT_TYPE="$primary_type"
    EVENT_SOURCE="$primary_source"
    EVENT_NOTIFICATION_ID="$primary_id"
    EVENT_WHICH="$primary_which"
    EVENT_ACTION_ID="$primary_action"
  fi

  if [[ "$RUN_ACTION_B" == "1" ]]; then
    assert_notification_state "action-final" any any
  else
    assert_notification_state "action-final" any present
  fi
  A_FINAL="$OBSERVED_A_STATE"
  B_FINAL="$OBSERVED_B_STATE"
  if [[ "$RUN_ACTION_B" == "1" ]]; then
    run_displayed_readout "action-final" any any DISPLAYED_FINAL
  else
    run_displayed_readout "action-final" any present DISPLAYED_FINAL
  fi
  finish_successful_run
}

run_dismiss_scenario() {
  local cursor
  reset_run_observations "dismiss"
  setup_a_and_b_across_processes

  go_home
  cursor="$(log_cursor)"
  printf '\n[issue69] MANUAL: Open the notification tray and swipe/dismiss "Issue 69 A".\n'
  printf '[issue69] Waiting up to %ss for the exact correlated DISMISSED marker...\n' "$MANUAL_TIMEOUT_SECONDS"
  wait_for_event "$cursor" "DISMISSED" "$NOTIFICATION_A_ID" ""

  assert_notification_state \
    "dismiss-final" absent present 0 "POTENZIALE ROOT CAUSE AGGIUNTIVA: "
  A_FINAL="$OBSERVED_A_STATE"
  B_FINAL="$OBSERVED_B_STATE"
  run_displayed_readout \
    "dismiss-final" absent present DISPLAYED_FINAL "POTENZIALE ROOT CAUSE AGGIUNTIVA: "
  finish_successful_run
}

print_final_summary() {
  local i
  printf '\n## Issue #69 harness summary\n'
  printf 'device: %s %s (%s)\n' "$DEVICE_MANUFACTURER" "$DEVICE_MODEL" "$DEVICE_SERIAL"
  printf 'android: %s API %s\n' "$ANDROID_RELEASE" "$ANDROID_API"
  printf 'repository HEAD: %s\n' "$CURRENT_HEAD"
  printf 'build mode: %s\n' "$BUILD_MODE"
  for ((i = 0; i < ${#COMPLETED_SCENARIOS[@]}; i++)); do
    printf '  - %s (%s): PASS\n' "${COMPLETED_SCENARIOS[$i]}" "${COMPLETED_CORRELATIONS[$i]}"
  done
  printf 'overall verdict: PASS\n'
}

prepare() {
  ensure_tools
  resolve_device
  load_device_info
  TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/issue69-pending-intent.XXXXXX")"
  LOG_FILE="$TMP_ROOT/logcat.txt"
  maybe_build
  ensure_package_installed
  grant_notification_permission
  kill_app_process "post-build normalization"
  probe_notification_list
  start_logcat_capture
}

main() {
  parse_args "$@"
  prepare
  case "$MODE" in
    action)
      run_action_scenario
      ;;
    dismiss)
      run_dismiss_scenario
      ;;
    all)
      run_action_scenario
      run_dismiss_scenario
      ;;
  esac
  print_final_summary
}

main "$@"
