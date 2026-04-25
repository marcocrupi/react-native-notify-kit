#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="${PACKAGE_NAME:-com.notifeeexample}"
ADB="${ADB:-adb}"
RUN_KILLED_SETTLE_SECONDS="${RUN_KILLED_SETTLE_SECONDS:-5}"

ADB_ARGS=()

usage() {
  cat <<EOF
Feature #15 Android smoke harness

Usage:
  scripts/feature15-android-smoke.sh device
  scripts/feature15-android-smoke.sh build
  scripts/feature15-android-smoke.sh start
  scripts/feature15-android-smoke.sh clear-logcat
  scripts/feature15-android-smoke.sh logcat
  scripts/feature15-android-smoke.sh run <scenario>
  scripts/feature15-android-smoke.sh run-killed <scenario>
  scripts/feature15-android-smoke.sh dump-triggers
  scripts/feature15-android-smoke.sh cancel-feature
  scripts/feature15-android-smoke.sh check-crash
  scripts/feature15-android-smoke.sh db-dump

Scenarios:
  one-shot
  daily-2
  weekly-2
  monthly-3
  invalid-monthly-workmanager
  invalid-repeat-interval
  dump-triggers
  cancel-feature

Environment:
  PACKAGE_NAME=$PACKAGE_NAME
  ANDROID_SERIAL=<device serial>   # required if more than one device is connected
EOF
}

resolve_device() {
  if [[ -n "${ANDROID_SERIAL:-}" ]]; then
    ADB_ARGS=(-s "$ANDROID_SERIAL")
    return
  fi

  local devices
  devices="$("$ADB" devices | awk 'NR > 1 && $2 == "device" { print $1 }')"

  local count
  count="$(printf '%s\n' "$devices" | sed '/^$/d' | wc -l | tr -d ' ')"

  if [[ "$count" == "0" ]]; then
    echo "No Android device is connected. Connect a device or set ANDROID_SERIAL." >&2
    "$ADB" devices >&2
    exit 1
  fi

  if [[ "$count" != "1" ]]; then
    echo "Multiple Android devices are connected. Set ANDROID_SERIAL." >&2
    "$ADB" devices >&2
    exit 1
  fi

  ADB_ARGS=(-s "$(printf '%s\n' "$devices" | sed '/^$/d' | head -n 1)")
}

adb_device() {
  "$ADB" "${ADB_ARGS[@]}" "$@"
}

ensure_package_installed() {
  if ! adb_device shell pm path "$PACKAGE_NAME" >/dev/null 2>&1; then
    echo "Package $PACKAGE_NAME is not installed on the selected device." >&2
    echo "Run: yarn smoke:start" >&2
    echo "Then in another terminal: scripts/feature15-android-smoke.sh build" >&2
    exit 1
  fi
}

validate_scenario() {
  local scenario="${1:-}"
  if [[ -z "$scenario" ]]; then
    echo "Missing scenario." >&2
    usage >&2
    exit 1
  fi

  if [[ ! "$scenario" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "Invalid scenario name: $scenario" >&2
    exit 1
  fi
}

device_info() {
  "$ADB" devices
  resolve_device
  echo "model: $(adb_device shell getprop ro.product.model | tr -d '\r')"
  echo "android_release: $(adb_device shell getprop ro.build.version.release | tr -d '\r')"
  echo "android_sdk: $(adb_device shell getprop ro.build.version.sdk | tr -d '\r')"
}

build_app() {
  echo "Building react-native-notify-kit package before the smoke app..."
  yarn build:rn
  echo
  echo "Metro is not started by this script. If needed, run in another terminal:"
  echo "  yarn smoke:start"
  echo
  yarn smoke:android
}

start_app() {
  resolve_device
  ensure_package_installed
  adb_device shell monkey -p "$PACKAGE_NAME" 1
  echo "Started $PACKAGE_NAME."
}

run_deeplink() {
  local scenario="$1"
  validate_scenario "$scenario"
  resolve_device
  ensure_package_installed

  local uri="notifykit://feature15/run/$scenario"
  echo "Starting deep link: $uri"
  adb_device shell am start -W \
    -a android.intent.action.VIEW \
    -d "$uri" \
    "$PACKAGE_NAME"
  echo
  echo "If the notification permission dialog appears, grant it manually on the device."
  echo "Use 'scripts/feature15-android-smoke.sh logcat' and grep for F15: lines."
}

run_killed() {
  local scenario="$1"
  validate_scenario "$scenario"
  resolve_device
  ensure_package_installed

  echo "Killing any cached process with am kill, without force-stop."
  adb_device shell am kill "$PACKAGE_NAME" || true
  run_deeplink "$scenario"

  echo "Waiting ${RUN_KILLED_SETTLE_SECONDS}s before backgrounding and killing process."
  sleep "$RUN_KILLED_SETTLE_SECONDS"
  adb_device shell input keyevent KEYCODE_HOME || true
  adb_device shell am kill "$PACKAGE_NAME" || true

  echo
  echo "Scenario $scenario has been scheduled, then the app was sent home and killed with am kill."
  echo "Wait for the notification on the device; tap handling is intentionally manual."
}

logcat() {
  resolve_device
  adb_device logcat -s ReactNativeJS NOTIFEE Notifee NotifeeCore AndroidRuntime ActivityManager
}

clear_logcat() {
  resolve_device
  adb_device logcat -c
  echo "logcat cleared."
}

check_crash() {
  resolve_device

  local tmp
  tmp="$(mktemp)"

  adb_device logcat -d -t 2000 >"$tmp"

  if grep -E 'FATAL EXCEPTION|AndroidRuntime|ANR' "$tmp"; then
    rm -f "$tmp"
    echo "Crash or ANR signature found in recent logcat." >&2
    exit 1
  fi

  rm -f "$tmp"
  echo "No FATAL EXCEPTION, AndroidRuntime, or ANR signature found in recent logcat."
}

db_dump() {
  resolve_device
  ensure_package_installed

  if ! adb_device shell 'command -v sqlite3 >/dev/null 2>&1'; then
    echo "sqlite3 is not available on this device; use dump-triggers for primary verification."
    return
  fi

  local db_path
  db_path="$(adb_device shell run-as "$PACKAGE_NAME" sh -c 'find databases -type f -name "*.db" | head -n 1' | tr -d '\r')"

  if [[ -z "$db_path" ]]; then
    echo "No app database file found via run-as; use dump-triggers for primary verification."
    return
  fi

  echo "Database: $db_path"
  adb_device shell run-as "$PACKAGE_NAME" sqlite3 "$db_path" \
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
  echo
  echo "Trigger rows, if the trigger table exists:"
  adb_device shell run-as "$PACKAGE_NAME" sqlite3 "$db_path" \
    "SELECT id, notification_id, with_alarm_manager FROM trigger;" || true
}

main() {
  local command="${1:-}"

  case "$command" in
    device)
      device_info
      ;;
    build)
      build_app
      ;;
    start)
      start_app
      ;;
    clear-logcat)
      clear_logcat
      ;;
    logcat)
      logcat
      ;;
    run)
      run_deeplink "${2:-}"
      ;;
    run-killed)
      run_killed "${2:-}"
      ;;
    dump-triggers)
      run_deeplink "dump-triggers"
      ;;
    cancel-feature)
      run_deeplink "cancel-feature"
      ;;
    check-crash)
      check_crash
      ;;
    db-dump)
      db_dump
      ;;
    "" | -h | --help | help)
      usage
      ;;
    *)
      echo "Unknown command: $command" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
