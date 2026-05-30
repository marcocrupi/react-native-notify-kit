#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"

ADB="${ADB:-adb}"
PACKAGE_NAME=""
PACKAGE_NAME_REGEX=""
PACKAGE_NAME_REGEX_SOURCE=""
DEVICE_SERIAL="${ANDROID_SERIAL:-}"
TRIGGER_COUNT="1"
FIRE_DELAY_SECONDS="300"
SPACING_SECONDS="5"
ALARM_TYPE="setExactAndAllowWhileIdle"
OUTPUT_DIR="/tmp/notifykit-reboot-smoke-$(date +%Y%m%d-%H%M%S)"
SKIP_BUILD="1"
DO_REBOOT="0"
NO_REBOOT_EXPLICIT="0"
REBOOT_ACK="0"
TEST_COLD_START_RECOVERY="0"
CANCEL_HARNESS_TRIGGERS="0"
CLEAR_LOGCAT="0"

BOOT_TIMEOUT_SECONDS="${BOOT_TIMEOUT_SECONDS:-180}"
POST_BOOT_SETTLE_SECONDS="${POST_BOOT_SETTLE_SECONDS:-15}"
POST_REBOOT_OBSERVATION_SECONDS="${POST_REBOOT_OBSERVATION_SECONDS:-120}"
POST_REBOOT_POLL_INTERVAL_SECONDS="${POST_REBOOT_POLL_INTERVAL_SECONDS:-5}"
DEEPLINK_SETTLE_SECONDS="${DEEPLINK_SETTLE_SECONDS:-3}"
MAX_FIRE_WAIT_SECONDS="${MAX_FIRE_WAIT_SECONDS:-360}"

OUTPUT_DIR_READY="0"
SUMMARY_FILE=""
DEVICE_FILE=""
MARKERS_FILE=""
PRE_LOGCAT_FILE=""
POST_LOGCAT_FILE=""
PRE_ALARM_FILE=""
POST_ALARM_FILE=""
PRE_ALARM_FILTERED_FILE=""
POST_ALARM_FILTERED_FILE=""
POST_COLD_ALARM_FILE=""
POST_COLD_ALARM_FILTERED_FILE=""
COLD_LOGCAT_FILE=""
BOOT_WAIT_FILE=""
POST_REBOOT_OBSERVATION_DIR=""
POST_REBOOT_OBSERVATION_FILE=""

DEVICE_MANUFACTURER=""
DEVICE_MODEL=""
ANDROID_RELEASE=""
ANDROID_API=""

INFRA_FAILURE="0"
REBOOT_EXECUTED="0"
BOOT_COMPLETED="0"
SCHEDULE_OK="0"
DUMP_OK="0"
PRE_ALARM_PRESENT="0"
POST_ALARM_PRESENT="0"
POST_REBOOT_ALARM_PRESENT_INITIAL="0"
POST_REBOOT_ALARM_PRESENT_LATE="0"
POST_REBOOT_ALARM_FIRST_SEEN_AFTER_SECONDS="not_observed"
POST_REBOOT_DUMPSYS_ATTEMPTS="0"
POST_REBOOT_DUMPSYS_SUCCESS_COUNT="0"
POST_REBOOT_DUMPSYS_FAILURE_COUNT="0"
POST_REBOOT_DUMPSYS_ANY_SUCCESS="0"
POST_REBOOT_OBSERVATION_COMPLETED="0"
GENERIC_NOTIFYKIT_LOG_OBSERVED="0"
TARGET_PACKAGE_LOG_OBSERVED="0"
TARGET_REBOOT_RECEIVER_LOG_OBSERVED="0"
TARGET_RECOVERY_LOG_OBSERVED="0"
NON_TARGET_NOTIFYKIT_LOG_OBSERVED="0"
NON_TARGET_NOTIFYKIT_PACKAGE_OBSERVED="none"
RECEIVER_LOG_OBSERVED="0"
REBOOT_RECEIVER_LOG_OBSERVED="0"
SPECIFIC_REBOOT_RECEIVER_LOG_OBSERVED="0"
SPECIFIC_RECOVERY_LOG_OBSERVED="0"
GENERIC_BOOT_LOG_OBSERVED="0"
BOOT_COMPLETED_LOG_OBSERVED="0"
BOOT_COUNT_LOG_OBSERVED="0"
RECEIVER_LOG_EVIDENCE_SOURCE="none"
LATE_REARM_OBSERVED="0"
COLD_START_RECOVERY_OBSERVED="0"
COLD_DUMP_MARKER_OBSERVED="0"
COLD_DUMP_HAS_TRIGGERS="0"
COLD_RESCHEDULE_LOG_OBSERVED="0"
POST_COLD_ALARM_PRESENT="0"
VISUAL_DELIVERY_OBSERVED="0"
EXACT_ALARM_FALLBACK_OBSERVED="0"
SCHEDULE_HOST_EPOCH="0"

VERDICT="NON CONCLUSIVO"
EXIT_CODE="3"
CLASSIFICATION_REASON="not classified yet"

WARNINGS=()
ERRORS=()
EVIDENCE=()
ADB_COMMAND=()

usage() {
  cat <<EOF
Android reboot trigger smoke triage

Usage:
  bash scripts/smoke-test-android-reboot-triggers.sh --package <packageName> [options]

Required:
  --package <packageName>

Options:
  --device <adbSerial>                       adb serial; optional when exactly one device is connected
  --trigger-count <1|5|50>                   default: $TRIGGER_COUNT
  --fire-delay-seconds <seconds>             default: $FIRE_DELAY_SECONDS
  --spacing-seconds <seconds>                default: $SPACING_SECONDS
  --alarm-type <setExactAndAllowWhileIdle|setAlarmClock>
                                             default: $ALARM_TYPE
  --output-dir <path>                        default: /tmp/notifykit-reboot-smoke-<timestamp>
  --skip-build                               accepted; build/install is skipped in this script
  --no-reboot                                safe mode; schedule, dump, dumpsys, logcat only
  --i-know-this-reboots-device               enables adb reboot
  --post-reboot-observation-seconds <seconds>
                                             post-boot polling window after the immediate snapshot;
                                             default: $POST_REBOOT_OBSERVATION_SECONDS, use 0 to disable extra polling
  --test-cold-start-recovery                 after reboot, open notifykit://reboot-smoke/dump
  --cancel-harness-triggers                  cancel only via notifykit://reboot-smoke/cancel
  --clear-logcat                             opt-in destructive adb logcat -c before scheduling
  --help

Safety:
  The default behaves like --no-reboot. This script never force-stops the app, clears app data,
  clears logcat, or cancels triggers unless the matching opt-in flag is passed.

Harness:
  schedule: notifykit://reboot-smoke/schedule
  dump:     notifykit://reboot-smoke/dump
  cancel:   notifykit://reboot-smoke/cancel
EOF
}

log() {
  printf '[reboot-smoke] %s\n' "$*"
}

add_warning() {
  WARNINGS+=("$*")
  printf '[reboot-smoke] warning: %s\n' "$*" >&2
}

add_error() {
  ERRORS+=("$*")
  printf '[reboot-smoke] error: %s\n' "$*" >&2
}

add_evidence() {
  EVIDENCE+=("$*")
  printf '[reboot-smoke] evidence: %s\n' "$*"
}

print_command() {
  local arg
  printf '+'
  for arg in "$@"; do
    printf ' %q' "$arg"
  done
  printf '\n'
}

shell_quote() {
  local value="$1"
  printf "'"
  printf '%s' "$value" | sed "s/'/'\\\\''/g"
  printf "'"
}

is_positive_integer() {
  [[ "${1:-}" =~ ^[1-9][0-9]*$ ]]
}

is_non_negative_integer() {
  [[ "${1:-}" =~ ^[0-9]+$ ]]
}

is_valid_trigger_count() {
  case "$1" in
    1 | 5 | 50)
      return 0
      ;;
  esac
  return 1
}

is_valid_alarm_type() {
  case "$1" in
    setExactAndAllowWhileIdle | setAlarmClock)
      return 0
      ;;
  esac
  return 1
}

ensure_output_dir() {
  if [[ "$OUTPUT_DIR_READY" == "1" ]]; then
    return
  fi

  mkdir -p "$OUTPUT_DIR"
  OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd -P)"
  SUMMARY_FILE="$OUTPUT_DIR/summary.txt"
  DEVICE_FILE="$OUTPUT_DIR/device.txt"
  MARKERS_FILE="$OUTPUT_DIR/reboot-smoke-markers.txt"
  PRE_LOGCAT_FILE="$OUTPUT_DIR/logcat-pre-reboot.txt"
  POST_LOGCAT_FILE="$OUTPUT_DIR/logcat-post-reboot.txt"
  PRE_ALARM_FILE="$OUTPUT_DIR/pre-reboot-dumpsys-alarm.txt"
  POST_ALARM_FILE="$OUTPUT_DIR/post-reboot-dumpsys-alarm.txt"
  PRE_ALARM_FILTERED_FILE="$OUTPUT_DIR/pre-reboot-dumpsys-alarm-filtered.txt"
  POST_ALARM_FILTERED_FILE="$OUTPUT_DIR/post-reboot-dumpsys-alarm-filtered.txt"
  POST_COLD_ALARM_FILE="$OUTPUT_DIR/post-cold-start-dumpsys-alarm.txt"
  POST_COLD_ALARM_FILTERED_FILE="$OUTPUT_DIR/post-cold-start-dumpsys-alarm-filtered.txt"
  COLD_LOGCAT_FILE="$OUTPUT_DIR/logcat-cold-start.txt"
  BOOT_WAIT_FILE="$OUTPUT_DIR/boot-wait.txt"
  POST_REBOOT_OBSERVATION_DIR="$OUTPUT_DIR/post-reboot-observation"
  POST_REBOOT_OBSERVATION_FILE="$OUTPUT_DIR/post-reboot-observation.txt"
  mkdir -p "$POST_REBOOT_OBSERVATION_DIR"
  OUTPUT_DIR_READY="1"

  if [[ "$OUTPUT_DIR" == "$REPO_ROOT" || "$OUTPUT_DIR" == "$REPO_ROOT"/* ]]; then
    add_warning "--output-dir is inside the repository and may leave the workspace dirty: $OUTPUT_DIR"
  fi
}

write_lines() {
  local title="$1"
  shift

  printf '\n%s:\n' "$title"
  if [[ "$#" -eq 0 ]]; then
    printf '  - none\n'
    return
  fi

  local line
  for line in "$@"; do
    printf '  - %s\n' "$line"
  done
}

write_array_lines() {
  local title="$1"
  shift

  if [[ "$#" -eq 0 ]]; then
    write_lines "$title"
    return
  fi

  write_lines "$title" "$@"
}

write_summary() {
  ensure_output_dir

  {
    printf 'Android reboot trigger smoke summary\n'
    printf 'Generated: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    printf 'Verdict: %s\n' "$VERDICT"
    printf 'Exit code: %s\n' "$EXIT_CODE"
    printf 'Output directory: %s\n' "$OUTPUT_DIR"
    printf '\nConfiguration:\n'
    printf '  package: %s\n' "${PACKAGE_NAME:-"(missing)"}"
    printf '  serial: %s\n' "${DEVICE_SERIAL:-"(auto)"}"
    printf '  trigger_count: %s\n' "$TRIGGER_COUNT"
    printf '  fire_delay_seconds: %s\n' "$FIRE_DELAY_SECONDS"
    printf '  spacing_seconds: %s\n' "$SPACING_SECONDS"
    printf '  alarm_type: %s\n' "$ALARM_TYPE"
    printf '  reboot_requested: %s\n' "$DO_REBOOT"
    printf '  post_reboot_observation_seconds: %s\n' "$POST_REBOOT_OBSERVATION_SECONDS"
    printf '  post_reboot_poll_interval_seconds: %s\n' "$POST_REBOOT_POLL_INTERVAL_SECONDS"
    printf '  cold_start_recovery: %s\n' "$TEST_COLD_START_RECOVERY"
    printf '  cancel_harness_triggers: %s\n' "$CANCEL_HARNESS_TRIGGERS"
    printf '  clear_logcat: %s\n' "$CLEAR_LOGCAT"
    printf '  skip_build: %s\n' "$SKIP_BUILD"
    printf '\nDevice:\n'
    printf '  manufacturer: %s\n' "${DEVICE_MANUFACTURER:-"(unknown)"}"
    printf '  model: %s\n' "${DEVICE_MODEL:-"(unknown)"}"
    printf '  android_release: %s\n' "${ANDROID_RELEASE:-"(unknown)"}"
    printf '  android_api: %s\n' "${ANDROID_API:-"(unknown)"}"
    printf '\nObserved flags:\n'
    printf '  schedule_ok: %s\n' "$SCHEDULE_OK"
    printf '  dump_ok: %s\n' "$DUMP_OK"
    printf '  pre_reboot_alarm_present: %s\n' "$PRE_ALARM_PRESENT"
    printf '  reboot_executed: %s\n' "$REBOOT_EXECUTED"
    printf '  boot_completed: %s\n' "$BOOT_COMPLETED"
    printf '  post_reboot_observation_seconds: %s\n' "$POST_REBOOT_OBSERVATION_SECONDS"
    printf '  post_reboot_alarm_present_initial: %s\n' "$POST_REBOOT_ALARM_PRESENT_INITIAL"
    printf '  post_reboot_alarm_present_late: %s\n' "$POST_REBOOT_ALARM_PRESENT_LATE"
    printf '  post_reboot_alarm_first_seen_after_seconds: %s\n' "$POST_REBOOT_ALARM_FIRST_SEEN_AFTER_SECONDS"
    printf '  post_reboot_dumpsys_attempts: %s\n' "$POST_REBOOT_DUMPSYS_ATTEMPTS"
    printf '  post_reboot_dumpsys_success_count: %s\n' "$POST_REBOOT_DUMPSYS_SUCCESS_COUNT"
    printf '  post_reboot_dumpsys_failure_count: %s\n' "$POST_REBOOT_DUMPSYS_FAILURE_COUNT"
    printf '  post_reboot_dumpsys_any_success: %s\n' "$POST_REBOOT_DUMPSYS_ANY_SUCCESS"
    printf '  post_reboot_observation_completed: %s\n' "$POST_REBOOT_OBSERVATION_COMPLETED"
    printf '  generic_boot_log_observed: %s\n' "$GENERIC_BOOT_LOG_OBSERVED"
    printf '  generic_notifykit_log_observed: %s\n' "$GENERIC_NOTIFYKIT_LOG_OBSERVED"
    printf '  target_package_log_observed: %s\n' "$TARGET_PACKAGE_LOG_OBSERVED"
    printf '  target_reboot_receiver_log_observed: %s\n' "$TARGET_REBOOT_RECEIVER_LOG_OBSERVED"
    printf '  target_recovery_log_observed: %s\n' "$TARGET_RECOVERY_LOG_OBSERVED"
    printf '  non_target_notifykit_log_observed: %s\n' "$NON_TARGET_NOTIFYKIT_LOG_OBSERVED"
    printf '  non_target_notifykit_package_observed: %s\n' "$NON_TARGET_NOTIFYKIT_PACKAGE_OBSERVED"
    printf '  specific_reboot_receiver_log_observed: %s\n' "$SPECIFIC_REBOOT_RECEIVER_LOG_OBSERVED"
    printf '  specific_recovery_log_observed: %s\n' "$SPECIFIC_RECOVERY_LOG_OBSERVED"
    printf '  receiver_log_observed: %s\n' "$RECEIVER_LOG_OBSERVED"
    printf '  receiver_log_evidence_source: %s\n' "$RECEIVER_LOG_EVIDENCE_SOURCE"
    printf '  reboot_receiver_log_observed: %s\n' "$REBOOT_RECEIVER_LOG_OBSERVED"
    printf '  boot_completed_log_observed: %s\n' "$BOOT_COMPLETED_LOG_OBSERVED"
    printf '  boot_count_log_observed: %s\n' "$BOOT_COUNT_LOG_OBSERVED"
    printf '  receiver_or_recovery_log_observed: %s\n' "$RECEIVER_LOG_OBSERVED"
    printf '  post_reboot_alarm_present: %s\n' "$POST_ALARM_PRESENT"
    printf '  late_rearm_observed: %s\n' "$LATE_REARM_OBSERVED"
    printf '  cold_start_recovery_observed: %s\n' "$COLD_START_RECOVERY_OBSERVED"
    printf '  cold_dump_marker_observed: %s\n' "$COLD_DUMP_MARKER_OBSERVED"
    printf '  cold_dump_has_triggers: %s\n' "$COLD_DUMP_HAS_TRIGGERS"
    printf '  cold_reschedule_log_observed: %s\n' "$COLD_RESCHEDULE_LOG_OBSERVED"
    printf '  post_cold_start_alarm_present: %s\n' "$POST_COLD_ALARM_PRESENT"
    printf '  visual_delivery_observed: %s\n' "$VISUAL_DELIVERY_OBSERVED"
    printf '  exact_alarm_fallback_observed: %s\n' "$EXACT_ALARM_FALLBACK_OBSERVED"
    printf '  classification_reason: %s\n' "$CLASSIFICATION_REASON"
    if ((${#EVIDENCE[@]})); then
      write_array_lines "Evidence" "${EVIDENCE[@]}"
    else
      write_array_lines "Evidence"
    fi
    if ((${#WARNINGS[@]})); then
      write_array_lines "Warnings" "${WARNINGS[@]}"
    else
      write_array_lines "Warnings"
    fi
    if ((${#ERRORS[@]})); then
      write_array_lines "Errors" "${ERRORS[@]}"
    else
      write_array_lines "Errors"
    fi
    printf '\nImportant files:\n'
    printf '  - %s\n' "$SUMMARY_FILE"
    printf '  - %s\n' "$DEVICE_FILE"
    printf '  - %s\n' "$PRE_ALARM_FILE"
    printf '  - %s\n' "$POST_ALARM_FILE"
    printf '  - %s\n' "$PRE_LOGCAT_FILE"
    printf '  - %s\n' "$POST_LOGCAT_FILE"
    printf '  - %s\n' "$POST_REBOOT_OBSERVATION_FILE"
    printf '  - %s\n' "$POST_REBOOT_OBSERVATION_DIR"
    printf '  - %s\n' "$MARKERS_FILE"
    printf '\nNotes:\n'
    printf '  - NON CONCLUSIVO exits with 3 so schedule-only runs are not treated as full validation.\n'
    printf '  - Visual notification delivery is not automatically observable by this script.\n'
    printf '  - Exact fire timing is not validated when the app falls back to inexact alarms.\n'
  } >"$SUMMARY_FILE"
}

finish() {
  write_summary
  log "summary: $SUMMARY_FILE"
  log "verdict: $VERDICT"
  exit "$EXIT_CODE"
}

fail_blocked() {
  VERDICT="BLOCCATO"
  EXIT_CODE="2"
  CLASSIFICATION_REASON="blocked: $*"
  add_error "$*"
  finish
}

fail_infra() {
  VERDICT="FAIL INFRASTRUTTURALE"
  EXIT_CODE="3"
  INFRA_FAILURE="1"
  CLASSIFICATION_REASON="infrastructure failure: $*"
  add_error "$*"
  finish
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h | --help | help)
        usage
        exit 0
        ;;
      --package)
        [[ $# -ge 2 ]] || fail_blocked "--package requires a value"
        PACKAGE_NAME="$2"
        shift 2
        ;;
      --package=*)
        PACKAGE_NAME="${1#--package=}"
        shift
        ;;
      --device)
        [[ $# -ge 2 ]] || fail_blocked "--device requires a value"
        DEVICE_SERIAL="$2"
        shift 2
        ;;
      --device=*)
        DEVICE_SERIAL="${1#--device=}"
        shift
        ;;
      --trigger-count)
        [[ $# -ge 2 ]] || fail_blocked "--trigger-count requires a value"
        TRIGGER_COUNT="$2"
        shift 2
        ;;
      --trigger-count=*)
        TRIGGER_COUNT="${1#--trigger-count=}"
        shift
        ;;
      --fire-delay-seconds)
        [[ $# -ge 2 ]] || fail_blocked "--fire-delay-seconds requires a value"
        FIRE_DELAY_SECONDS="$2"
        shift 2
        ;;
      --fire-delay-seconds=*)
        FIRE_DELAY_SECONDS="${1#--fire-delay-seconds=}"
        shift
        ;;
      --spacing-seconds)
        [[ $# -ge 2 ]] || fail_blocked "--spacing-seconds requires a value"
        SPACING_SECONDS="$2"
        shift 2
        ;;
      --spacing-seconds=*)
        SPACING_SECONDS="${1#--spacing-seconds=}"
        shift
        ;;
      --alarm-type)
        [[ $# -ge 2 ]] || fail_blocked "--alarm-type requires a value"
        ALARM_TYPE="$2"
        shift 2
        ;;
      --alarm-type=*)
        ALARM_TYPE="${1#--alarm-type=}"
        shift
        ;;
      --output-dir)
        [[ $# -ge 2 ]] || fail_blocked "--output-dir requires a value"
        OUTPUT_DIR="$2"
        shift 2
        ;;
      --output-dir=*)
        OUTPUT_DIR="${1#--output-dir=}"
        shift
        ;;
      --skip-build)
        SKIP_BUILD="1"
        shift
        ;;
      --no-reboot)
        NO_REBOOT_EXPLICIT="1"
        DO_REBOOT="0"
        shift
        ;;
      --i-know-this-reboots-device)
        REBOOT_ACK="1"
        DO_REBOOT="1"
        shift
        ;;
      --post-reboot-observation-seconds)
        [[ $# -ge 2 ]] || fail_blocked "--post-reboot-observation-seconds requires a value"
        POST_REBOOT_OBSERVATION_SECONDS="$2"
        shift 2
        ;;
      --post-reboot-observation-seconds=*)
        POST_REBOOT_OBSERVATION_SECONDS="${1#--post-reboot-observation-seconds=}"
        shift
        ;;
      --test-cold-start-recovery)
        TEST_COLD_START_RECOVERY="1"
        shift
        ;;
      --cancel-harness-triggers)
        CANCEL_HARNESS_TRIGGERS="1"
        shift
        ;;
      --clear-logcat)
        CLEAR_LOGCAT="1"
        shift
        ;;
      *)
        fail_blocked "unknown argument: $1"
        ;;
    esac
  done
}

validate_args() {
  if [[ -z "$PACKAGE_NAME" ]]; then
    fail_blocked "--package is required to avoid targeting the wrong app"
  fi

  if [[ "$PACKAGE_NAME" =~ [[:space:]] ]]; then
    fail_blocked "--package must not contain whitespace: $PACKAGE_NAME"
  fi

  if ! is_valid_trigger_count "$TRIGGER_COUNT"; then
    fail_blocked "--trigger-count must be one of 1, 5, 50; got $TRIGGER_COUNT"
  fi

  if ! is_positive_integer "$FIRE_DELAY_SECONDS"; then
    fail_blocked "--fire-delay-seconds must be a positive integer; got $FIRE_DELAY_SECONDS"
  fi

  if ! is_positive_integer "$SPACING_SECONDS"; then
    fail_blocked "--spacing-seconds must be a positive integer; got $SPACING_SECONDS"
  fi

  if ! is_positive_integer "$BOOT_TIMEOUT_SECONDS"; then
    fail_blocked "BOOT_TIMEOUT_SECONDS must be a positive integer; got $BOOT_TIMEOUT_SECONDS"
  fi

  if ! is_non_negative_integer "$POST_REBOOT_OBSERVATION_SECONDS"; then
    fail_blocked "--post-reboot-observation-seconds must be a non-negative integer; got $POST_REBOOT_OBSERVATION_SECONDS"
  fi

  if [[ "$POST_REBOOT_OBSERVATION_SECONDS" != "0" ]] && ! is_positive_integer "$POST_REBOOT_POLL_INTERVAL_SECONDS"; then
    fail_blocked "POST_REBOOT_POLL_INTERVAL_SECONDS must be a positive integer; got $POST_REBOOT_POLL_INTERVAL_SECONDS"
  fi

  if ! is_valid_alarm_type "$ALARM_TYPE"; then
    fail_blocked "--alarm-type must be setExactAndAllowWhileIdle or setAlarmClock; got $ALARM_TYPE"
  fi

  if [[ "$NO_REBOOT_EXPLICIT" == "1" && "$REBOOT_ACK" == "1" ]]; then
    fail_blocked "--no-reboot and --i-know-this-reboots-device are mutually exclusive"
  fi

  if [[ "$TEST_COLD_START_RECOVERY" == "1" && "$DO_REBOOT" != "1" ]]; then
    fail_blocked "--test-cold-start-recovery requires --i-know-this-reboots-device"
  fi

  if [[ "$DO_REBOOT" == "1" && "$FIRE_DELAY_SECONDS" -lt 180 ]]; then
    add_warning "--fire-delay-seconds is below 180 for a reboot run; recovery evidence may be inconclusive"
  fi
}

build_adb_cmd() {
  ADB_COMMAND=("$ADB")
  if [[ -n "$DEVICE_SERIAL" ]]; then
    ADB_COMMAND+=(-s "$DEVICE_SERIAL")
  fi
  ADB_COMMAND+=("$@")
}

run_adb() {
  build_adb_cmd "$@"
  print_command "${ADB_COMMAND[@]}"
  "${ADB_COMMAND[@]}"
}

run_adb_capture() {
  local output_file="$1"
  shift

  build_adb_cmd "$@"
  print_command "${ADB_COMMAND[@]}"
  "${ADB_COMMAND[@]}" >"$output_file" 2>&1
}

run_adb_capture_best_effort() {
  local label="$1"
  local output_file="$2"
  shift 2

  if run_adb_capture "$output_file" "$@"; then
    return 0
  fi

  add_warning "$label failed or is unavailable; captured output in $output_file"
  return 1
}

append_cmd_section() {
  local output_file="$1"
  local label="$2"
  shift 2

  {
    printf '\n===== %s =====\n' "$label"
    printf '+'
    local arg
    for arg in "$@"; do
      printf ' %q' "$arg"
    done
    printf '\n'
  } >>"$output_file"

  print_command "$@"
  "$@" >>"$output_file" 2>&1
}

append_adb_section() {
  local output_file="$1"
  local label="$2"
  shift 2

  build_adb_cmd "$@"
  append_cmd_section "$output_file" "$label" "${ADB_COMMAND[@]}"
}

read_adb_shell_value() {
  local remote_command="$1"
  build_adb_cmd shell "$remote_command"
  print_command "${ADB_COMMAND[@]}"
  "${ADB_COMMAND[@]}" 2>/dev/null | tr -d '\r' | tail -n 1
}

ensure_tools() {
  if ! command -v "$ADB" >/dev/null 2>&1; then
    fail_infra "adb not found in PATH; set ADB=/path/to/adb if needed"
  fi
}

resolve_device() {
  local devices_file="$OUTPUT_DIR/adb-devices.txt"
  print_command "$ADB" devices
  "$ADB" devices >"$devices_file" 2>&1 || fail_infra "adb devices failed; see $devices_file"

  if [[ -n "$DEVICE_SERIAL" ]]; then
    if ! run_adb_capture "$OUTPUT_DIR/adb-get-state.txt" get-state; then
      fail_infra "selected device is not reachable: $DEVICE_SERIAL"
    fi
    add_evidence "selected adb serial: $DEVICE_SERIAL"
    return
  fi

  local devices
  devices="$(awk 'NR > 1 && $2 == "device" { print $1 }' "$devices_file")"

  local count
  count="$(printf '%s\n' "$devices" | sed '/^$/d' | wc -l | tr -d ' ')"

  if [[ "$count" == "0" ]]; then
    fail_infra "no Android device is connected"
  fi

  if [[ "$count" != "1" ]]; then
    add_error "connected adb devices:"
    while IFS= read -r line; do
      [[ -n "$line" ]] && add_error "$line"
    done <"$devices_file"
    fail_blocked "multiple Android devices are connected; pass --device <adbSerial>"
  fi

  DEVICE_SERIAL="$(printf '%s\n' "$devices" | sed '/^$/d' | head -n 1)"
  add_evidence "auto-selected adb serial: $DEVICE_SERIAL"
}

collect_device_info() {
  : >"$DEVICE_FILE"
  append_cmd_section "$DEVICE_FILE" "adb devices" "$ADB" devices || true
  append_adb_section "$DEVICE_FILE" "adb get-state" get-state || fail_infra "adb get-state failed"
  append_adb_section "$DEVICE_FILE" "ro.product.manufacturer" shell getprop ro.product.manufacturer || true
  append_adb_section "$DEVICE_FILE" "ro.product.model" shell getprop ro.product.model || true
  append_adb_section "$DEVICE_FILE" "ro.build.version.release" shell getprop ro.build.version.release || true
  append_adb_section "$DEVICE_FILE" "ro.build.version.sdk" shell getprop ro.build.version.sdk || true
  append_adb_section "$DEVICE_FILE" "sys.boot_completed" shell getprop sys.boot_completed || true

  DEVICE_MANUFACTURER="$(read_adb_shell_value "getprop ro.product.manufacturer" || true)"
  DEVICE_MODEL="$(read_adb_shell_value "getprop ro.product.model" || true)"
  ANDROID_RELEASE="$(read_adb_shell_value "getprop ro.build.version.release" || true)"
  ANDROID_API="$(read_adb_shell_value "getprop ro.build.version.sdk" || true)"

  add_evidence "device: ${DEVICE_MANUFACTURER:-unknown} ${DEVICE_MODEL:-unknown}, Android ${ANDROID_RELEASE:-unknown} API ${ANDROID_API:-unknown}"
}

check_package_installed() {
  local package_file="$OUTPUT_DIR/package-path.txt"
  local remote_pm_path
  remote_pm_path="pm path $(shell_quote "$PACKAGE_NAME")"

  if ! run_adb_capture "$package_file" shell "$remote_pm_path"; then
    fail_infra "pm path failed for $PACKAGE_NAME; see $package_file"
  fi

  if ! grep -q '^package:' "$package_file"; then
    fail_infra "package is not installed on the selected device: $PACKAGE_NAME"
  fi

  add_evidence "package is installed: $PACKAGE_NAME"
}

collect_permissions() {
  local package_dump="$OUTPUT_DIR/dumpsys-package.txt"
  local appops_dump="$OUTPUT_DIR/appops.txt"
  local assistant_dump="$OUTPUT_DIR/notification-assistant.txt"

  run_adb_capture_best_effort "dumpsys package" "$package_dump" shell "dumpsys package $(shell_quote "$PACKAGE_NAME")" || true
  run_adb_capture_best_effort "appops get" "$appops_dump" shell "appops get $(shell_quote "$PACKAGE_NAME")" || true
  run_adb_capture_best_effort "cmd notification get_approved_assistant" "$assistant_dump" shell cmd notification get_approved_assistant || true

  if [[ "$ANDROID_API" =~ ^[0-9]+$ && "$ANDROID_API" -ge 33 && -s "$package_dump" ]]; then
    if grep -Fq 'android.permission.POST_NOTIFICATIONS: granted=true' "$package_dump"; then
      add_evidence "POST_NOTIFICATIONS is granted"
    else
      INFRA_FAILURE="1"
      add_error "POST_NOTIFICATIONS does not appear granted on API $ANDROID_API"
    fi
  fi

  if [[ -s "$appops_dump" ]] && grep -Eiq 'SCHEDULE_EXACT_ALARM.*(deny|ignore)' "$appops_dump"; then
    add_warning "SCHEDULE_EXACT_ALARM appop may be denied; inspect $appops_dump"
  fi
}

note_skip_build() {
  add_evidence "build/install skipped; this script uses the currently installed smoke app"
}

clear_logcat() {
  add_warning "--clear-logcat was passed; clearing the global adb logcat buffer"
  if ! run_adb_capture "$OUTPUT_DIR/logcat-clear.txt" logcat -c; then
    INFRA_FAILURE="1"
    add_error "logcat -c failed; see $OUTPUT_DIR/logcat-clear.txt"
    return 1
  fi
  add_evidence "logcat cleared intentionally before scheduling"
}

maybe_clear_logcat() {
  if [[ "$CLEAR_LOGCAT" != "1" ]]; then
    add_evidence "logcat not cleared; captures use non-destructive adb logcat -d"
    return 0
  fi

  clear_logcat
}

start_deeplink() {
  local uri="$1"
  local output_file="$2"
  local remote_command
  remote_command="am start -W -a android.intent.action.VIEW -d $(shell_quote "$uri") $(shell_quote "$PACKAGE_NAME")"

  run_adb_capture "$output_file" shell "$remote_command"
}

check_am_start_output() {
  local label="$1"
  local output_file="$2"

  if grep -Eiq 'Error:|Exception|unable to resolve|does not exist|not found' "$output_file"; then
    INFRA_FAILURE="1"
    add_error "$label deep link did not start cleanly; see $output_file"
    return 1
  fi

  return 0
}

schedule_triggers() {
  local schedule_file="$OUTPUT_DIR/deeplink-schedule.txt"
  local uri
  uri="notifykit://reboot-smoke/schedule?count=$TRIGGER_COUNT&delaySeconds=$FIRE_DELAY_SECONDS&spacingSeconds=$SPACING_SECONDS&alarmType=$ALARM_TYPE"

  SCHEDULE_HOST_EPOCH="$(date +%s)"
  add_evidence "schedule deep link: $uri"

  if ! start_deeplink "$uri" "$schedule_file"; then
    INFRA_FAILURE="1"
    add_error "schedule deep link command failed; see $schedule_file"
    return 1
  fi

  check_am_start_output "schedule" "$schedule_file" || return 1
  sleep "$DEEPLINK_SETTLE_SECONDS"
}

dump_harness() {
  local phase="$1"
  local dump_file="$OUTPUT_DIR/deeplink-dump-$phase.txt"
  local uri="notifykit://reboot-smoke/dump"

  if ! start_deeplink "$uri" "$dump_file"; then
    INFRA_FAILURE="1"
    add_error "dump deep link command failed during $phase; see $dump_file"
    return 1
  fi

  check_am_start_output "dump ($phase)" "$dump_file" || return 1
  sleep "$DEEPLINK_SETTLE_SECONDS"
}

cancel_harness_triggers() {
  local phase="$1"
  local cancel_file="$OUTPUT_DIR/deeplink-cancel-$phase.txt"
  local uri="notifykit://reboot-smoke/cancel"

  add_evidence "cancel requested via harness deep link only"

  if ! start_deeplink "$uri" "$cancel_file"; then
    INFRA_FAILURE="1"
    add_error "cancel deep link command failed during $phase; see $cancel_file"
    return 1
  fi

  check_am_start_output "cancel ($phase)" "$cancel_file" || return 1
  sleep "$DEEPLINK_SETTLE_SECONDS"
}

capture_logcat() {
  local label="$1"
  local output_file="$2"

  if ! run_adb_capture "$output_file" logcat -d -v time; then
    INFRA_FAILURE="1"
    add_error "logcat capture failed for $label; see $output_file"
    return 1
  fi

  add_evidence "captured logcat for $label: $output_file"
}

filter_alarm_file() {
  local input_file="$1"
  local output_file="$2"

  : >"$output_file"
  if [[ ! -s "$input_file" ]]; then
    return
  fi

  {
    print_lines_mentioning_target_package "$input_file" || true
    grep -Fi 'notifee' "$input_file" || true
    grep -F 'reboot-smoke-harness' "$input_file" || true
    grep -F 'Reboot' "$input_file" || true
  } | awk '!seen[$0]++' >"$output_file"
}

alarm_has_relevant_evidence() {
  local input_file="$1"
  local line

  [[ -s "$input_file" ]] || return 1

  while IFS= read -r line || [[ -n "$line" ]]; do
    line_mentions_target_package "$line" || continue
    line_mentions_alarm_marker "$line" && return 0
  done <"$input_file"

  return 1
}

note_exact_alarm_fallback_if_present() {
  local input_file="$1"

  [[ -s "$input_file" ]] || return
  if grep -Fq 'SCHEDULE_EXACT_ALARM permission not granted. Falling back to inexact alarm.' "$input_file"; then
    if [[ "$EXACT_ALARM_FALLBACK_OBSERVED" != "1" ]]; then
      add_warning "SCHEDULE_EXACT_ALARM fallback observed; exact fire timing is not validated by this smoke run"
    fi
    EXACT_ALARM_FALLBACK_OBSERVED="1"
  fi
}

append_receiver_log_evidence_source() {
  local source="$1"

  if [[ "$RECEIVER_LOG_EVIDENCE_SOURCE" == "none" ]]; then
    RECEIVER_LOG_EVIDENCE_SOURCE="$source"
    return
  fi

  case ",$RECEIVER_LOG_EVIDENCE_SOURCE," in
    *",$source,"*)
      ;;
    *)
      RECEIVER_LOG_EVIDENCE_SOURCE="$RECEIVER_LOG_EVIDENCE_SOURCE,$source"
      ;;
  esac
}

escape_ere() {
  local value="$1"

  printf '%s' "$value" | sed 's/[][\\.^$*+?{}()|]/\\&/g'
}

ensure_package_name_regex() {
  if [[ "$PACKAGE_NAME_REGEX_SOURCE" == "$PACKAGE_NAME" ]]; then
    return
  fi

  PACKAGE_NAME_REGEX="$(escape_ere "$PACKAGE_NAME")"
  PACKAGE_NAME_REGEX_SOURCE="$PACKAGE_NAME"
}

line_mentions_target_package() {
  local line="$1"
  local package_boundary_before='(^|[[:space:]{(:=,])'
  local package_boundary_after='($|[[:space:]/}):;,])'

  [[ -n "$PACKAGE_NAME" ]] || return 1
  ensure_package_name_regex
  [[ "$line" =~ ${package_boundary_before}${PACKAGE_NAME_REGEX}${package_boundary_after} ]]
}

print_lines_mentioning_target_package() {
  local input_file="$1"
  local line
  local found="1"

  [[ -s "$input_file" ]] || return 1

  while IFS= read -r line || [[ -n "$line" ]]; do
    if line_mentions_target_package "$line"; then
      printf '%s\n' "$line"
      found="0"
    fi
  done <"$input_file"

  return "$found"
}

line_mentions_notifykit() {
  local line="$1"

  printf '%s\n' "$line" |
    grep -Eiq 'NOTIFEE|NotifeeAlarmManager|InitProvider|RebootReceiver|RebootBroadcastReceiver|NotificationAlarmReceiver|app[.]notifee[.]core'
}

line_mentions_alarm_marker() {
  local line="$1"

  printf '%s\n' "$line" |
    grep -Eiq 'app[.]notifee[.]core|NotificationAlarmReceiver|reboot-smoke-harness'
}

line_mentions_target_reboot_receiver() {
  local line="$1"

  line_mentions_target_package "$line" || return 1
  printf '%s\n' "$line" |
    grep -Eiq 'app[.]notifee[.]core[.]RebootBroadcastReceiver|RebootBroadcastReceiver|RebootReceiver'
}

line_mentions_target_recovery() {
  local line="$1"

  line_mentions_target_package "$line" || return 1
  printf '%s\n' "$line" |
    grep -Eiq 'NOTIFEE|NotifeeAlarmManager|InitProvider|BOOT_COUNT|reschedul|rearm|recover|app[.]notifee[.]core'
}

extract_notifykit_package_from_line() {
  local line="$1"

  {
    printf '%s\n' "$line" |
      grep -Eo '[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+/app[.]notifee[.]core[.][A-Za-z0-9_$]+' || true
  } |
    sed 's#/.*##' |
    awk '!seen[$0]++'
}

record_non_target_notifykit_package() {
  local observed_package="$1"

  [[ -n "$observed_package" ]] || return
  [[ "$observed_package" != "$PACKAGE_NAME" ]] || return

  NON_TARGET_NOTIFYKIT_LOG_OBSERVED="1"
  if [[ "$NON_TARGET_NOTIFYKIT_PACKAGE_OBSERVED" == "none" ]]; then
    NON_TARGET_NOTIFYKIT_PACKAGE_OBSERVED="$observed_package"
    return
  fi

  case ",$NON_TARGET_NOTIFYKIT_PACKAGE_OBSERVED," in
    *",$observed_package,"*)
      ;;
    *)
      NON_TARGET_NOTIFYKIT_PACKAGE_OBSERVED="$NON_TARGET_NOTIFYKIT_PACKAGE_OBSERVED,$observed_package"
      ;;
  esac
}

record_notifykit_log_context() {
  local input_file="$1"
  local line
  local observed_package
  local generic_was_observed="$GENERIC_NOTIFYKIT_LOG_OBSERVED"
  local target_was_observed="$TARGET_PACKAGE_LOG_OBSERVED"
  local non_target_was_observed="$NON_TARGET_NOTIFYKIT_LOG_OBSERVED"

  [[ -s "$input_file" ]] || return

  while IFS= read -r line; do
    line_mentions_notifykit "$line" || continue

    GENERIC_NOTIFYKIT_LOG_OBSERVED="1"

    if line_mentions_target_package "$line"; then
      TARGET_PACKAGE_LOG_OBSERVED="1"
    fi

    while IFS= read -r observed_package; do
      [[ -n "$observed_package" ]] || continue
      if [[ "$observed_package" == "$PACKAGE_NAME" ]]; then
        TARGET_PACKAGE_LOG_OBSERVED="1"
      else
        record_non_target_notifykit_package "$observed_package"
      fi
    done < <(extract_notifykit_package_from_line "$line")
  done <"$input_file"

  if [[ "$generic_was_observed" != "1" && "$GENERIC_NOTIFYKIT_LOG_OBSERVED" == "1" ]]; then
    add_evidence "generic NotifyKit marker observed in logcat for diagnostics only"
  fi

  if [[ "$target_was_observed" != "1" && "$TARGET_PACKAGE_LOG_OBSERVED" == "1" ]]; then
    add_evidence "target package NotifyKit marker observed in logcat"
  fi

  if [[ "$non_target_was_observed" != "1" && "$NON_TARGET_NOTIFYKIT_LOG_OBSERVED" == "1" ]]; then
    add_evidence "non-target NotifyKit marker observed in logcat for package(s): $NON_TARGET_NOTIFYKIT_PACKAGE_OBSERVED"
  fi
}

post_reboot_log_has_generic_boot_marker() {
  local input_file="$1"

  [[ -s "$input_file" ]] || return 1
  grep -Eiq 'BOOT_COMPLETED|BOOT_COUNT|reschedul|rearm|recover' "$input_file"
}

post_reboot_log_has_specific_reboot_receiver_marker() {
  local input_file="$1"
  local line

  [[ -s "$input_file" ]] || return 1

  while IFS= read -r line; do
    if line_mentions_target_reboot_receiver "$line"; then
      return 0
    fi
  done <"$input_file"

  return 1
}

post_reboot_log_has_specific_recovery_marker() {
  local input_file="$1"
  local line

  [[ -s "$input_file" ]] || return 1

  while IFS= read -r line; do
    if line_mentions_target_recovery "$line"; then
      return 0
    fi
  done <"$input_file"

  return 1
}

update_post_reboot_log_flags() {
  local input_file="$1"

  [[ -s "$input_file" ]] || return

  local receiver_was_observed="$RECEIVER_LOG_OBSERVED"

  record_notifykit_log_context "$input_file"

  if post_reboot_log_has_generic_boot_marker "$input_file"; then
    if [[ "$GENERIC_BOOT_LOG_OBSERVED" != "1" ]]; then
      add_evidence "generic post-reboot boot/recovery marker observed in logcat for diagnostics only"
    fi
    GENERIC_BOOT_LOG_OBSERVED="1"
  fi

  if grep -Fq 'BOOT_COMPLETED' "$input_file"; then
    if [[ "$BOOT_COMPLETED_LOG_OBSERVED" != "1" ]]; then
      add_evidence "generic BOOT_COMPLETED marker observed in post-reboot logcat"
    fi
    BOOT_COMPLETED_LOG_OBSERVED="1"
  fi

  if grep -Fq 'BOOT_COUNT' "$input_file"; then
    if [[ "$BOOT_COUNT_LOG_OBSERVED" != "1" ]]; then
      add_evidence "generic BOOT_COUNT marker observed in post-reboot logcat"
    fi
    BOOT_COUNT_LOG_OBSERVED="1"
  fi

  if post_reboot_log_has_specific_reboot_receiver_marker "$input_file"; then
    if [[ "$TARGET_REBOOT_RECEIVER_LOG_OBSERVED" != "1" ]]; then
      add_evidence "target package reboot receiver marker observed in logcat"
    fi
    TARGET_REBOOT_RECEIVER_LOG_OBSERVED="1"
    SPECIFIC_REBOOT_RECEIVER_LOG_OBSERVED="1"
    REBOOT_RECEIVER_LOG_OBSERVED="1"
    RECEIVER_LOG_OBSERVED="1"
    append_receiver_log_evidence_source "target_reboot_receiver_log"
  fi

  if post_reboot_log_has_specific_recovery_marker "$input_file"; then
    if [[ "$TARGET_RECOVERY_LOG_OBSERVED" != "1" ]]; then
      add_evidence "target package recovery marker observed in logcat"
    fi
    TARGET_RECOVERY_LOG_OBSERVED="1"
    SPECIFIC_RECOVERY_LOG_OBSERVED="1"
    RECEIVER_LOG_OBSERVED="1"
    append_receiver_log_evidence_source "target_recovery_log"
  fi

  if [[ "$receiver_was_observed" != "1" && "$RECEIVER_LOG_OBSERVED" == "1" ]]; then
    add_evidence "post-reboot receiver/recovery marker observed in logcat with target package evidence"
  fi
}

record_post_reboot_alarm_observation() {
  local phase="$1"
  local elapsed_seconds="$2"
  local input_file="$3"

  alarm_has_relevant_evidence "$input_file" || return 1

  if [[ "$POST_ALARM_PRESENT" != "1" ]]; then
    POST_REBOOT_ALARM_FIRST_SEEN_AFTER_SECONDS="$elapsed_seconds"
  fi
  POST_ALARM_PRESENT="1"

  if [[ "$phase" == "initial" ]]; then
    if [[ "$POST_REBOOT_ALARM_PRESENT_INITIAL" != "1" ]]; then
      add_evidence "immediate post-reboot dumpsys alarm contains target package Notifee alarm evidence"
    fi
    POST_REBOOT_ALARM_PRESENT_INITIAL="1"
    return 0
  fi

  if [[ "$POST_REBOOT_ALARM_PRESENT_INITIAL" != "1" ]]; then
    if [[ "$POST_REBOOT_ALARM_PRESENT_LATE" != "1" ]]; then
      add_evidence "late rearm observed after ${elapsed_seconds}s in post-reboot observation window"
    fi
    POST_REBOOT_ALARM_PRESENT_LATE="1"
    LATE_REARM_OBSERVED="1"
  fi
}

reboot_smoke_dump_has_positive_count() {
  local input_file="$1"

  [[ -s "$input_file" ]] || return 1
  awk '
    /REBOOT-SMOKE:DUMP/ &&
    /"action"[[:space:]]*:[[:space:]]*"dump"/ &&
    /"status"[[:space:]]*:[[:space:]]*"PASS"/ &&
    /"(count|triggerCount)"[[:space:]]*:[[:space:]]*[1-9][0-9]*/ {
      found = 1
    }
    END {
      exit(found ? 0 : 1)
    }
  ' "$input_file"
}

cold_start_log_has_reschedule_evidence() {
  local input_file="$1"

  [[ -s "$input_file" ]] || return 1
  post_reboot_log_has_specific_recovery_marker "$input_file" || return 1
  print_lines_mentioning_target_package "$input_file" >/dev/null
}

capture_dumpsys_alarm() {
  local phase="$1"
  local output_file="$2"
  local filtered_file="$3"

  if ! run_adb_capture_best_effort "dumpsys alarm ($phase)" "$output_file" shell dumpsys alarm; then
    return 1
  fi

  filter_alarm_file "$output_file" "$filtered_file"
  add_evidence "captured dumpsys alarm for $phase: $output_file"
}

capture_post_reboot_dumpsys_alarm() {
  local phase="$1"
  local output_file="$2"
  local filtered_file="$3"

  POST_REBOOT_DUMPSYS_ATTEMPTS=$((POST_REBOOT_DUMPSYS_ATTEMPTS + 1))

  if ! run_adb_capture_best_effort "dumpsys alarm ($phase)" "$output_file" shell dumpsys alarm; then
    POST_REBOOT_DUMPSYS_FAILURE_COUNT=$((POST_REBOOT_DUMPSYS_FAILURE_COUNT + 1))
    return 1
  fi

  if [[ ! -s "$output_file" ]]; then
    POST_REBOOT_DUMPSYS_FAILURE_COUNT=$((POST_REBOOT_DUMPSYS_FAILURE_COUNT + 1))
    add_warning "dumpsys alarm ($phase) succeeded but produced no readable output; see $output_file"
    return 1
  fi

  POST_REBOOT_DUMPSYS_SUCCESS_COUNT=$((POST_REBOOT_DUMPSYS_SUCCESS_COUNT + 1))
  POST_REBOOT_DUMPSYS_ANY_SUCCESS="1"
  filter_alarm_file "$output_file" "$filtered_file"
  add_evidence "captured dumpsys alarm for $phase: $output_file"
}

capture_post_reboot_observation_sample() {
  local elapsed_seconds="$1"
  local alarm_file="$POST_REBOOT_OBSERVATION_DIR/dumpsys-alarm-${elapsed_seconds}s.txt"
  local alarm_filtered_file="$POST_REBOOT_OBSERVATION_DIR/dumpsys-alarm-${elapsed_seconds}s-filtered.txt"
  local logcat_file="$POST_REBOOT_OBSERVATION_DIR/logcat-${elapsed_seconds}s.txt"
  local dumpsys_success="0"

  {
    printf '%s elapsed_seconds=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$elapsed_seconds"
    printf '  logcat: %s\n' "$logcat_file"
    printf '  dumpsys_alarm: %s\n' "$alarm_file"
  } >>"$POST_REBOOT_OBSERVATION_FILE"

  if run_adb_capture "$logcat_file" logcat -d -v time; then
    update_post_reboot_log_flags "$logcat_file"
    note_exact_alarm_fallback_if_present "$logcat_file"
  else
    INFRA_FAILURE="1"
    add_error "logcat capture failed during post-reboot observation at ${elapsed_seconds}s; see $logcat_file"
  fi

  if capture_post_reboot_dumpsys_alarm "post-reboot observation ${elapsed_seconds}s" "$alarm_file" "$alarm_filtered_file"; then
    dumpsys_success="1"
    if record_post_reboot_alarm_observation "late" "$elapsed_seconds" "$alarm_file"; then
      printf '  dumpsys_alarm_success: %s\n' "$dumpsys_success" >>"$POST_REBOOT_OBSERVATION_FILE"
      printf '  alarm_observed: 1\n' >>"$POST_REBOOT_OBSERVATION_FILE"
      return 0
    fi
  fi

  printf '  dumpsys_alarm_success: %s\n' "$dumpsys_success" >>"$POST_REBOOT_OBSERVATION_FILE"
  printf '  alarm_observed: 0\n' >>"$POST_REBOOT_OBSERVATION_FILE"
  return 1
}

observe_post_reboot_window() {
  ensure_output_dir
  : >"$POST_REBOOT_OBSERVATION_FILE"

  if record_post_reboot_alarm_observation "initial" "0" "$POST_ALARM_FILE"; then
    printf '%s initial_alarm_observed=1\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >>"$POST_REBOOT_OBSERVATION_FILE"
    return
  fi

  printf '%s initial_alarm_observed=0\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >>"$POST_REBOOT_OBSERVATION_FILE"

  if [[ "$POST_REBOOT_OBSERVATION_SECONDS" == "0" ]]; then
    add_warning "post-reboot observation polling disabled by --post-reboot-observation-seconds 0"
    printf '%s observation_disabled=1\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >>"$POST_REBOOT_OBSERVATION_FILE"
    return
  fi

  log "observing post-reboot alarm recovery for up to ${POST_REBOOT_OBSERVATION_SECONDS}s"

  local start_seconds="$SECONDS"
  local elapsed_seconds="0"
  local remaining_seconds="0"
  local sleep_seconds="0"

  while (( SECONDS - start_seconds < POST_REBOOT_OBSERVATION_SECONDS )); do
    elapsed_seconds=$((SECONDS - start_seconds))
    remaining_seconds=$((POST_REBOOT_OBSERVATION_SECONDS - elapsed_seconds))
    if (( remaining_seconds <= 0 )); then
      break
    fi

    sleep_seconds="$POST_REBOOT_POLL_INTERVAL_SECONDS"
    if (( sleep_seconds > remaining_seconds )); then
      sleep_seconds="$remaining_seconds"
    fi

    sleep "$sleep_seconds"
    elapsed_seconds=$((SECONDS - start_seconds))

    if capture_post_reboot_observation_sample "$elapsed_seconds"; then
      return
    fi
  done

  POST_REBOOT_OBSERVATION_COMPLETED="1"
  printf '%s observation_completed=1\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >>"$POST_REBOOT_OBSERVATION_FILE"
  add_warning "post-reboot observation window ended without alarm evidence"
}

refresh_marker_file() {
  : >"$MARKERS_FILE"

  local file
  for file in \
    "$PRE_LOGCAT_FILE" \
    "$POST_LOGCAT_FILE" \
    "$COLD_LOGCAT_FILE" \
    "$OUTPUT_DIR/logcat-after-first-fire.txt" \
    "$OUTPUT_DIR/logcat-after-cancel.txt"; do
    [[ -s "$file" ]] || continue
    {
      printf '\n===== %s =====\n' "$(basename "$file")"
      {
        grep -E 'REBOOT-SMOKE:|NOTIFEE|Notifee|RebootReceiver|BOOT_COMPLETED|BOOT_COUNT|reschedule|AlarmManager' "$file" || true
        print_lines_mentioning_target_package "$file" || true
      } | awk '!seen[$0]++'
    } >>"$MARKERS_FILE"
  done

  for file in "$POST_REBOOT_OBSERVATION_DIR"/logcat-*.txt; do
    [[ -s "$file" ]] || continue
    {
      printf '\n===== %s/%s =====\n' "$(basename "$POST_REBOOT_OBSERVATION_DIR")" "$(basename "$file")"
      {
        grep -E 'REBOOT-SMOKE:|NOTIFEE|Notifee|RebootReceiver|NotificationAlarmReceiver|BOOT_COMPLETED|BOOT_COUNT|reschedul|rearm|recover|AlarmManager' "$file" || true
        print_lines_mentioning_target_package "$file" || true
      } | awk '!seen[$0]++'
    } >>"$MARKERS_FILE"
  done
}

analyze_pre_reboot_evidence() {
  if [[ -s "$PRE_LOGCAT_FILE" ]]; then
    note_exact_alarm_fallback_if_present "$PRE_LOGCAT_FILE"

    if grep -Eq 'REBOOT-SMOKE:ERROR|REBOOT-SMOKE:DUMP_ERROR' "$PRE_LOGCAT_FILE"; then
      INFRA_FAILURE="1"
      add_error "harness emitted an error marker before reboot; inspect $PRE_LOGCAT_FILE"
    fi

    if grep 'REBOOT-SMOKE:RESULT' "$PRE_LOGCAT_FILE" | grep -q '"action":"schedule".*"status":"PASS"'; then
      SCHEDULE_OK="1"
      add_evidence "schedule PASS marker observed"
    elif grep -Fq 'reboot-smoke-harness-' "$PRE_LOGCAT_FILE"; then
      SCHEDULE_OK="1"
      add_evidence "harness notification id observed in logcat"
    fi

    if grep 'REBOOT-SMOKE:DUMP' "$PRE_LOGCAT_FILE" | grep -q '"action":"dump".*"status":"PASS"'; then
      DUMP_OK="1"
      add_evidence "dump PASS marker observed before reboot"
    fi
  fi

  if alarm_has_relevant_evidence "$PRE_ALARM_FILE"; then
    PRE_ALARM_PRESENT="1"
    add_evidence "pre-reboot dumpsys alarm contains target package Notifee alarm evidence"
  else
    add_warning "pre-reboot dumpsys alarm did not contain target package Notifee alarm evidence"
  fi
}

analyze_post_reboot_evidence() {
  if [[ -s "$POST_LOGCAT_FILE" ]]; then
    update_post_reboot_log_flags "$POST_LOGCAT_FILE"
    note_exact_alarm_fallback_if_present "$POST_LOGCAT_FILE"

    if grep -Eq 'REBOOT-SMOKE:ERROR|REBOOT-SMOKE:DUMP_ERROR' "$POST_LOGCAT_FILE"; then
      add_warning "harness emitted an error marker after reboot; inspect $POST_LOGCAT_FILE"
    fi
  fi

  if record_post_reboot_alarm_observation "initial" "0" "$POST_ALARM_FILE"; then
    :
  else
    add_warning "post-reboot dumpsys alarm did not contain target package Notifee alarm evidence"
  fi

  if [[ -s "$COLD_LOGCAT_FILE" ]]; then
    update_post_reboot_log_flags "$COLD_LOGCAT_FILE"
    note_exact_alarm_fallback_if_present "$COLD_LOGCAT_FILE"

    if grep -Fq 'REBOOT-SMOKE:DUMP' "$COLD_LOGCAT_FILE"; then
      COLD_DUMP_MARKER_OBSERVED="1"
      add_evidence "cold-start dump marker observed after opening dump deep link"
    fi

    if reboot_smoke_dump_has_positive_count "$COLD_LOGCAT_FILE"; then
      COLD_DUMP_HAS_TRIGGERS="1"
      COLD_START_RECOVERY_OBSERVED="1"
      add_evidence "cold-start dump reported pending harness trigger count greater than zero"
    fi

    if cold_start_log_has_reschedule_evidence "$COLD_LOGCAT_FILE"; then
      COLD_RESCHEDULE_LOG_OBSERVED="1"
      COLD_START_RECOVERY_OBSERVED="1"
      add_evidence "cold-start log contains BOOT_COUNT with receiver/recovery evidence"
    fi

    if [[ "$COLD_DUMP_MARKER_OBSERVED" == "1" && "$COLD_DUMP_HAS_TRIGGERS" != "1" ]]; then
      add_warning "cold-start dump marker did not report a positive trigger count; dump marker alone is not recovery evidence"
    fi
  fi

  if [[ "$TEST_COLD_START_RECOVERY" == "1" && -e "$POST_COLD_ALARM_FILTERED_FILE" ]]; then
    if alarm_has_relevant_evidence "$POST_COLD_ALARM_FILTERED_FILE"; then
      POST_COLD_ALARM_PRESENT="1"
      COLD_START_RECOVERY_OBSERVED="1"
      add_evidence "post-cold-start dumpsys alarm contains target package Notifee alarm evidence"
    else
      add_warning "post-cold-start dumpsys alarm did not contain target package Notifee alarm evidence"
    fi
  fi
}

reboot_device() {
  if [[ "$DO_REBOOT" != "1" ]]; then
    fail_blocked "adb reboot requires --i-know-this-reboots-device"
  fi

  if ! run_adb_capture "$OUTPUT_DIR/reboot-command.txt" reboot; then
    fail_infra "adb reboot failed; see $OUTPUT_DIR/reboot-command.txt"
  fi

  REBOOT_EXECUTED="1"
  add_evidence "adb reboot command was issued"
}

wait_for_adb_device_after_reboot() {
  local start_seconds="$1"
  local wait_file="$OUTPUT_DIR/adb-device-reachable.txt"
  local state=""

  : >"$wait_file"
  log "waiting for adb device for up to ${BOOT_TIMEOUT_SECONDS}s"

  while (( SECONDS - start_seconds < BOOT_TIMEOUT_SECONDS )); do
    build_adb_cmd get-state
    print_command "${ADB_COMMAND[@]}"
    if state="$("${ADB_COMMAND[@]}" 2>>"$wait_file" | tr -d '\r' | tail -n 1)"; then
      printf '%s adb_state=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "${state:-<empty>}" >>"$wait_file"
      if [[ "$state" == "device" ]]; then
        add_evidence "adb device reachable after reboot"
        return 0
      fi
    else
      printf '%s adb_state=<adb error>\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >>"$wait_file"
    fi
    sleep 3
  done

  fail_infra "device did not become reachable via adb within ${BOOT_TIMEOUT_SECONDS}s after reboot; see $wait_file"
}

wait_for_boot_completed() {
  local start_seconds="$SECONDS"
  wait_for_adb_device_after_reboot "$start_seconds"
  : >"$BOOT_WAIT_FILE"
  local value=""
  log "polling sys.boot_completed until ${BOOT_TIMEOUT_SECONDS}s post-reboot timeout expires"

  while (( SECONDS - start_seconds < BOOT_TIMEOUT_SECONDS )); do
    build_adb_cmd shell getprop sys.boot_completed
    print_command "${ADB_COMMAND[@]}"
    if value="$("${ADB_COMMAND[@]}" 2>>"$BOOT_WAIT_FILE" | tr -d '\r')"; then
      printf '%s sys.boot_completed=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$value" >>"$BOOT_WAIT_FILE"
      if [[ "$value" == "1" ]]; then
        BOOT_COMPLETED="1"
        add_evidence "sys.boot_completed=1 after reboot"
        sleep "$POST_BOOT_SETTLE_SECONDS"
        return 0
      fi
    else
      printf '%s sys.boot_completed=<adb error>\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >>"$BOOT_WAIT_FILE"
    fi
    sleep 3
  done

  fail_infra "device did not report sys.boot_completed=1 within ${BOOT_TIMEOUT_SECONDS}s after reboot"
}

wait_until_fire_time_if_reasonable() {
  if [[ "$SCHEDULE_HOST_EPOCH" == "0" ]]; then
    return
  fi

  local first_fire_epoch
  first_fire_epoch=$((SCHEDULE_HOST_EPOCH + FIRE_DELAY_SECONDS))

  local now
  now="$(date +%s)"
  local remaining
  remaining=$((first_fire_epoch - now))

  if (( remaining <= 0 )); then
    add_evidence "first fire time has already passed or is due now"
    return
  fi

  if (( remaining > MAX_FIRE_WAIT_SECONDS )); then
    add_warning "not waiting ${remaining}s for first fire time; MAX_FIRE_WAIT_SECONDS=$MAX_FIRE_WAIT_SECONDS"
    return
  fi

  add_evidence "waiting ${remaining}s until approximate first fire time"
  sleep "$remaining"
  sleep 5
  capture_logcat "after-first-fire" "$OUTPUT_DIR/logcat-after-first-fire.txt" || true
}

classify_no_reboot() {
  if [[ "$INFRA_FAILURE" == "1" ]]; then
    VERDICT="FAIL INFRASTRUTTURALE"
    EXIT_CODE="3"
    CLASSIFICATION_REASON="infrastructure failure before reboot validation"
    return
  fi

  if [[ "$SCHEDULE_OK" != "1" ]]; then
    VERDICT="FAIL INFRASTRUTTURALE"
    EXIT_CODE="3"
    CLASSIFICATION_REASON="schedule could not be confirmed from harness markers"
    add_error "schedule could not be confirmed from harness markers"
    return
  fi

  VERDICT="NON CONCLUSIVO"
  EXIT_CODE="3"
  CLASSIFICATION_REASON="no reboot was executed, so reboot recovery is not validated"
  add_warning "no reboot was executed, so reboot recovery is not validated"
}

classify_reboot() {
  if [[ "$INFRA_FAILURE" == "1" ]]; then
    VERDICT="FAIL INFRASTRUTTURALE"
    EXIT_CODE="3"
    CLASSIFICATION_REASON="infrastructure failure while collecting reboot evidence"
    return
  fi

  if [[ "$REBOOT_EXECUTED" != "1" || "$BOOT_COMPLETED" != "1" ]]; then
    VERDICT="FAIL INFRASTRUTTURALE"
    EXIT_CODE="3"
    CLASSIFICATION_REASON="reboot did not complete successfully"
    add_error "reboot did not complete successfully"
    return
  fi

  if [[ "$SCHEDULE_OK" == "1" && "$PRE_ALARM_PRESENT" == "1" && "$POST_ALARM_PRESENT" == "1" ]]; then
    VERDICT="PASS CON NOTE"
    EXIT_CODE="0"
    if [[ "$LATE_REARM_OBSERVED" == "1" ]]; then
      CLASSIFICATION_REASON="late rearm observed during post-reboot observation window"
      add_warning "alarm was not present in the immediate post-reboot snapshot but appeared during observation"
    else
      CLASSIFICATION_REASON="post-reboot alarm evidence observed"
    fi
    add_warning "visual notification delivery was not observed automatically"
    return
  fi

  if [[ "$SCHEDULE_OK" == "1" && "$PRE_ALARM_PRESENT" == "1" && "$COLD_START_RECOVERY_OBSERVED" == "1" ]]; then
    VERDICT="PASS CON NOTE"
    EXIT_CODE="0"
    CLASSIFICATION_REASON="recovery evidence was observed only after opening the app"
    add_warning "recovery evidence was observed only after opening the app"
    add_warning "visual notification delivery was not observed automatically"
    return
  fi

  if [[ "$SCHEDULE_OK" == "1" && "$PRE_ALARM_PRESENT" == "1" && "$RECEIVER_LOG_OBSERVED" == "1" && "$POST_ALARM_PRESENT" != "1" ]]; then
    if [[ "$POST_REBOOT_OBSERVATION_SECONDS" == "0" ]]; then
      VERDICT="NON CONCLUSIVO"
      EXIT_CODE="3"
      CLASSIFICATION_REASON="receiver/recovery was observed but post-reboot observation polling was disabled"
      add_warning "receiver/recovery evidence was observed, but polling was disabled; not enough evidence for FAIL REALE"
      return
    fi

    if [[ "$POST_REBOOT_OBSERVATION_COMPLETED" != "1" ]]; then
      VERDICT="NON CONCLUSIVO"
      EXIT_CODE="3"
      CLASSIFICATION_REASON="receiver/recovery was observed, but the post-reboot observation window did not complete"
      add_warning "receiver/recovery evidence was observed, but the post-reboot observation window did not complete; not enough evidence for FAIL REALE"
      return
    fi

    if [[ "$POST_REBOOT_DUMPSYS_ANY_SUCCESS" != "1" ]]; then
      VERDICT="FAIL INFRASTRUTTURALE"
      EXIT_CODE="3"
      CLASSIFICATION_REASON="post-reboot dumpsys alarm never succeeded; cannot classify missing rearm as runtime failure"
      add_error "post-reboot dumpsys alarm never succeeded; cannot classify missing rearm as runtime failure"
      return
    fi

    VERDICT="FAIL REALE"
    EXIT_CODE="1"
    CLASSIFICATION_REASON="target package receiver/recovery observed, but no alarm rearm appeared after the completed post-reboot observation window"
    add_error "target package receiver/recovery evidence was observed, but no post-reboot alarm evidence was found after observation"
    return
  fi

  VERDICT="NON CONCLUSIVO"
  EXIT_CODE="3"
  if [[ "$SCHEDULE_OK" == "1" && "$PRE_ALARM_PRESENT" == "1" && "$POST_ALARM_PRESENT" != "1" && "$RECEIVER_LOG_OBSERVED" != "1" ]]; then
    if [[ "$GENERIC_NOTIFYKIT_LOG_OBSERVED" == "1" && "$TARGET_REBOOT_RECEIVER_LOG_OBSERVED" != "1" && "$TARGET_RECOVERY_LOG_OBSERVED" != "1" ]]; then
      CLASSIFICATION_REASON="NotifyKit logs observed, but they belong to another package or are not tied to target package $PACKAGE_NAME"
      add_warning "NotifyKit logs were observed, but no receiver/recovery evidence was tied to target package $PACKAGE_NAME"
    elif [[ "$GENERIC_BOOT_LOG_OBSERVED" == "1" && "$POST_REBOOT_DUMPSYS_ATTEMPTS" != "0" && "$POST_REBOOT_DUMPSYS_ANY_SUCCESS" != "1" ]]; then
      CLASSIFICATION_REASON="generic boot logs observed, but no target package receiver or recovery evidence and post-reboot dumpsys alarm never succeeded"
      add_warning "generic boot logs were observed, but no target package receiver or recovery evidence was found and post-reboot dumpsys alarm never succeeded"
    elif [[ "$GENERIC_BOOT_LOG_OBSERVED" == "1" ]]; then
      CLASSIFICATION_REASON="generic boot logs observed, but no target package receiver or recovery evidence"
      add_warning "generic boot logs were observed, but no target package receiver or recovery evidence was found"
    elif [[ "$POST_REBOOT_DUMPSYS_ATTEMPTS" != "0" && "$POST_REBOOT_DUMPSYS_ANY_SUCCESS" != "1" ]]; then
      CLASSIFICATION_REASON="post-reboot dumpsys alarm never succeeded; cannot classify missing rearm as runtime failure"
      add_warning "post-reboot dumpsys alarm never succeeded; cannot classify missing rearm as runtime failure"
    else
      CLASSIFICATION_REASON="alarm was not observed post-reboot and receiver/recovery was not observed"
      add_warning "alarm was not observed post-reboot, and receiver/recovery was not observed; cannot distinguish receiver delivery, post-unlock timing, OEM/tooling behavior, or runtime bug"
    fi
  else
    CLASSIFICATION_REASON="not enough evidence to distinguish runtime failure from OEM/tooling behavior"
    add_warning "not enough evidence to distinguish runtime failure from OEM/tooling behavior"
  fi
}

main() {
  parse_args "$@"
  validate_args
  ensure_output_dir

  log "output directory: $OUTPUT_DIR"
  note_skip_build
  ensure_tools
  resolve_device
  collect_device_info
  check_package_installed
  collect_permissions
  maybe_clear_logcat || true

  schedule_triggers || true
  dump_harness "pre-reboot" || true
  capture_logcat "pre-reboot" "$PRE_LOGCAT_FILE" || true
  capture_dumpsys_alarm "pre-reboot" "$PRE_ALARM_FILE" "$PRE_ALARM_FILTERED_FILE" || true
  refresh_marker_file
  analyze_pre_reboot_evidence

  if [[ "$DO_REBOOT" != "1" ]]; then
    if [[ "$CANCEL_HARNESS_TRIGGERS" == "1" ]]; then
      cancel_harness_triggers "no-reboot" || true
      capture_logcat "after-cancel" "$OUTPUT_DIR/logcat-after-cancel.txt" || true
      refresh_marker_file
    fi
    classify_no_reboot
    finish
  fi

  if [[ "$INFRA_FAILURE" == "1" || "$SCHEDULE_OK" != "1" ]]; then
    VERDICT="FAIL INFRASTRUTTURALE"
    EXIT_CODE="3"
    CLASSIFICATION_REASON="reboot skipped because pre-reboot scheduling was not confirmed"
    add_error "reboot skipped because pre-reboot scheduling was not confirmed"
    finish
  fi

  reboot_device
  wait_for_boot_completed
  capture_logcat "post-reboot" "$POST_LOGCAT_FILE" || true
  capture_post_reboot_dumpsys_alarm "post-reboot" "$POST_ALARM_FILE" "$POST_ALARM_FILTERED_FILE" || true
  update_post_reboot_log_flags "$POST_LOGCAT_FILE"
  note_exact_alarm_fallback_if_present "$POST_LOGCAT_FILE"
  observe_post_reboot_window

  if [[ "$TEST_COLD_START_RECOVERY" == "1" ]]; then
    dump_harness "cold-start" || true
    capture_logcat "cold-start" "$COLD_LOGCAT_FILE" || true
    capture_dumpsys_alarm "post-cold-start" "$POST_COLD_ALARM_FILE" "$POST_COLD_ALARM_FILTERED_FILE" || true
  fi

  refresh_marker_file
  analyze_post_reboot_evidence
  wait_until_fire_time_if_reasonable

  if [[ "$CANCEL_HARNESS_TRIGGERS" == "1" ]]; then
    cancel_harness_triggers "post-reboot" || true
    capture_logcat "after-cancel" "$OUTPUT_DIR/logcat-after-cancel.txt" || true
  fi

  refresh_marker_file
  classify_reboot
  finish
}

main "$@"
