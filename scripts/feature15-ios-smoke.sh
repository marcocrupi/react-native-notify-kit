#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

IOS_TARGET="${IOS_TARGET:-simulator}"
BUNDLE_ID="${BUNDLE_ID:-org.reactjs.native.example.NotifeeExample}"
SIMULATOR_ID="${SIMULATOR_ID:-booted}"
DEVICE_ID="${DEVICE_ID:-}"
XCRUN="${XCRUN:-xcrun}"

usage() {
  cat <<EOF
Feature #15 iOS smoke harness

Usage:
  scripts/feature15-ios-smoke.sh help
  scripts/feature15-ios-smoke.sh list-devices
  scripts/feature15-ios-smoke.sh build
  scripts/feature15-ios-smoke.sh start
  scripts/feature15-ios-smoke.sh open <scenario>
  scripts/feature15-ios-smoke.sh dump-triggers
  scripts/feature15-ios-smoke.sh cancel-feature
  scripts/feature15-ios-smoke.sh logs

Scenarios:
  one-shot
  daily-2
  weekly-2
  monthly-3
  invalid-repeat-interval

Environment:
  IOS_TARGET=$IOS_TARGET          # simulator|device
  BUNDLE_ID=$BUNDLE_ID
  SIMULATOR_ID=$SIMULATOR_ID      # simulator UDID or booted
  DEVICE_ID=${DEVICE_ID:-<unset>} # required when IOS_TARGET=device

Notes:
  Grant notification permission manually on the iPhone/simulator before running notification delivery tests.
  invalid-monthly-workmanager is unsupported-ios because it is Android-only.
EOF
}

fail() {
  echo "$1" >&2
  exit 1
}

require_xcrun() {
  command -v "$XCRUN" >/dev/null 2>&1 || fail "xcrun was not found. Install Xcode command line tools or set XCRUN."
}

validate_target() {
  case "$IOS_TARGET" in
    simulator | device)
      ;;
    *)
      fail "Unsupported IOS_TARGET: $IOS_TARGET. Use IOS_TARGET=simulator or IOS_TARGET=device."
      ;;
  esac
}

validate_scenario() {
  local scenario="${1:-}"
  if [[ -z "$scenario" ]]; then
    echo "Missing scenario." >&2
    usage >&2
    exit 1
  fi

  case "$scenario" in
    one-shot | daily-2 | weekly-2 | monthly-3 | invalid-repeat-interval | dump-triggers | cancel-feature)
      ;;
    invalid-monthly-workmanager)
      fail "Scenario invalid-monthly-workmanager is unsupported-ios because it is Android-only."
      ;;
    *)
      fail "Unsupported iOS Feature #15 scenario: $scenario"
      ;;
  esac
}

feature15_url() {
  local scenario="$1"
  printf 'notifykit://feature15/run/%s' "$scenario"
}

ensure_device_id() {
  if [[ -z "$DEVICE_ID" ]]; then
    cat >&2 <<EOF
DEVICE_ID is required when IOS_TARGET=device.

Find a device identifier with:
  scripts/feature15-ios-smoke.sh list-devices

Then run, for example:
  IOS_TARGET=device DEVICE_ID=<udid> scripts/feature15-ios-smoke.sh open daily-2
EOF
    exit 1
  fi
}

ensure_devicectl_payload_url() {
  if ! "$XCRUN" devicectl --help >/dev/null 2>&1; then
    fail "xcrun devicectl is unavailable in this Xcode installation."
  fi

  if ! "$XCRUN" devicectl device process launch --help 2>&1 | grep -q -- '--payload-url'; then
    fail "xcrun devicectl device process launch does not support --payload-url in this Xcode installation."
  fi
}

list_devices() {
  require_xcrun

  echo "iOS simulators:"
  "$XCRUN" simctl list devices available || true

  echo
  echo "Physical iOS devices:"
  if "$XCRUN" devicectl --help >/dev/null 2>&1; then
    "$XCRUN" devicectl list devices || true
  else
    echo "devicectl is unavailable in this Xcode installation."
  fi
}

build_app() {
  echo "Building/running the smoke app with yarn smoke:ios."
  echo "This script does not force signing settings; configure signing in Xcode if a physical-device build requires it."
  echo
  (cd "$REPO_ROOT" && yarn smoke:ios)
}

start_app() {
  require_xcrun
  validate_target

  case "$IOS_TARGET" in
    simulator)
      "$XCRUN" simctl launch "$SIMULATOR_ID" "$BUNDLE_ID"
      ;;
    device)
      ensure_device_id
      if ! "$XCRUN" devicectl --help >/dev/null 2>&1; then
        fail "xcrun devicectl is unavailable in this Xcode installation."
      fi
      "$XCRUN" devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID"
      ;;
  esac
}

open_feature15_url() {
  local scenario="$1"
  validate_scenario "$scenario"

  require_xcrun
  validate_target

  local url
  url="$(feature15_url "$scenario")"

  echo "Opening deep link: $url"
  case "$IOS_TARGET" in
    simulator)
      "$XCRUN" simctl openurl "$SIMULATOR_ID" "$url"
      ;;
    device)
      ensure_device_id
      ensure_devicectl_payload_url
      "$XCRUN" devicectl device process launch \
        --device "$DEVICE_ID" \
        --payload-url "$url" \
        "$BUNDLE_ID"
      ;;
  esac

  echo
  echo "Grant notification permission manually on the iPhone/simulator before running notification delivery tests."
  echo "Use 'scripts/feature15-ios-smoke.sh logs' and filter for F15: lines where supported."
}

logs() {
  require_xcrun
  validate_target

  case "$IOS_TARGET" in
    simulator)
      echo "Streaming simulator logs that contain F15:. Press Ctrl-C to stop."
      "$XCRUN" simctl spawn "$SIMULATOR_ID" log stream --style compact --predicate 'eventMessage CONTAINS "F15:"'
      ;;
    device)
      cat <<EOF
Automated physical-device log streaming is not wired into this harness.

Use one of these and filter for F15:
  - Xcode console
  - Console.app
  - npx react-native log-ios, if it works with the selected device in your environment
EOF
      ;;
  esac
}

main() {
  local command="${1:-}"

  case "$command" in
    "" | -h | --help | help)
      usage
      ;;
    list-devices)
      list_devices
      ;;
    build)
      build_app
      ;;
    start)
      start_app
      ;;
    open)
      open_feature15_url "${2:-}"
      ;;
    dump-triggers)
      open_feature15_url "dump-triggers"
      ;;
    cancel-feature)
      open_feature15_url "cancel-feature"
      ;;
    logs)
      logs
      ;;
    *)
      echo "Unknown command: $command" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
