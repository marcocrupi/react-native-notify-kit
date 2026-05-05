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
UI_DUMP_TIMEOUT_SECONDS="${UI_DUMP_TIMEOUT_SECONDS:-8}"
UI_PULL_TIMEOUT_SECONDS="${UI_PULL_TIMEOUT_SECONDS:-5}"
ALERT_UI_DUMP_TIMEOUT_SECONDS="${ALERT_UI_DUMP_TIMEOUT_SECONDS:-3}"

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
CURRENT_DIAG_FILE=""
CURRENT_NOTIFICATION_DUMP=""
CURRENT_NOTIFICATION_ID=""
SCENARIO_STATUS="PASS"
SCENARIO_NOTES=()
OBS_FOREGROUND=""
OBS_BACKGROUND=""
OBS_INITIAL=""
OBS_IGNORED_INITIAL=""
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
  SKIP_BUILD=1 trusts the currently installed smoke app. After Android native changes,
  uninstall/reinstall the smoke app before trusting runtime failures; stale installs can
  produce false FAILs.
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
  if skip_build_enabled; then
    printf '[smoke-event] warning: SKIP_BUILD=%s; using currently installed smoke app. Reinstall after native changes before trusting failures.\n' "$SKIP_BUILD" >&2
    return
  fi

  printf '[smoke-event] building smoke app via yarn smoke:android\n'
  (cd "$REPO_ROOT" && ANDROID_SERIAL="$SERIAL" yarn smoke:android)
}

skip_build_enabled() {
  case "$SKIP_BUILD" in
    1 | true | TRUE | yes | YES)
      return 0
      ;;
  esac
  return 1
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

write_logcat_marker() {
  adb_device shell log -t RNNotifyKitSmoke "scenario-start:$CURRENT_SCENARIO notification:$CURRENT_NOTIFICATION_ID" >/dev/null 2>&1 || true
}

append_diag() {
  mkdir -p "$TMP_ROOT"
  printf '%s\n' "$*" >>"$CURRENT_DIAG_FILE"
}

collect_logcat() {
  adb_device logcat -d -v time >"$CURRENT_LOG_FILE" 2>/dev/null || true
  if [[ -s "$CURRENT_DIAG_FILE" ]]; then
    cat "$CURRENT_DIAG_FILE" >>"$CURRENT_LOG_FILE"
  fi
  {
    printf '\n===== %s =====\n' "$CURRENT_SCENARIO"
    cat "$CURRENT_LOG_FILE"
  } >>"$LOG_FILE"
}

run_with_timeout() {
  local timeout_seconds="$1"
  shift

  local pid watchdog status timed_out_file
  timed_out_file="$TMP_ROOT/timeout.$$.$RANDOM"

  "$@" &
  pid=$!

  (
    sleep "$timeout_seconds"
    if kill -0 "$pid" >/dev/null 2>&1; then
      : >"$timed_out_file"
      kill "$pid" >/dev/null 2>&1 || true
    fi
  ) &
  watchdog=$!

  wait "$pid"
  status=$?
  kill "$watchdog" >/dev/null 2>&1 || true
  wait "$watchdog" 2>/dev/null || true

  if [[ -e "$timed_out_file" ]]; then
    rm -f "$timed_out_file"
    return 124
  fi

  return "$status"
}

dump_ui() {
  mkdir -p "$TMP_ROOT"
  rm -f "$UI_DUMP"
  local remote="/sdcard/react-native-notify-kit-smoke-window.xml"
  run_with_timeout "$UI_DUMP_TIMEOUT_SECONDS" adb_device shell uiautomator dump --compressed "$remote" >/dev/null 2>&1 || return 1
  run_with_timeout "$UI_PULL_TIMEOUT_SECONDS" adb_device pull "$remote" "$UI_DUMP" >/dev/null 2>&1 || return 1
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

find_notification_content_bounds() {
  local title="$1"
  local body="${2:-}"

  TITLE="$title" BODY="$body" perl -0777 -ne '
sub decode {
  my ($value) = @_;
  $value =~ s/&quot;/"/g;
  $value =~ s/&lt;/</g;
  $value =~ s/&gt;/>/g;
  $value =~ s/&amp;/&/g;
  return $value;
}

my @targets = grep { defined && length } ($ENV{TITLE}, $ENV{BODY});
my ($min_x, $min_y, $max_x, $max_y);
while (/<node\b[^>]*>/g) {
  my $node = $&;
  my ($text) = $node =~ /\btext="([^"]*)"/;
  my ($desc) = $node =~ /\bcontent-desc="([^"]*)"/;
  VALUE:
  for my $value ($text, $desc) {
    next unless defined $value;
    $value = decode($value);
    for my $target (@targets) {
      next unless $value eq $target || index($value, $target) >= 0;
      next unless $node =~ /\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/;
      my ($x1, $y1, $x2, $y2) = ($1, $2, $3, $4);
      $min_x = $x1 if !defined($min_x) || $x1 < $min_x;
      $min_y = $y1 if !defined($min_y) || $y1 < $min_y;
      $max_x = $x2 if !defined($max_x) || $x2 > $max_x;
      $max_y = $y2 if !defined($max_y) || $y2 > $max_y;
      last VALUE;
    }
  }
}
exit 1 unless defined $min_x;
print "$min_x $min_y $max_x $max_y\n";
' "$UI_DUMP"
}

tap_text_once() {
  local text="$1"
  dump_ui || return 1

  local bounds
  bounds="$(find_text_bounds "$text")" || return 1
  tap_bounds_center "$bounds"
}

tap_bounds_center() {
  local bounds="$1"
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
  local scroll_attempts="${2:-12}"
  local i bounds

  if ! dump_ui; then
    append_diag "[SmokeDiagnostics] uiautomator dump failed before searching button: $text"
    return 1
  fi

  if bounds="$(find_text_bounds "$text")"; then
    tap_bounds_center "$bounds"
    return 0
  fi

  scroll_app_to_top
  sleep 0.4

  for ((i = 0; i <= scroll_attempts; i++)); do
    if ! dump_ui; then
      append_diag "[SmokeDiagnostics] uiautomator dump failed while searching button: $text"
      return 1
    fi

    if bounds="$(find_text_bounds "$text")"; then
      tap_bounds_center "$bounds"
      return 0
    fi

    [[ "$i" -lt "$scroll_attempts" ]] || break
    scroll_down
    sleep 0.4
  done

  append_button_ui_diagnostics "$text"
  return 1
}

dismiss_possible_warning_overlay() {
  if dump_ui && grep -Fq "Open debugger to view warnings." "$UI_DUMP"; then
    adb_device shell input tap "$((SCREEN_WIDTH - 96))" "$((SCREEN_HEIGHT * 9 / 10))" >/dev/null 2>&1 || true
    append_diag "[SmokeDiagnostics] dismissed React Native warning overlay"
    sleep 0.5
  fi
}

dismiss_possible_alert() {
  local UI_DUMP_TIMEOUT_SECONDS="$ALERT_UI_DUMP_TIMEOUT_SECONDS"
  tap_text_once "OK" >/dev/null 2>&1 || true
  dismiss_possible_warning_overlay
}

launch_app() {
  wake_device
  adb_device shell monkey -p "$APP_PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null
  sleep "$APP_START_WAIT_SECONDS"
  dismiss_possible_alert
}

ensure_app_ready_for_creation() {
  local button_text="$1"
  local attempts="${2:-6}"
  local i

  adb_device shell cmd statusbar collapse >/dev/null 2>&1 || true
  sleep 0.3
  launch_app || return 1

  for ((i = 1; i <= attempts; i++)); do
    if dump_ui && grep -Fq "package=\"$APP_PACKAGE\"" "$UI_DUMP"; then
      return 0
    fi
    if is_app_foreground; then
      return 0
    fi
    sleep 0.5
  done

  append_diag "[SmokeDiagnostics] app foreground reset failed before tapping: $button_text"
  append_focus_diagnostics
  append_button_ui_diagnostics "$button_text"
  return 1
}

go_home() {
  adb_device shell input keyevent KEYCODE_HOME >/dev/null 2>&1 || true
  sleep 1
}

open_notification_shade() {
  wake_device
  adb_device shell cmd statusbar collapse >/dev/null 2>&1 || true
  sleep 0.3
  adb_device shell input swipe "$((SCREEN_WIDTH / 2))" 0 "$((SCREEN_WIDTH / 2))" "$((SCREEN_HEIGHT * 4 / 10))" 350 >/dev/null 2>&1 || true
  sleep 0.8
  if notification_shade_visible; then
    return 0
  fi

  adb_device shell input swipe "$((SCREEN_WIDTH / 2))" 0 "$((SCREEN_WIDTH / 2))" "$((SCREEN_HEIGHT * 6 / 10))" 400 >/dev/null 2>&1 || true
  sleep 0.8
  if notification_shade_visible; then
    return 0
  fi

  adb_device shell cmd statusbar expand-notifications >/dev/null 2>&1 || true
  sleep 0.8
  notification_shade_visible
}

notification_shade_visible() {
  dump_ui || return 1
  grep -Fq 'package="com.android.systemui"' "$UI_DUMP"
}

append_ui_diagnostics() {
  local title="$1"
  local body="${2:-}"
  local body_filter=()

  if [[ -n "$body" ]]; then
    body_filter=(-e "$body")
  fi

  if ! dump_ui; then
    append_diag "[SmokeDiagnostics] uiautomator dump failed"
    return
  fi

  local matches
  matches="$(grep -o 'text="[^"]*"\|content-desc="[^"]*"' "$UI_DUMP" \
    | grep -F -e "$title" "${body_filter[@]}" -e "Smoke" -e "Default" -e "Body" \
    | head -n 20 || true)"

  {
    printf '[SmokeDiagnostics] UI packages: '
    grep -o 'package="[^"]*"' "$UI_DUMP" | sort -u | tr '\n' ' ' || true
    printf '\n'
    printf '[SmokeDiagnostics] UI matches for notification text:\n'
    if [[ -n "$matches" ]]; then
      printf '%s\n' "$matches" | sed 's/^/[SmokeDiagnostics]   /'
    else
      printf '[SmokeDiagnostics]   none\n'
    fi
  } >>"$CURRENT_DIAG_FILE"
}

append_button_ui_diagnostics() {
  local button_text="$1"

  if ! dump_ui; then
    append_diag "[SmokeDiagnostics] uiautomator dump failed while searching button: $button_text"
    return
  fi

  local matches
  matches="$(grep -o 'text="[^"]*"\|content-desc="[^"]*"' "$UI_DUMP" \
    | grep -F -e "$button_text" -e "Android Event" -e "Smoke" \
    | head -n 30 || true)"

  {
    printf '[SmokeDiagnostics] UI dump matches for button text: %s\n' "$button_text"
    printf '[SmokeDiagnostics] UI packages: '
    grep -o 'package="[^"]*"' "$UI_DUMP" | sort -u | tr '\n' ' ' || true
    printf '\n'
    if [[ -n "$matches" ]]; then
      printf '%s\n' "$matches" | sed 's/^/[SmokeDiagnostics]   /'
    else
      printf '[SmokeDiagnostics]   none\n'
    fi
  } >>"$CURRENT_DIAG_FILE"
}

collect_notification_dump() {
  mkdir -p "$TMP_ROOT"
  adb_device shell dumpsys notification --noredact 2>/dev/null | tr -d '\r' >"$CURRENT_NOTIFICATION_DUMP" || true
}

append_notification_diagnostics() {
  local notification_id="$1"
  local title="$2"

  collect_notification_dump
  local matches
  matches="$(grep -F -e "$notification_id" -e "$title" -e "smoke-" "$CURRENT_NOTIFICATION_DUMP" | head -n 20 || true)"

  {
    printf '[SmokeDiagnostics] notification dump matches for %s / %s:\n' "$notification_id" "$title"
    if [[ -n "$matches" ]]; then
      printf '%s\n' "$matches" | sed 's/^/[SmokeDiagnostics]   /'
    else
      printf '[SmokeDiagnostics]   none\n'
    fi
  } >>"$CURRENT_DIAG_FILE"
}

notification_present() {
  local notification_id="$1"
  local title="$2"

  collect_notification_dump
  if [[ -n "$notification_id" ]] && grep -Fq "$notification_id" "$CURRENT_NOTIFICATION_DUMP"; then
    return 0
  fi
  if [[ -n "$title" ]] && grep -Fq "$title" "$CURRENT_NOTIFICATION_DUMP"; then
    return 0
  fi
  return 1
}

wait_for_notification_present() {
  local notification_id="$1"
  local title="$2"
  local attempts="${3:-8}"
  local i

  for ((i = 1; i <= attempts; i++)); do
    if notification_present "$notification_id" "$title"; then
      return 0
    fi
    sleep 0.5
  done

  append_notification_diagnostics "$notification_id" "$title"
  return 1
}

wait_for_notification_text_in_shade() {
  local title="$1"
  local body="${2:-}"
  local attempts="${3:-8}"
  local i bounds

  for ((i = 1; i <= attempts; i++)); do
    if ! notification_shade_visible; then
      open_notification_shade >/dev/null 2>&1 || true
    fi

    if dump_ui && bounds="$(find_notification_content_bounds "$title" "$body")"; then
      printf '%s\n' "$bounds"
      return 0
    fi

    sleep 0.5
  done

  append_ui_diagnostics "$title" "$body"
  return 1
}

tap_notification_body() {
  local title="$1"
  local body="${2:-}"
  local bounds

  bounds="$(wait_for_notification_text_in_shade "$title" "$body")" || return 1
  tap_bounds_center "$bounds"
}

snapshot_logcat() {
  adb_device logcat -d -v time >"$CURRENT_LOG_FILE" 2>/dev/null || true
}

creation_log_ok_seen() {
  local log_marker="$1"

  [[ -n "$log_marker" ]] || return 1
  snapshot_logcat
  grep -Fq "[Notifee] $log_marker: OK" "$CURRENT_LOG_FILE" || grep -Fq "$log_marker: OK" "$CURRENT_LOG_FILE"
}

notification_text_visible_in_shade() {
  local title="$1"
  local body="${2:-}"

  [[ -n "$title" ]] || return 1
  open_notification_shade >/dev/null 2>&1 || return 1
  dump_ui || return 1
  find_notification_content_bounds "$title" "$body" >/dev/null 2>&1
}

wait_for_creation_signal() {
  local log_marker="$1"
  local notification_id="$2"
  local title="$3"
  local body="${4:-}"
  local notification_was_present="${5:-0}"
  local attempts="${6:-10}"
  local i

  for ((i = 1; i <= attempts; i++)); do
    if creation_log_ok_seen "$log_marker"; then
      append_diag "[SmokeDiagnostics] create notification signal: log marker OK ($log_marker)"
      return 0
    fi

    if [[ "$notification_was_present" != "1" ]] && notification_present "$notification_id" "$title"; then
      append_diag "[SmokeDiagnostics] create notification signal: dumpsys notification ($notification_id / $title)"
      return 0
    fi

    sleep 0.5
  done

  return 1
}

append_creation_log_diagnostics() {
  local log_marker="$1"
  local notification_id="$2"
  local title="$3"
  local filters=(-e "RNNotifyKitSmoke" -e "[Notifee]")

  [[ -n "$log_marker" ]] && filters+=(-e "$log_marker")
  [[ -n "$notification_id" ]] && filters+=(-e "$notification_id")
  [[ -n "$title" ]] && filters+=(-e "$title")

  snapshot_logcat
  local matches
  matches="$(grep -F "${filters[@]}" "$CURRENT_LOG_FILE" | tail -n 30 || true)"

  {
    printf '[SmokeDiagnostics] logcat matches for creation:\n'
    if [[ -n "$matches" ]]; then
      printf '%s\n' "$matches" | sed 's/^/[SmokeDiagnostics]   /'
    else
      printf '[SmokeDiagnostics]   none\n'
    fi
  } >>"$CURRENT_DIAG_FILE"
}

append_creation_failure_diagnostics() {
  local button_text="$1"
  local log_marker="$2"
  local notification_id="$3"
  local title="$4"
  local attempts="$5"

  {
    printf '[SmokeDiagnostics] create notification failed after bounded retries\n'
    printf '[SmokeDiagnostics]   button text: %s\n' "$button_text"
    printf '[SmokeDiagnostics]   notification id: %s\n' "${notification_id:-none}"
    printf '[SmokeDiagnostics]   notification title: %s\n' "${title:-none}"
    printf '[SmokeDiagnostics]   log marker: %s\n' "${log_marker:-none}"
    printf '[SmokeDiagnostics]   attempts executed: %s\n' "$attempts"
  } >>"$CURRENT_DIAG_FILE"

  append_creation_log_diagnostics "$log_marker" "$notification_id" "$title"
  append_notification_diagnostics "$notification_id" "$title"
  append_button_ui_diagnostics "$button_text"
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

append_focus_diagnostics() {
  {
    printf '[SmokeDiagnostics] focus dump:\n'
    focus_dump | sed 's/^/[SmokeDiagnostics]   /'
  } >>"$CURRENT_DIAG_FILE"
}

is_app_foreground() {
  focus_dump | grep -Fq "$APP_PACKAGE"
}

refresh_observations() {
  if [[ -n "$CURRENT_NOTIFICATION_ID" ]]; then
    OBS_FOREGROUND="$(grep -F '[ForegroundEvent]' "$CURRENT_LOG_FILE" | grep -F "id=$CURRENT_NOTIFICATION_ID" | tail -n 1 || true)"
    OBS_BACKGROUND="$(grep -F '[BackgroundEvent]' "$CURRENT_LOG_FILE" | grep -F "id=$CURRENT_NOTIFICATION_ID" | tail -n 1 || true)"
    OBS_INITIAL="$(grep -F '[InitialNotification]' "$CURRENT_LOG_FILE" | grep -F "id=$CURRENT_NOTIFICATION_ID" | tail -n 1 || true)"
    OBS_IGNORED_INITIAL="$(grep -F '[InitialNotification]' "$CURRENT_LOG_FILE" | grep -Fv "id=$CURRENT_NOTIFICATION_ID" | tail -n 1 || true)"
    return
  fi

  OBS_FOREGROUND="$(grep -E '\[ForegroundEvent\]' "$CURRENT_LOG_FILE" | tail -n 1 || true)"
  OBS_BACKGROUND="$(grep -E '\[BackgroundEvent\]' "$CURRENT_LOG_FILE" | tail -n 1 || true)"
  OBS_INITIAL="$(grep -E '\[InitialNotification\]' "$CURRENT_LOG_FILE" | tail -n 1 || true)"
  OBS_IGNORED_INITIAL=""
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
  CURRENT_NOTIFICATION_ID="${2:-}"
  CURRENT_LOG_FILE="$TMP_ROOT/${CURRENT_SCENARIO}.log"
  CURRENT_DIAG_FILE="$TMP_ROOT/${CURRENT_SCENARIO}.diag.log"
  CURRENT_NOTIFICATION_DUMP="$TMP_ROOT/${CURRENT_SCENARIO}.notification.txt"
  SCENARIO_STATUS="PASS"
  SCENARIO_NOTES=()
  OBS_FOREGROUND=""
  OBS_BACKGROUND=""
  OBS_INITIAL=""
  OBS_IGNORED_INITIAL=""
  OBS_APP_OPENED="unknown"
  : >"$CURRENT_LOG_FILE"
  : >"$CURRENT_DIAG_FILE"
  clear_logcat
  write_logcat_marker
}

create_notification_from_app() {
  local label="$1"
  local log_marker=""
  local notification_id="$CURRENT_NOTIFICATION_ID"
  local notification_title=""
  local notification_body=""
  local max_attempts=3
  local signal_attempts=10
  local attempt notification_was_present

  case "$label" in
    "Android Event: Action no launch")
      log_marker="AndroidEventActionNoLaunch"
      notification_id="smoke-action-no-launch"
      notification_title="Smoke Action No Launch"
      notification_body="Tap NO_LAUNCH_ACTION"
      ;;
    "Android Event: Action with launch")
      log_marker="AndroidEventActionWithLaunch"
      notification_id="smoke-action-with-launch"
      notification_title="Smoke Action With Launch"
      notification_body="Tap LAUNCH_ACTION"
      ;;
    "Android Event: PressAction null immediate")
      log_marker="AndroidEventPressActionNull"
      notification_id="smoke-pressaction-null"
      notification_title="Smoke PressAction Null"
      notification_body="Body tap should not open the app"
      ;;
    "Android Event: Default body tap")
      log_marker="AndroidEventDefaultBody"
      notification_id="smoke-default-body"
      notification_title="Smoke Default Body"
      notification_body="Body tap should open the app"
      ;;
  esac

  for ((attempt = 1; attempt <= max_attempts; attempt++)); do
    append_diag "[SmokeDiagnostics] create notification attempt $attempt/$max_attempts: button=$label id=${notification_id:-none} title=${notification_title:-none} marker=${log_marker:-none}"

    notification_was_present=0
    if notification_present "$notification_id" "$notification_title"; then
      notification_was_present=1
      append_diag "[SmokeDiagnostics] target notification already present before attempt $attempt; requiring log marker for this attempt"
    fi

    if ! ensure_app_ready_for_creation "$label"; then
      append_diag "[SmokeDiagnostics] create notification attempt $attempt/$max_attempts failed before tap: app not ready"
    elif ! tap_app_text "$label" 12; then
      append_diag "[SmokeDiagnostics] create notification attempt $attempt/$max_attempts failed: button tap not performed"
    elif wait_for_creation_signal "$log_marker" "$notification_id" "$notification_title" "$notification_body" "$notification_was_present" "$signal_attempts"; then
      sleep 1
      return 0
    else
      append_diag "[SmokeDiagnostics] create notification attempt $attempt/$max_attempts did not produce expected creation signal"
    fi

    if [[ "$attempt" -lt "$max_attempts" ]]; then
      printf '[smoke-event] %s: create notification attempt %s/%s failed; retrying button tap\n' "$CURRENT_SCENARIO" "$attempt" "$max_attempts" >&2
      sleep 0.8
    fi
  done

  append_creation_failure_diagnostics "$label" "$log_marker" "$notification_id" "$notification_title" "$max_attempts"
  return 1
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
  if [[ -n "$OBS_IGNORED_INITIAL" ]]; then
    printf 'ignored stale initial notification: %s\n' "$OBS_IGNORED_INITIAL"
  fi
  printf 'app opened: %s\n' "$OBS_APP_OPENED"
  printf 'skip build: %s\n' "$SKIP_BUILD"
  printf 'log file: %s\n' "$CURRENT_LOG_FILE"
  if [[ "${#SCENARIO_NOTES[@]}" -gt 0 ]]; then
    printf 'notes:\n'
    local note
    for note in "${SCENARIO_NOTES[@]}"; do
      printf '  - %s\n' "$note"
    done
  fi
  printf 'relevant logs:\n'
  grep -E 'RNNotifyKitSmoke|\[(ForegroundEvent|BackgroundEvent|InitialNotification)\]|SmokeDiagnostics|ACTION_PRESS|PRESS|smoke-' "$CURRENT_LOG_FILE" | tail -n 30 | sed 's/^/  /' || printf '  none\n'
}

finish_scenario() {
  collect_logcat
  set_app_opened_observation
  print_scenario_report
}

run_action_no_launch_background() {
  start_scenario "action-no-launch-background" "smoke-action-no-launch"

  if ! create_notification_from_app "Android Event: Action no launch"; then
    note_fail "harness/setup failure: unable to create action no-launch notification from smoke UI"
    finish_scenario
    return
  fi

  go_home
  if ! open_notification_shade; then
    note_fail "harness/setup failure: unable to open notification shade"
  elif ! tap_notification_action "NO_LAUNCH_ACTION" "Smoke Action No Launch"; then
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
  start_scenario "action-no-launch-killed" "smoke-action-no-launch"

  if ! create_notification_from_app "Android Event: Action no launch"; then
    note_fail "harness/setup failure: unable to create action no-launch notification from smoke UI"
    finish_scenario
    return
  fi

  kill_like_app
  if ! open_notification_shade; then
    note_fail "harness/setup failure: unable to open notification shade"
  elif ! tap_notification_action "NO_LAUNCH_ACTION" "Smoke Action No Launch"; then
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
  start_scenario "action-with-launch-background" "smoke-action-with-launch"

  if ! create_notification_from_app "Android Event: Action with launch"; then
    note_fail "harness/setup failure: unable to create action with launch notification from smoke UI"
    finish_scenario
    return
  fi

  go_home
  if ! open_notification_shade; then
    note_fail "harness/setup failure: unable to open notification shade"
  elif ! tap_notification_action "LAUNCH_ACTION" "Smoke Action With Launch"; then
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
  start_scenario "pressaction-null-background" "smoke-pressaction-null"

  if ! create_notification_from_app "Android Event: PressAction null immediate"; then
    note_fail "harness/setup failure: unable to create pressAction null notification from smoke UI"
    finish_scenario
    return
  fi

  go_home
  if ! open_notification_shade; then
    note_fail "harness/setup failure: unable to open notification shade"
  elif ! tap_text "Smoke PressAction Null" 5; then
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
  start_scenario "default-body-background" "smoke-default-body"

  if ! create_notification_from_app "Android Event: Default body tap"; then
    note_fail "harness/setup failure: unable to create default body notification from smoke UI"
    finish_scenario
    return
  fi

  if ! wait_for_notification_present "smoke-default-body" "Smoke Default Body"; then
    note_fail "harness/setup failure: smoke-default-body notification not present before tap"
    finish_scenario
    return
  fi

  go_home
  if ! open_notification_shade; then
    note_fail "harness/setup failure: unable to open notification shade"
  elif ! tap_notification_body "Smoke Default Body" "Body tap should open the app"; then
    note_fail "harness/UI Automator failure: unable to find or tap Smoke Default Body notification row"
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
  printf 'skip build: %s\n' "$SKIP_BUILD"
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
