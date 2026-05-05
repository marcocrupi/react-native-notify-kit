#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ADB="${ADB:-adb}"
APP_PACKAGE="${APP_PACKAGE:-com.notifeeexample}"
SCENARIO="${SCENARIO:-all}"
SKIP_BUILD="${SKIP_BUILD:-1}"
LOG_FILE="${LOG_FILE:-/tmp/react-native-notify-kit-smoke-event-dispatch.log}"
TMP_ROOT="${TMPDIR:-/tmp}/react-native-notify-kit-smoke-event-dispatch.$$"
UI_DUMP="$TMP_ROOT/window.xml"
EVENT_WAIT_SECONDS="${EVENT_WAIT_SECONDS:-6}"
APP_START_WAIT_SECONDS="${APP_START_WAIT_SECONDS:-3}"

ADB_ARGS=()
SERIAL=""
DEVICE_MANUFACTURER=""
DEVICE_MODEL=""
ANDROID_RELEASE=""
ANDROID_API=""
SCREEN_WIDTH=1080
SCREEN_HEIGHT=2400

SCENARIO_NAMES=()
SCENARIO_RESULTS=()

CURRENT_SCENARIO=""
CURRENT_LOG_FILE=""
SCENARIO_STATUS="PASS"
SCENARIO_NOTES=()
OBS_FOREGROUND=""
OBS_BACKGROUND=""
OBS_INITIAL=""
OBS_APP_OPENED="unknown"

SUPPORTED_SCENARIOS=(
  "action-no-launch-background"
  "action-no-launch-killed"
  "action-with-launch-background"
  "pressaction-null-background"
  "default-body-background"
)

usage() {
  cat <<EOF
Android event dispatch smoke automation

Usage:
  ANDROID_SERIAL=<device> bash scripts/smoke-android-event-dispatch.sh --scenario action-no-launch-background
  ANDROID_SERIAL=<device> bash scripts/smoke-android-event-dispatch.sh --scenario action-no-launch-killed
  ANDROID_SERIAL=<device> bash scripts/smoke-android-event-dispatch.sh --scenario action-with-launch-background
  ANDROID_SERIAL=<device> bash scripts/smoke-android-event-dispatch.sh --scenario pressaction-null-background
  ANDROID_SERIAL=<device> bash scripts/smoke-android-event-dispatch.sh --scenario default-body-background
  ANDROID_SERIAL=<device> bash scripts/smoke-android-event-dispatch.sh --scenario all
  bash scripts/smoke-android-event-dispatch.sh --scenario list

Environment:
  ANDROID_SERIAL=<device serial>  optional when exactly one adb device is connected
  APP_PACKAGE=$APP_PACKAGE
  SCENARIO=$SCENARIO
  SKIP_BUILD=$SKIP_BUILD             default 1; set to 0 to run yarn smoke:android first
  LOG_FILE=$LOG_FILE

Notes:
  After Android native changes, run a clean uninstall/reinstall of the smoke app
  before trusting runtime failures; stale installs can produce false FAILs.
  This script does not implement CLEAN_INSTALL; SKIP_BUILD=0 only runs yarn smoke:android.
EOF
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

note_partial() {
  if [[ "$SCENARIO_STATUS" == "PASS" ]]; then
    SCENARIO_STATUS="PARTIAL"
  fi
  SCENARIO_NOTES+=("$*")
}

note_fail() {
  SCENARIO_STATUS="FAIL"
  SCENARIO_NOTES+=("$*")
}

print_list() {
  printf 'Supported scenarios:\n'
  local scenario
  for scenario in "${SUPPORTED_SCENARIOS[@]}"; do
    printf '  %s\n' "$scenario"
  done
  printf '  all\n'
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h | --help | help)
        usage
        exit 0
        ;;
      --scenario)
        [[ $# -ge 2 ]] || fail "--scenario requires a value"
        SCENARIO="$2"
        shift 2
        ;;
      --scenario=*)
        SCENARIO="${1#--scenario=}"
        shift
        ;;
      *)
        fail "unknown argument: $1"
        ;;
    esac
  done
}

scenario_supported() {
  local candidate="$1"
  local scenario
  for scenario in "${SUPPORTED_SCENARIOS[@]}"; do
    [[ "$candidate" == "$scenario" ]] && return 0
  done
  return 1
}

ensure_tools() {
  command -v "$ADB" >/dev/null 2>&1 || fail "adb not found in PATH"
  command -v perl >/dev/null 2>&1 || fail "perl not found in PATH"
}

resolve_device() {
  if [[ -n "${ANDROID_SERIAL:-}" ]]; then
    SERIAL="$ANDROID_SERIAL"
    ADB_ARGS=(-s "$SERIAL")
    return
  fi

  local devices
  devices="$("$ADB" devices | awk 'NR > 1 && $2 == "device" { print $1 }')"

  local count
  count="$(printf '%s\n' "$devices" | sed '/^$/d' | wc -l | tr -d ' ')"

  if [[ "$count" == "0" ]]; then
    "$ADB" devices >&2
    fail "no Android device connected"
  fi

  if [[ "$count" != "1" ]]; then
    "$ADB" devices >&2
    fail "multiple Android devices connected; set ANDROID_SERIAL"
  fi

  SERIAL="$(printf '%s\n' "$devices" | sed '/^$/d' | head -n 1)"
  ADB_ARGS=(-s "$SERIAL")
}

adb_device() {
  "$ADB" "${ADB_ARGS[@]}" "$@"
}

load_device_info() {
  DEVICE_MANUFACTURER="$(adb_device shell getprop ro.product.manufacturer | tr -d '\r')"
  DEVICE_MODEL="$(adb_device shell getprop ro.product.model | tr -d '\r')"
  ANDROID_RELEASE="$(adb_device shell getprop ro.build.version.release | tr -d '\r')"
  ANDROID_API="$(adb_device shell getprop ro.build.version.sdk | tr -d '\r')"

  local wm_size
  wm_size="$(adb_device shell wm size 2>/dev/null | tr -d '\r' || true)"
  if [[ "$wm_size" =~ ([0-9]+)x([0-9]+) ]]; then
    SCREEN_WIDTH="${BASH_REMATCH[1]}"
    SCREEN_HEIGHT="${BASH_REMATCH[2]}"
  fi
}

ensure_package_installed() {
  if ! adb_device shell pm path "$APP_PACKAGE" >/dev/null 2>&1; then
    fail "$APP_PACKAGE is not installed. Run with SKIP_BUILD=0 or install the smoke app first."
  fi
}

maybe_build() {
  case "$SKIP_BUILD" in
    1 | true | TRUE | yes | YES)
      return
      ;;
  esac

  printf '[smoke-event] building smoke app via yarn smoke:android\n'
  (cd "$REPO_ROOT" && ANDROID_SERIAL="$SERIAL" yarn smoke:android)
}

wake_device() {
  adb_device shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
  adb_device shell wm dismiss-keyguard >/dev/null 2>&1 || true
}

grant_post_notifications() {
  if [[ "${ANDROID_API:-0}" =~ ^[0-9]+$ ]] && [[ "$ANDROID_API" -ge 33 ]]; then
    adb_device shell pm grant "$APP_PACKAGE" android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 || true
  fi
}

clear_logcat() {
  adb_device logcat -c >/dev/null
}

collect_logcat() {
  adb_device logcat -d -v time >"$CURRENT_LOG_FILE" 2>/dev/null || true
  {
    printf '\n===== %s =====\n' "$CURRENT_SCENARIO"
    cat "$CURRENT_LOG_FILE"
  } >>"$LOG_FILE"
}

dump_ui() {
  mkdir -p "$TMP_ROOT"
  rm -f "$UI_DUMP"
  local remote="/sdcard/react-native-notify-kit-smoke-window.xml"
  adb_device shell uiautomator dump "$remote" >/dev/null 2>&1 || return 1
  adb_device pull "$remote" "$UI_DUMP" >/dev/null 2>&1 || return 1
  adb_device shell rm "$remote" >/dev/null 2>&1 || true
  [[ -s "$UI_DUMP" ]]
}

find_text_bounds() {
  local needle="$1"
  NEEDLE="$needle" perl -0777 -ne '
my $needle = $ENV{NEEDLE};
while (/<node\b[^>]*>/g) {
  my $node = $&;
  my ($text) = $node =~ /\btext="([^"]*)"/;
  my ($desc) = $node =~ /\bcontent-desc="([^"]*)"/;
  for my $value ($text, $desc) {
    next unless defined $value;
    $value =~ s/&quot;/"/g;
    $value =~ s/&lt;/</g;
    $value =~ s/&gt;/>/g;
    $value =~ s/&amp;/&/g;
    next unless $value eq $needle;
    if ($node =~ /\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) {
      print "$1 $2 $3 $4\n";
      exit 0;
    }
  }
}
exit 1;
' "$UI_DUMP"
}

tap_text_once() {
  local text="$1"
  dump_ui || return 1

  local bounds
  bounds="$(find_text_bounds "$text")" || return 1

  local x1 y1 x2 y2
  read -r x1 y1 x2 y2 <<<"$bounds"
  local x=$(((x1 + x2) / 2))
  local y=$(((y1 + y2) / 2))
  adb_device shell input tap "$x" "$y" >/dev/null
}

scroll_down() {
  local x=$((SCREEN_WIDTH / 2))
  local y_start=$((SCREEN_HEIGHT * 8 / 10))
  local y_end=$((SCREEN_HEIGHT * 3 / 10))
  adb_device shell input swipe "$x" "$y_start" "$x" "$y_end" 250 >/dev/null 2>&1 || true
}

scroll_up() {
  local x=$((SCREEN_WIDTH / 2))
  local y_start=$((SCREEN_HEIGHT * 3 / 10))
  local y_end=$((SCREEN_HEIGHT * 8 / 10))
  adb_device shell input swipe "$x" "$y_start" "$x" "$y_end" 250 >/dev/null 2>&1 || true
}

scroll_app_to_top() {
  scroll_up
  scroll_up
  scroll_up
}

tap_text() {
  local text="$1"
  local attempts="${2:-10}"
  local i
  for ((i = 1; i <= attempts; i++)); do
    if tap_text_once "$text"; then
      return 0
    fi
    scroll_down
    sleep 0.4
  done
  return 1
}

find_text_center() {
  local text="$1"
  dump_ui || return 1

  local bounds
  bounds="$(find_text_bounds "$text")" || return 1

  local x1 y1 x2 y2
  read -r x1 y1 x2 y2 <<<"$bounds"
  printf '%s %s\n' "$(((x1 + x2) / 2))" "$(((y1 + y2) / 2))"
}

expand_notification_by_title() {
  local title="$1"
  local center
  center="$(find_text_center "$title")" || return 1

  local x y
  read -r x y <<<"$center"
  local y_end=$((y + SCREEN_HEIGHT / 5))
  if [[ "$y_end" -gt $((SCREEN_HEIGHT - 40)) ]]; then
    y_end=$((SCREEN_HEIGHT - 40))
  fi

  adb_device shell input swipe "$x" "$y" "$x" "$y_end" 300 >/dev/null 2>&1 || true
}

tap_notification_action() {
  local action_text="$1"
  local title="$2"

  if tap_text_once "$action_text"; then
    return 0
  fi

  expand_notification_by_title "$title" || true
  sleep 0.5

  if tap_text_once "$action_text"; then
    return 0
  fi

  tap_text "$action_text" 5
}

tap_app_text() {
  local text="$1"
  scroll_app_to_top
  tap_text "$text" 12
}

dismiss_possible_alert() {
  tap_text_once "OK" >/dev/null 2>&1 || true
}

launch_app() {
  wake_device
  adb_device shell monkey -p "$APP_PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null
  sleep "$APP_START_WAIT_SECONDS"
  dismiss_possible_alert
}

go_home() {
  adb_device shell input keyevent KEYCODE_HOME >/dev/null 2>&1 || true
  sleep 1
}

open_notification_shade() {
  adb_device shell cmd statusbar expand-notifications >/dev/null 2>&1 || true
  sleep 1
  dump_ui >/dev/null 2>&1 || adb_device shell input swipe "$((SCREEN_WIDTH / 2))" 0 "$((SCREEN_WIDTH / 2))" "$((SCREEN_HEIGHT * 7 / 10))" 300 >/dev/null 2>&1 || true
  sleep 1
}

pidof_app() {
  local pid
  pid="$(adb_device shell pidof "$APP_PACKAGE" 2>/dev/null | tr -d '\r' || true)"
  if [[ -n "$pid" ]]; then
    printf '%s\n' "$pid"
    return
  fi

  adb_device shell ps -A 2>/dev/null | tr -d '\r' | awk -v pkg="$APP_PACKAGE" '$NF == pkg { print $2 }' | head -n 1
}

kill_like_app() {
  go_home
  adb_device shell am kill "$APP_PACKAGE" >/dev/null 2>&1 || true
  sleep 2

  local pid_after
  pid_after="$(pidof_app)"
  if [[ -n "$pid_after" ]]; then
    note_partial "am kill did not stop $APP_PACKAGE; pid still present: $pid_after"
  fi
}

focus_dump() {
  {
    adb_device shell dumpsys window 2>/dev/null | tr -d '\r' | grep -E 'mCurrentFocus|mFocusedApp|topResumedActivity' || true
    adb_device shell dumpsys activity activities 2>/dev/null | tr -d '\r' | grep -E 'mResumedActivity|topResumedActivity' | head -n 5 || true
  }
}

is_app_foreground() {
  focus_dump | grep -Fq "$APP_PACKAGE"
}

refresh_observations() {
  OBS_FOREGROUND="$(grep -E '\[ForegroundEvent\]' "$CURRENT_LOG_FILE" | tail -n 1 || true)"
  OBS_BACKGROUND="$(grep -E '\[BackgroundEvent\]' "$CURRENT_LOG_FILE" | tail -n 1 || true)"
  OBS_INITIAL="$(grep -E '\[InitialNotification\]' "$CURRENT_LOG_FILE" | tail -n 1 || true)"
}

assert_log_regex() {
  local regex="$1"
  local message="$2"
  if ! grep -E -q "$regex" "$CURRENT_LOG_FILE"; then
    note_fail "$message"
  fi
}

assert_no_log_regex() {
  local regex="$1"
  local message="$2"
  if grep -E -q "$regex" "$CURRENT_LOG_FILE"; then
    note_fail "$message"
  fi
}

set_app_opened_observation() {
  if is_app_foreground; then
    OBS_APP_OPENED="yes"
  else
    OBS_APP_OPENED="no"
  fi
}

start_scenario() {
  CURRENT_SCENARIO="$1"
  CURRENT_LOG_FILE="$TMP_ROOT/${CURRENT_SCENARIO}.log"
  SCENARIO_STATUS="PASS"
  SCENARIO_NOTES=()
  OBS_FOREGROUND=""
  OBS_BACKGROUND=""
  OBS_INITIAL=""
  OBS_APP_OPENED="unknown"
  clear_logcat
}

create_notification_from_app() {
  local label="$1"
  launch_app || return 1
  tap_app_text "$label" || return 1
  sleep 1.5
}

print_scenario_report() {
  refresh_observations

  SCENARIO_NAMES+=("$CURRENT_SCENARIO")
  SCENARIO_RESULTS+=("$SCENARIO_STATUS")

  printf '\n## Android event dispatch smoke result\n'
  printf 'device: %s %s (%s)\n' "$DEVICE_MANUFACTURER" "$DEVICE_MODEL" "$SERIAL"
  printf 'api: %s\n' "$ANDROID_API"
  printf 'scenario: %s\n' "$CURRENT_SCENARIO"
  printf 'result: %s\n' "$SCENARIO_STATUS"
  printf 'observed foreground event: %s\n' "${OBS_FOREGROUND:-none}"
  printf 'observed background event: %s\n' "${OBS_BACKGROUND:-none}"
  printf 'observed initial notification: %s\n' "${OBS_INITIAL:-none}"
  printf 'app opened: %s\n' "$OBS_APP_OPENED"
  printf 'log file: %s\n' "$CURRENT_LOG_FILE"
  if [[ "${#SCENARIO_NOTES[@]}" -gt 0 ]]; then
    printf 'notes:\n'
    local note
    for note in "${SCENARIO_NOTES[@]}"; do
      printf '  - %s\n' "$note"
    done
  fi
  printf 'relevant logs:\n'
  grep -E '\[(ForegroundEvent|BackgroundEvent|InitialNotification)\]|ACTION_PRESS|PRESS|smoke-' "$CURRENT_LOG_FILE" | tail -n 20 | sed 's/^/  /' || printf '  none\n'
}

finish_scenario() {
  collect_logcat
  set_app_opened_observation
  print_scenario_report
}

run_action_no_launch_background() {
  start_scenario "action-no-launch-background"

  if ! create_notification_from_app "Android Event: Action no launch"; then
    note_fail "unable to create action no-launch notification from smoke UI"
    finish_scenario
    return
  fi

  go_home
  open_notification_shade
  if ! tap_notification_action "NO_LAUNCH_ACTION" "Smoke Action No Launch"; then
    note_fail "unable to tap NO_LAUNCH_ACTION via UI Automator"
  fi

  sleep "$EVENT_WAIT_SECONDS"
  collect_logcat
  set_app_opened_observation

  assert_log_regex '\[BackgroundEvent\] type=ACTION_PRESS id=smoke-action-no-launch action=smoke-no-launch-action' \
    "missing background ACTION_PRESS for smoke-action-no-launch"
  if [[ "$OBS_APP_OPENED" == "yes" ]]; then
    note_fail "main app is foreground after no-launch action"
  fi

  print_scenario_report
}

run_action_no_launch_killed() {
  start_scenario "action-no-launch-killed"

  if ! create_notification_from_app "Android Event: Action no launch"; then
    note_fail "unable to create action no-launch notification from smoke UI"
    finish_scenario
    return
  fi

  kill_like_app
  open_notification_shade
  if ! tap_notification_action "NO_LAUNCH_ACTION" "Smoke Action No Launch"; then
    note_fail "unable to tap NO_LAUNCH_ACTION via UI Automator"
  fi

  sleep "$EVENT_WAIT_SECONDS"
  collect_logcat
  set_app_opened_observation

  assert_log_regex '\[BackgroundEvent\] type=ACTION_PRESS id=smoke-action-no-launch action=smoke-no-launch-action' \
    "missing killed-like background ACTION_PRESS for smoke-action-no-launch"
  if [[ "$OBS_APP_OPENED" == "yes" ]]; then
    note_fail "main app is foreground after killed-like no-launch action"
  fi

  print_scenario_report
}

run_action_with_launch_background() {
  start_scenario "action-with-launch-background"

  if ! create_notification_from_app "Android Event: Action with launch"; then
    note_fail "unable to create action with launch notification from smoke UI"
    finish_scenario
    return
  fi

  go_home
  open_notification_shade
  if ! tap_notification_action "LAUNCH_ACTION" "Smoke Action With Launch"; then
    note_fail "unable to tap LAUNCH_ACTION via UI Automator"
  fi

  sleep "$EVENT_WAIT_SECONDS"
  collect_logcat
  set_app_opened_observation

  assert_log_regex 'type=ACTION_PRESS id=smoke-action-with-launch action=smoke-launch-action' \
    "missing ACTION_PRESS for smoke-action-with-launch"
  if [[ "$OBS_APP_OPENED" != "yes" ]]; then
    note_fail "main app did not foreground after launch action"
  fi

  print_scenario_report
}

run_pressaction_null_background() {
  start_scenario "pressaction-null-background"

  if ! create_notification_from_app "Android Event: PressAction null immediate"; then
    note_fail "unable to create pressAction null notification from smoke UI"
    finish_scenario
    return
  fi

  go_home
  open_notification_shade
  if ! tap_text "Smoke PressAction Null" 5; then
    note_fail "unable to tap Smoke PressAction Null notification body via UI Automator"
  fi

  sleep "$EVENT_WAIT_SECONDS"
  collect_logcat
  set_app_opened_observation

  assert_no_log_regex '\[(ForegroundEvent|BackgroundEvent)\] type=PRESS id=smoke-pressaction-null' \
    "unexpected PRESS event for pressAction:null notification"
  assert_no_log_regex '\[InitialNotification\] id=smoke-pressaction-null' \
    "unexpected InitialNotification for pressAction:null notification"
  if [[ "$OBS_APP_OPENED" == "yes" ]]; then
    note_fail "main app foregrounded after pressAction:null body tap"
  fi

  print_scenario_report
}

run_default_body_background() {
  start_scenario "default-body-background"

  if ! create_notification_from_app "Android Event: Default body tap"; then
    note_fail "unable to create default body notification from smoke UI"
    finish_scenario
    return
  fi

  go_home
  open_notification_shade
  if ! tap_text "Smoke Default Body" 5; then
    note_fail "unable to tap Smoke Default Body notification body via UI Automator"
  fi

  sleep "$EVENT_WAIT_SECONDS"
  collect_logcat
  set_app_opened_observation

  assert_log_regex 'type=PRESS id=smoke-default-body' \
    "missing PRESS event for smoke-default-body"
  if [[ "$OBS_APP_OPENED" != "yes" ]]; then
    note_fail "main app did not foreground after default body tap"
  fi

  print_scenario_report
}

run_one() {
  case "$1" in
    action-no-launch-background)
      run_action_no_launch_background
      ;;
    action-no-launch-killed)
      run_action_no_launch_killed
      ;;
    action-with-launch-background)
      run_action_with_launch_background
      ;;
    pressaction-null-background)
      run_pressaction_null_background
      ;;
    default-body-background)
      run_default_body_background
      ;;
    *)
      fail "unsupported scenario: $1"
      ;;
  esac
}

print_final_summary() {
  local overall="PASS"
  local i result
  for ((i = 0; i < ${#SCENARIO_RESULTS[@]}; i++)); do
    result="${SCENARIO_RESULTS[$i]}"
    if [[ "$result" == "FAIL" ]]; then
      overall="FAIL"
      break
    fi
    if [[ "$result" == "PARTIAL" && "$overall" == "PASS" ]]; then
      overall="PARTIAL"
    fi
  done

  printf '\n## Android event dispatch smoke summary\n'
  printf 'device: %s %s (%s)\n' "$DEVICE_MANUFACTURER" "$DEVICE_MODEL" "$SERIAL"
  printf 'android: %s API %s\n' "$ANDROID_RELEASE" "$ANDROID_API"
  printf 'result: %s\n' "$overall"
  printf 'combined log: %s\n' "$LOG_FILE"
  printf 'scenarios:\n'
  for ((i = 0; i < ${#SCENARIO_RESULTS[@]}; i++)); do
    printf '  - %s: %s\n' "${SCENARIO_NAMES[$i]}" "${SCENARIO_RESULTS[$i]}"
  done

  if [[ "$overall" == "FAIL" ]]; then
    return 1
  fi
}

prepare() {
  ensure_tools
  resolve_device
  mkdir -p "$TMP_ROOT"
  : >"$LOG_FILE"
  load_device_info
  maybe_build
  ensure_package_installed
  grant_post_notifications
}

main() {
  parse_args "$@"

  if [[ "$SCENARIO" == "list" ]]; then
    print_list
    exit 0
  fi

  if [[ "$SCENARIO" != "all" ]] && ! scenario_supported "$SCENARIO"; then
    print_list >&2
    fail "unsupported scenario: $SCENARIO"
  fi

  prepare

  if [[ "$SCENARIO" == "all" ]]; then
    local scenario
    for scenario in "${SUPPORTED_SCENARIOS[@]}"; do
      run_one "$scenario"
    done
  else
    run_one "$SCENARIO"
  fi

  print_final_summary
}

main "$@"
