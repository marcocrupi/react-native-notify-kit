#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SMOKE_ANDROID_DIR="$REPO_ROOT/apps/smoke/android"
APP_BUILD_GRADLE="$SMOKE_ANDROID_DIR/app/build.gradle"

ADB_BIN="${ADB:-adb}"
FGS_MANIFEST_TYPE="${ISSUE44_FGS_MANIFEST_TYPE:-microphone|dataSync}"
SCENARIO_TYPES="${ISSUE44_TYPES:-microphone,dataSync}"
READY_TIMEOUT_SECONDS="${ISSUE44_READY_TIMEOUT_SECONDS:-60}"
RESULT_TIMEOUT_SECONDS="${ISSUE44_RESULT_TIMEOUT_SECONDS:-75}"
POST_RESULT_SETTLE_SECONDS="${ISSUE44_POST_RESULT_SETTLE_SECONDS:-5}"
GRANT_PERMISSIONS="${ISSUE44_GRANT_PERMISSIONS:-1}"
LOG_FILE="${ISSUE44_LOG_FILE:-$(mktemp -t issue44-fgs-stop-logcat.XXXXXX)}"
DEEPLINK="notifykit://issue44/fgs-stop?types=${SCENARIO_TYPES}"
METRO_STATUS_URL="http://localhost:8081/status"
METRO_START_HINT="cd apps/smoke && npx react-native start --port 8081"

LOGCAT_PID=""
DEVICE_SERIAL=""
APP_PACKAGE=""

log() {
  printf '[issue44] %s\n' "$*"
}

print_log_excerpt() {
  if [[ ! -f "$LOG_FILE" ]]; then
    return
  fi

  printf '%s\n' '--- issue44 log excerpt ---'
  grep -E \
    'ISSUE44:|SMOKE:RESULT|AndroidRuntime|FATAL EXCEPTION|ForegroundServiceDidNotStartInTimeException|SecurityException|RuntimeException: react-native-notify-kit: defensive startForeground\(\) failed\.|Unable to load script|index\.android\.bundle|Metro/bundle|Could not connect to (the )?(development server|Metro)|Failed to load bundle|(^|[^[:alnum:]_])ANR([^[:alnum:]_]|$)' \
    "$LOG_FILE" | tail -n 160 || true
  printf '%s\n' '--- issue44 recent log tail ---'
  tail -n 80 "$LOG_FILE" || true
  printf '%s\n' "--- full log: $LOG_FILE ---"
}

cleanup() {
  if [[ -n "$LOGCAT_PID" ]] && kill -0 "$LOGCAT_PID" 2>/dev/null; then
    kill "$LOGCAT_PID" 2>/dev/null || true
    wait "$LOGCAT_PID" 2>/dev/null || true
  fi
}

fail() {
  printf '[issue44] FAIL: %s\n' "$*" >&2
  print_log_excerpt >&2
  exit 1
}

trap cleanup EXIT

detect_package() {
  local detected

  detected="$(
    awk '$1 == "applicationId" { gsub(/"/, "", $2); print $2; exit }' "$APP_BUILD_GRADLE"
  )"

  if [[ -n "${ISSUE44_PACKAGE:-}" ]]; then
    printf '%s\n' "$ISSUE44_PACKAGE"
    return
  fi

  if [[ -n "$detected" ]]; then
    printf '%s\n' "$detected"
    return
  fi

  printf '%s\n' 'com.notifeeexample'
}

resolve_device() {
  local state
  local devices=()
  local line

  if [[ -n "${ANDROID_SERIAL:-}" ]]; then
    state="$("$ADB_BIN" -s "$ANDROID_SERIAL" get-state 2>/dev/null || true)"
    if [[ "$state" != "device" ]]; then
      fail "ANDROID_SERIAL is set to '$ANDROID_SERIAL', but adb state is '${state:-unavailable}'"
    fi

    DEVICE_SERIAL="$ANDROID_SERIAL"
    return
  fi

  while IFS= read -r line; do
    if [[ -n "$line" ]]; then
      devices+=("$line")
    fi
  done < <("$ADB_BIN" devices | awk 'NR > 1 && $2 == "device" { print $1 }')

  if [[ "${#devices[@]}" -eq 0 ]]; then
    fail 'no adb device connected'
  fi

  if [[ "${#devices[@]}" -gt 1 ]]; then
    printf '[issue44] connected devices:\n' >&2
    "$ADB_BIN" devices -l >&2
    fail 'multiple adb devices connected; set ANDROID_SERIAL'
  fi

  DEVICE_SERIAL="${devices[0]}"
}

adb_device() {
  "$ADB_BIN" -s "$DEVICE_SERIAL" "$@"
}

read_api_level() {
  adb_device shell getprop ro.build.version.sdk | tr -d '\r\n'
}

check_api_level() {
  local api_level

  api_level="$(read_api_level)"
  if ! [[ "$api_level" =~ ^[0-9]+$ ]]; then
    fail "unable to read numeric Android API level from device: '${api_level:-empty}'"
  fi

  if (( api_level < 34 )); then
    fail "Android API level $api_level is below required API 34"
  fi

  log "device=$DEVICE_SERIAL api=$api_level"
}

gradle_install_smoke_app() {
  log "installing smoke app with notifeeForegroundServiceType=$FGS_MANIFEST_TYPE"
  (
    cd "$SMOKE_ANDROID_DIR"
    ANDROID_SERIAL="$DEVICE_SERIAL" ./gradlew \
      :app:installDebug \
      "-PnotifeeForegroundServiceType=${FGS_MANIFEST_TYPE}"
  )
}

grant_permission_if_possible() {
  local permission="$1"

  if adb_device shell pm grant "$APP_PACKAGE" "$permission" >/dev/null 2>&1; then
    log "granted $permission"
    return
  fi

  log "could not grant $permission; harness will fail clearly if it is required"
}

grant_runtime_permissions() {
  if [[ "$GRANT_PERMISSIONS" != "1" && "$GRANT_PERMISSIONS" != "true" ]]; then
    log 'runtime permission grant disabled by ISSUE44_GRANT_PERMISSIONS'
    return
  fi

  grant_permission_if_possible 'android.permission.RECORD_AUDIO'
  grant_permission_if_possible 'android.permission.POST_NOTIFICATIONS'
}

configure_adb_reverse() {
  log 'configuring adb reverse tcp:8081 tcp:8081'
  if ! adb_device reverse tcp:8081 tcp:8081 >/dev/null 2>&1; then
    fail "adb reverse tcp:8081 tcp:8081 failed for device $DEVICE_SERIAL; reconnect the device or run it manually, then retry"
  fi

  log 'ISSUE44_SCRIPT:ADB_REVERSE_OK'
}

check_metro_reachable() {
  local status

  if [[ "${ISSUE44_SKIP_METRO_CHECK:-0}" == "1" || "${ISSUE44_SKIP_METRO_CHECK:-0}" == "true" ]]; then
    log "ISSUE44_SCRIPT:METRO_CHECK_SKIPPED; ensure Metro is reachable from the device through adb reverse tcp:8081 tcp:8081"
    return
  fi

  if ! command -v curl >/dev/null 2>&1; then
    fail "curl is required to check Metro at $METRO_STATUS_URL; install curl or set ISSUE44_SKIP_METRO_CHECK=1 only after verifying Metro manually. Start Metro with: $METRO_START_HINT"
  fi

  if ! status="$(curl -fsS --max-time 3 "$METRO_STATUS_URL" 2>/dev/null)"; then
    fail "Metro is not reachable at $METRO_STATUS_URL. Start Metro with: $METRO_START_HINT, then retry"
  fi

  if [[ "$status" != *'packager-status:running'* ]]; then
    fail "Metro status endpoint returned an unexpected response: ${status:0:160}. Restart Metro with: $METRO_START_HINT, then retry"
  fi

  log 'ISSUE44_SCRIPT:METRO_OK'
}

fatal_log_present() {
  if grep -E -q \
    'AndroidRuntime|FATAL EXCEPTION|RuntimeException: react-native-notify-kit: defensive startForeground\(\) failed\.|ForegroundServiceDidNotStartInTimeException|(^|[^[:alnum:]_])ANR([^[:alnum:]_]|$)' \
    "$LOG_FILE"; then
    return 0
  fi

  if grep -E -q \
    "SecurityException.*(${APP_PACKAGE}|ForegroundService|react-native-notify-kit|startForeground|FOREGROUND_SERVICE)" \
    "$LOG_FILE"; then
    return 0
  fi

  if grep -E -q \
    "(${APP_PACKAGE}|ForegroundService|react-native-notify-kit|startForeground|FOREGROUND_SERVICE).*SecurityException" \
    "$LOG_FILE"; then
    return 0
  fi

  return 1
}

metro_bundle_error_present() {
  if [[ ! -f "$LOG_FILE" ]]; then
    return 1
  fi

  grep -E -q \
    "Unable to load script\. Make sure you're running Metro|index\.android\.bundle.*packaged correctly for release|Could not connect to (the )?(development server|Metro)|Failed to load bundle|No bundle URL present" \
    "$LOG_FILE"
}

fail_metro_bundle_unavailable() {
  fail "Metro/bundle not available: the debug JS bundle was not loaded. Start Metro with: $METRO_START_HINT; ensure adb reverse tcp:8081 tcp:8081 succeeds, then retry"
}

wait_for_fixed_log() {
  local pattern="$1"
  local timeout_seconds="$2"
  local description="$3"
  local start_seconds="$SECONDS"

  while (( SECONDS - start_seconds < timeout_seconds )); do
    if grep -F -q "$pattern" "$LOG_FILE"; then
      log "saw $description"
      return 0
    fi

    if metro_bundle_error_present; then
      fail_metro_bundle_unavailable
    fi

    if fatal_log_present; then
      fail "fatal log detected while waiting for $description"
    fi

    sleep 1
  done

  if metro_bundle_error_present; then
    fail_metro_bundle_unavailable
  fi

  if [[ "$description" == "READY_FOR_BACKGROUND" ]]; then
    fail "timed out after ${timeout_seconds}s waiting for $description; this is not classified as a core fix failure. Verify Metro is running with: $METRO_START_HINT, and that adb reverse tcp:8081 tcp:8081 is active"
  fi

  fail "timed out after ${timeout_seconds}s waiting for $description"
}

wait_for_smoke_result() {
  local start_seconds="$SECONDS"

  while (( SECONDS - start_seconds < RESULT_TIMEOUT_SECONDS )); do
    if grep -F 'SMOKE:RESULT' "$LOG_FILE" | grep -F '"scenario":"issue44-fgs-stop"' >/dev/null; then
      log 'saw issue44 SMOKE:RESULT'
      return 0
    fi

    if metro_bundle_error_present; then
      fail_metro_bundle_unavailable
    fi

    if fatal_log_present; then
      fail 'fatal log detected while waiting for SMOKE:RESULT'
    fi

    sleep 1
  done

  fail "timed out after ${RESULT_TIMEOUT_SECONDS}s waiting for issue44 SMOKE:RESULT"
}

start_logcat_capture() {
  log "clearing logcat"
  adb_device logcat -c

  log "capturing logcat to $LOG_FILE"
  : >"$LOG_FILE"
  adb_device logcat -v time >"$LOG_FILE" 2>&1 &
  LOGCAT_PID="$!"
  sleep 1
}

launch_deep_link() {
  log "launching $DEEPLINK"
  adb_device shell am start \
    -W \
    -a android.intent.action.VIEW \
    -d "$DEEPLINK" \
    -p "$APP_PACKAGE"
}

assert_pass_result() {
  local result_line

  log "waiting ${POST_RESULT_SETTLE_SECONDS}s for delayed fatal logs"
  sleep "$POST_RESULT_SETTLE_SECONDS"

  if metro_bundle_error_present; then
    fail_metro_bundle_unavailable
  fi

  if fatal_log_present; then
    fail 'fatal log detected after SMOKE:RESULT'
  fi

  result_line="$(
    grep -F 'SMOKE:RESULT' "$LOG_FILE" |
      grep -F '"scenario":"issue44-fgs-stop"' |
      tail -n 1 || true
  )"

  if [[ "$result_line" == *'"status":"PASS"'* ]]; then
    log 'PASS: issue44-fgs-stop completed without fatal log markers'
    print_log_excerpt
    return
  fi

  fail "issue44-fgs-stop did not report PASS: ${result_line:-missing result line}"
}

main() {
  APP_PACKAGE="$(detect_package)"
  log "package=$APP_PACKAGE"
  log "manifestType=$FGS_MANIFEST_TYPE scenarioTypes=$SCENARIO_TYPES"

  resolve_device
  check_api_level
  gradle_install_smoke_app
  grant_runtime_permissions
  configure_adb_reverse
  check_metro_reachable
  start_logcat_capture
  launch_deep_link
  wait_for_fixed_log 'ISSUE44:READY_FOR_BACKGROUND' "$READY_TIMEOUT_SECONDS" 'READY_FOR_BACKGROUND'

  log 'sending HOME'
  adb_device shell input keyevent KEYCODE_HOME

  wait_for_smoke_result
  assert_pass_result
}

main "$@"
