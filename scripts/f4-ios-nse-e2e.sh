#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IOS_DIR="$REPO_ROOT/apps/smoke/ios"
IOS_WORKSPACE="$IOS_DIR/NotifeeExample.xcworkspace"
IOS_SCHEME="${IOS_SCHEME:-NotifeeExample}"
EXPECTED_NSE_TARGET="NotifyKitNSE"
NSE_TARGET="${NSE_TARGET:-$EXPECTED_NSE_TARGET}"
NSE_DIR="$IOS_DIR/$NSE_TARGET"
EXPECTED_NSE_DIR="$IOS_DIR/$EXPECTED_NSE_TARGET"
PROJECT_FILE="$IOS_DIR/NotifeeExample.xcodeproj/project.pbxproj"
PODS_PROJECT_FILE="$IOS_DIR/Pods/Pods.xcodeproj/project.pbxproj"
PODFILE="$IOS_DIR/Podfile"
FIREBASE_PLIST="$IOS_DIR/GoogleService-Info.plist"
FIREBASE_SERVICE_ACCOUNT="$REPO_ROOT/firebase-notifykittest.json"
DEFAULT_BUNDLE_ID="org.reactjs.native.example.NotifeeExample.feature15"
BUNDLE_ID="${BUNDLE_ID:-$DEFAULT_BUNDLE_ID}"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_DIR="${F4_LOG_DIR:-/tmp/notifykit-f4-ios-nse-$TIMESTAMP}"
REPORT_PATH="$LOG_DIR/report.md"
NON_INTERACTIVE=0
CLEANUP_ON_ERROR=0
ALWAYS_CLEANUP_ON_EXIT=0
TRAP_CLEANUP_RUNNING=0
FINAL_STATUS="PASS"
DEVICE_SUMMARY="${IOS_DEVICE_ID:-}"
DEVICE_ID="${IOS_DEVICE_ID:-}"
XCODE_VERSION=""
COCOAPODS_VERSION=""
BRANCH=""
INITIAL_GIT_STATUS=""
ENV_INITIALIZED=0
LAST_BUILD_CLASSIFICATION=""
LAST_BUILD_NOTE=""
POD_INSTALL_NOTE=""

FORBIDDEN_RNFB_INPUT_PATH='$(BUILT_PRODUCTS_DIR)/$(INFOPLIST_PATH)'

STEP_NAMES=(
  "clean repo"
  "device connected"
  "prerequisites"
  "build server SDK"
  "build CLI"
  "init-nse"
  "pod install"
  "RNFB cycle check"
  "xcodebuild generic"
  "xcodebuild device"
  "open Xcode"
  "FCM foreground"
  "FCM background/NSE"
  "FCM killed/NSE"
  "FCM attachment/NSE"
  "cleanup"
)
STEP_STATUSES=("" "" "" "" "" "" "" "" "" "" "" "" "" "" "" "")
STEP_NOTES=("" "" "" "" "" "" "" "" "" "" "" "" "" "" "" "")

usage() {
  cat <<EOF
F4 iOS/NSE E2E automation harness

Usage:
  scripts/f4-ios-nse-e2e.sh prepare [--non-interactive]
  scripts/f4-ios-nse-e2e.sh build-generic [--non-interactive]
  scripts/f4-ios-nse-e2e.sh build-device [--non-interactive]
  scripts/f4-ios-nse-e2e.sh send [--non-interactive]
  scripts/f4-ios-nse-e2e.sh cleanup
  scripts/f4-ios-nse-e2e.sh all [--non-interactive]
  scripts/f4-ios-nse-e2e.sh help

Environment:
  IOS_DEVICE_ID       Physical iOS device identifier. If unset, the first connected device is used.
  DEVELOPMENT_TEAM   Apple Developer Team ID for physical device signing.
  IOS_FCM_TOKEN      iOS FCM registration token. Required by send.
  BUNDLE_ID          App bundle identifier for launch hints. Default: $DEFAULT_BUNDLE_ID
  F4_LOG_DIR         Optional log directory. Default: /tmp/notifykit-f4-ios-nse-<timestamp>

Notes:
  - prepare intentionally creates temporary iOS/NSE changes under apps/smoke/ios.
  - cleanup reverts apps/smoke/ios and removes apps/smoke/ios/$EXPECTED_NSE_TARGET.
  - send cannot prove foreground/background/killed/attachment delivery without human confirmation.
EOF
}

log() {
  printf '[f4-ios-nse] %s\n' "$*"
}

warn() {
  printf '[f4-ios-nse] WARNING: %s\n' "$*" >&2
}

fail() {
  printf '[f4-ios-nse] ERROR: %s\n' "$*" >&2
  FINAL_STATUS="FAIL"
  if [[ "$CLEANUP_ON_ERROR" -eq 1 && "$TRAP_CLEANUP_RUNNING" -eq 0 ]]; then
    TRAP_CLEANUP_RUNNING=1
    set +e
    cleanup
    local cleanup_status=$?
    set -e
    TRAP_CLEANUP_RUNNING=0
    if [[ "$cleanup_status" -ne 0 ]]; then
      warn "Automatic cleanup failed. Run scripts/f4-ios-nse-e2e.sh cleanup"
    fi
  fi
  write_report || true
  exit 1
}

ensure_log_dir() {
  mkdir -p "$LOG_DIR"
}

mask_token() {
  local token="${1:-}"
  local len="${#token}"
  local tail

  if [[ "$len" -eq 0 ]]; then
    printf '<unset>'
  elif [[ "$len" -le 12 ]]; then
    printf '%s' '***'
  else
    tail="${token:$((len - 4)):4}"
    printf '%s...%s' "${token:0:6}" "$tail"
  fi
}

validate_nse_target() {
  if [[ -z "${NSE_TARGET:-}" ]]; then
    printf '[f4-ios-nse] ERROR: NSE_TARGET must be "%s"; got an empty value.\n' "$EXPECTED_NSE_TARGET" >&2
    return 1
  fi

  if [[ "$NSE_TARGET" != "$EXPECTED_NSE_TARGET" ]]; then
    printf '[f4-ios-nse] ERROR: NSE_TARGET must be "%s" for this F4 script; got "%s".\n' "$EXPECTED_NSE_TARGET" "$NSE_TARGET" >&2
    printf '[f4-ios-nse] ERROR: cleanup is limited to apps/smoke/ios/%s.\n' "$EXPECTED_NSE_TARGET" >&2
    return 1
  fi
}

safe_remove_nse_dir() {
  validate_nse_target || return 1

  local expected_repo_path="$REPO_ROOT/apps/smoke/ios/$EXPECTED_NSE_TARGET"
  if [[ "$EXPECTED_NSE_DIR" != "$expected_repo_path" || "$NSE_DIR" != "$EXPECTED_NSE_DIR" ]]; then
    printf '[f4-ios-nse] ERROR: Refusing to remove unexpected NSE path: %s\n' "$NSE_DIR" >&2
    return 1
  fi

  local ios_real
  ios_real="$(cd "$IOS_DIR" && pwd -P)" || return 1
  local expected_real="$ios_real/$EXPECTED_NSE_TARGET"

  if [[ -z "$expected_real" || "$expected_real" == "/" || "$expected_real" == "$ios_real" ]]; then
    printf '[f4-ios-nse] ERROR: Refusing unsafe NSE removal path: %s\n' "$expected_real" >&2
    return 1
  fi

  case "$expected_real" in
    "$ios_real/$EXPECTED_NSE_TARGET")
      ;;
    *)
      printf '[f4-ios-nse] ERROR: Refusing NSE removal outside apps/smoke/ios: %s\n' "$expected_real" >&2
      return 1
      ;;
  esac

  rm -rf "$EXPECTED_NSE_DIR"
}

redact_token_from_stream() {
  local token="${1:-}"
  local replacement="${2:-<redacted-token>}"
  local line

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ -n "$token" ]]; then
      line="${line//"$token"/"$replacement"}"
    fi
    printf '%s\n' "$line"
  done
}

sanitize_cell() {
  local value="${1:-}"
  value="${value//$'\n'/ }"
  value="${value//$'\r'/ }"
  value="${value//|/\\|}"
  printf '%s' "$value"
}

set_final_from_status() {
  local status="$1"

  case "$status" in
    FAIL)
      FINAL_STATUS="FAIL"
      ;;
    BLOCCATO*)
      if [[ "$FINAL_STATUS" != "FAIL" ]]; then
        FINAL_STATUS="BLOCCATO"
      fi
      ;;
    SKIP | "NON ESEGUITO" | "MANUAL" | "PASS CON NOTE")
      if [[ "$FINAL_STATUS" == "PASS" ]]; then
        FINAL_STATUS="PASS CON NOTE"
      fi
      ;;
  esac
}

record_step() {
  local step="$1"
  local status="$2"
  local notes="${3:-}"
  local i

  for i in "${!STEP_NAMES[@]}"; do
    if [[ "${STEP_NAMES[$i]}" == "$step" ]]; then
      STEP_STATUSES[$i]="$status"
      STEP_NOTES[$i]="$notes"
      set_final_from_status "$status"
      write_report || true
      return 0
    fi
  done

  STEP_NAMES+=("$step")
  STEP_STATUSES+=("$status")
  STEP_NOTES+=("$notes")
  set_final_from_status "$status"
  write_report || true
}

refresh_environment() {
  if [[ "$ENV_INITIALIZED" -eq 0 ]]; then
    BRANCH="$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || true)"
    INITIAL_GIT_STATUS="$(git -C "$REPO_ROOT" status --short --branch 2>/dev/null || true)"
    ENV_INITIALIZED=1
  fi
  XCODE_VERSION="$(xcodebuild -version 2>/dev/null | tr '\n' ' ' | sed 's/[[:space:]]*$//' || true)"
  COCOAPODS_VERSION="$(cocoapods_version 2>/dev/null || true)"
}

write_report() {
  ensure_log_dir
  refresh_environment

  {
    printf '# F4 iOS/NSE automated run report\n\n'
    printf '## Environment\n'
    printf -- '- branch: %s\n' "$(sanitize_cell "$BRANCH")"
    printf -- '- git status initial: %s\n' "$(sanitize_cell "$INITIAL_GIT_STATUS")"
    printf -- '- device: %s\n' "$(sanitize_cell "${DEVICE_SUMMARY:-<not detected>}")"
    printf -- '- Xcode: %s\n' "$(sanitize_cell "${XCODE_VERSION:-<not checked>}")"
    printf -- '- CocoaPods: %s\n' "$(sanitize_cell "${COCOAPODS_VERSION:-<not checked>}")"
    printf -- '- log dir: %s\n\n' "$LOG_DIR"

    printf '## Steps\n'
    printf '| Step | Status | Notes |\n'
    printf '|------|--------|-------|\n'
    local i
    for i in "${!STEP_NAMES[@]}"; do
      printf '| %s | %s | %s |\n' \
        "$(sanitize_cell "${STEP_NAMES[$i]}")" \
        "$(sanitize_cell "${STEP_STATUSES[$i]}")" \
        "$(sanitize_cell "${STEP_NOTES[$i]}")"
    done

    printf '\n## Logs\n'
    printf -- '- paths: %s\n\n' "$LOG_DIR"
    if compgen -G "$LOG_DIR/*.log" >/dev/null 2>&1; then
      local log_file
      for log_file in "$LOG_DIR"/*.log; do
        printf -- '- %s\n' "$log_file"
      done
      printf '\n'
    fi

    printf '## Final status\n'
    printf '%s\n' "$FINAL_STATUS"
  } > "$REPORT_PATH"
}

allowed_dirty_filter() {
  grep -vE '^.. scripts/f4-ios-nse-e2e\.sh$' || true
}

unexpected_git_status() {
  git -C "$REPO_ROOT" status --porcelain | allowed_dirty_filter
}

require_clean_repo() {
  local status_file="$LOG_DIR/git-status-initial.log"
  ensure_log_dir

  git -C "$REPO_ROOT" branch --show-current > "$LOG_DIR/git-branch.log"
  git -C "$REPO_ROOT" status --short --branch | tee "$status_file"

  local unexpected
  unexpected="$(unexpected_git_status)"
  if [[ -n "$unexpected" ]]; then
    record_step "clean repo" "FAIL" "Working tree has unexpected changes; see $status_file"
    cat >&2 <<EOF
Working tree is not clean. Stop before modifying files.

Branch:
$(cat "$LOG_DIR/git-branch.log")

Git status:
$(cat "$status_file")

Unexpected modified files:
$unexpected
EOF
    exit 1
  fi

  if git -C "$REPO_ROOT" status --porcelain | grep -Eq '^.. scripts/f4-ios-nse-e2e\.sh$'; then
    record_step "clean repo" "PASS CON NOTE" "Only this automation script is dirty; allowed for local script validation."
  else
    record_step "clean repo" "PASS" "Working tree clean."
  fi
}

require_command() {
  local command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || fail "Missing prerequisite: $command_name"
}

has_smoke_bundle_pod() {
  [[ -f "$REPO_ROOT/apps/smoke/Gemfile" ]] || return 1
  command -v bundle >/dev/null 2>&1 || return 1
  (cd "$REPO_ROOT/apps/smoke" && bundle exec pod --version >/dev/null 2>&1)
}

cocoapods_version() {
  if has_smoke_bundle_pod; then
    printf 'bundle exec pod %s' "$(cd "$REPO_ROOT/apps/smoke" && bundle exec pod --version)"
  else
    pod --version
  fi
}

check_prerequisites() {
  local prereq_log="$LOG_DIR/prerequisites.log"
  ensure_log_dir
  : > "$prereq_log"

  require_command xcodebuild
  require_command xcrun
  require_command pod
  require_command yarn
  require_command rg
  if [[ -f "$REPO_ROOT/apps/smoke/Gemfile" ]]; then
    require_command bundle
  fi

  {
    printf 'xcodebuild:\n'
    xcodebuild -version
    printf '\nCocoaPods:\n'
    cocoapods_version
    printf '\nNode:\n'
    node --version
    printf '\nYarn:\n'
    yarn --version
  } >> "$prereq_log" 2>&1

  [[ -f "$FIREBASE_PLIST" ]] || fail "Missing $FIREBASE_PLIST. Do not print its contents; add the Firebase plist before prepare."
  [[ -f "$FIREBASE_SERVICE_ACCOUNT" ]] || fail "Missing $FIREBASE_SERVICE_ACCOUNT. Do not print its contents; add the Firebase service account before send/build validation."

  record_step "prerequisites" "PASS" "Xcode, CocoaPods, yarn, rg, Firebase files present. See $prereq_log"
}

detect_device() {
  local devices_log="$LOG_DIR/devicectl-devices.log"
  ensure_log_dir

  xcrun devicectl list devices > "$devices_log" 2>&1 || {
    record_step "device connected" "FAIL" "xcrun devicectl list devices failed. See $devices_log"
    fail "Could not list iOS devices with xcrun devicectl. See $devices_log"
  }

  if [[ -n "${IOS_DEVICE_ID:-}" ]]; then
    if grep -F "$IOS_DEVICE_ID" "$devices_log" | grep -qi 'connected'; then
      DEVICE_ID="$IOS_DEVICE_ID"
      DEVICE_SUMMARY="$(grep -F "$IOS_DEVICE_ID" "$devices_log" | head -n 1 | sed 's/^[[:space:]]*//')"
      record_step "device connected" "PASS" "$DEVICE_SUMMARY"
      return 0
    fi

    record_step "device connected" "FAIL" "IOS_DEVICE_ID=$IOS_DEVICE_ID not found as connected. See $devices_log"
    fail "IOS_DEVICE_ID=$IOS_DEVICE_ID was not found as connected. See $devices_log"
  fi

  local connected_line
  connected_line="$(grep -i 'connected' "$devices_log" | grep -Eiv 'simulator|watch|tv' | head -n 1 || true)"
  if [[ -z "$connected_line" ]]; then
    record_step "device connected" "FAIL" "No connected physical iOS device found. See $devices_log"
    fail "No connected physical iOS device found. Set IOS_DEVICE_ID after checking $devices_log"
  fi

  DEVICE_ID="$(printf '%s\n' "$connected_line" | tr ' ' '\n' | grep -E '^[0-9A-Fa-f-]{20,}$' | head -n 1 || true)"
  if [[ -z "$DEVICE_ID" ]]; then
    record_step "device connected" "FAIL" "Connected device found but identifier could not be parsed. Set IOS_DEVICE_ID. See $devices_log"
    fail "Connected iOS device found, but no device identifier could be parsed. Set IOS_DEVICE_ID explicitly. See $devices_log"
  fi

  DEVICE_SUMMARY="$(printf '%s' "$connected_line" | sed 's/^[[:space:]]*//')"
  record_step "device connected" "PASS" "$DEVICE_SUMMARY"
}

run_logged() {
  local name="$1"
  shift
  local logfile="$LOG_DIR/$name.log"
  ensure_log_dir

  log "Running: $name (log: $logfile)"
  if "$@" > "$logfile" 2>&1; then
    return 0
  else
    local status=$?
    warn "$name failed with exit code $status. Last 40 log lines:"
    tail -n 40 "$logfile" >&2 || true
    return "$status"
  fi
}

run_logged_cwd() {
  local name="$1"
  local cwd="$2"
  shift 2
  local logfile="$LOG_DIR/$name.log"
  ensure_log_dir

  log "Running: $name (log: $logfile)"
  if (cd "$cwd" && "$@") > "$logfile" 2>&1; then
    return 0
  else
    local status=$?
    warn "$name failed with exit code $status. Last 40 log lines:"
    tail -n 40 "$logfile" >&2 || true
    return "$status"
  fi
}

build_server_sdk() {
  if run_logged_cwd "build-server-sdk" "$REPO_ROOT" yarn build:rn:server; then
    record_step "build server SDK" "PASS" "yarn build:rn:server"
  else
    record_step "build server SDK" "FAIL" "See $LOG_DIR/build-server-sdk.log"
    fail "Server SDK build failed."
  fi
}

build_cli() {
  if run_logged_cwd "build-cli" "$REPO_ROOT/packages/cli" yarn build; then
    if [[ ! -f "$REPO_ROOT/packages/cli/dist/cli.js" ]]; then
      record_step "build CLI" "FAIL" "packages/cli/dist/cli.js was not produced."
      fail "CLI build did not produce packages/cli/dist/cli.js"
    fi
    record_step "build CLI" "PASS" "cd packages/cli && yarn build"
  else
    record_step "build CLI" "FAIL" "See $LOG_DIR/build-cli.log"
    fail "CLI build failed."
  fi
}

init_nse() {
  if [[ ! -f "$REPO_ROOT/packages/cli/dist/cli.js" ]]; then
    fail "CLI is not built. Run prepare or build_cli first."
  fi

  if run_logged "init-nse" node "$REPO_ROOT/packages/cli/dist/cli.js" init-nse --ios-path "$IOS_DIR" --target-name "$NSE_TARGET" --bundle-suffix ".$NSE_TARGET" --force; then
    [[ -f "$NSE_DIR/NotificationService.swift" ]] || fail "init-nse did not create $NSE_DIR/NotificationService.swift"
    [[ -f "$NSE_DIR/Info.plist" ]] || fail "init-nse did not create $NSE_DIR/Info.plist"
    record_step "init-nse" "PASS" "Temporary $NSE_TARGET target created."
  else
    record_step "init-nse" "FAIL" "See $LOG_DIR/init-nse.log"
    fail "init-nse failed."
  fi
}

pod_install() {
  if has_smoke_bundle_pod; then
    POD_INSTALL_NOTE="BUNDLE_GEMFILE=apps/smoke/Gemfile bundle exec pod install"
    if run_logged_cwd "pod-install" "$IOS_DIR" env BUNDLE_GEMFILE="$REPO_ROOT/apps/smoke/Gemfile" bundle exec pod install; then
      record_step "pod install" "PASS" "$POD_INSTALL_NOTE completed."
    else
      record_step "pod install" "FAIL" "$POD_INSTALL_NOTE failed. See $LOG_DIR/pod-install.log"
      fail "pod install failed."
    fi
  else
    POD_INSTALL_NOTE="pod install"
    if run_logged_cwd "pod-install" "$IOS_DIR" pod install; then
      record_step "pod install" "PASS" "$POD_INSTALL_NOTE completed."
    else
      record_step "pod install" "FAIL" "$POD_INSTALL_NOTE failed. See $LOG_DIR/pod-install.log"
      fail "pod install failed."
    fi
  fi
}

phase_has_forbidden_rnfb_input_path() {
  local file="$1"
  [[ -f "$file" ]] || return 1

  awk -v needle="$FORBIDDEN_RNFB_INPUT_PATH" '
    index($0, "[RNFB] Core Configuration") && index($0, "= {") {
      in_phase = 1
    }
    in_phase && index($0, needle) {
      found = 1
    }
    in_phase && $0 ~ /^[[:space:]]*};/ {
      in_phase = 0
    }
    END {
      exit(found ? 0 : 1)
    }
  ' "$file"
}

verify_rnfb_cycle_fix() {
  local rg_log="$LOG_DIR/rnfb-cycle-rg.log"
  ensure_log_dir

  [[ -f "$PROJECT_FILE" ]] || fail "Missing $PROJECT_FILE"
  [[ -f "$PODS_PROJECT_FILE" ]] || fail "Missing $PODS_PROJECT_FILE. Did pod install complete?"
  [[ -f "$PODFILE" ]] || fail "Missing $PODFILE"

  rg "\\[RNFB\\] Core Configuration|\\[CP-User\\] \\[RNFB\\] Core Configuration|BUILT_PRODUCTS_DIR|INFOPLIST_PATH|$NSE_TARGET|appex" \
    "$PROJECT_FILE" \
    "$PODS_PROJECT_FILE" \
    "$PODFILE" \
    -n > "$rg_log" 2>&1 || true

  local bad_files=()
  if phase_has_forbidden_rnfb_input_path "$PROJECT_FILE"; then
    bad_files+=("$PROJECT_FILE")
  fi
  if phase_has_forbidden_rnfb_input_path "$PODS_PROJECT_FILE"; then
    bad_files+=("$PODS_PROJECT_FILE")
  fi

  if [[ "${#bad_files[@]}" -gt 0 ]]; then
    record_step "RNFB cycle check" "FAIL" "RNFB phase still contains $FORBIDDEN_RNFB_INPUT_PATH in ${bad_files[*]}. See $rg_log"
    fail "RNFB phase still contains $FORBIDDEN_RNFB_INPUT_PATH. See $rg_log"
  fi

  record_step "RNFB cycle check" "PASS" "RNFB build phase no longer declares $FORBIDDEN_RNFB_INPUT_PATH. See $rg_log"
}

classify_build_log() {
  local logfile="$1"
  LAST_BUILD_CLASSIFICATION="FAIL"
  LAST_BUILD_NOTE=""

  if grep -q 'BUILD SUCCEEDED' "$logfile"; then
    LAST_BUILD_CLASSIFICATION="PASS"
    if grep -qi 'sharedApplication' "$logfile"; then
      LAST_BUILD_NOTE="BUILD SUCCEEDED; sharedApplication appeared only outside error lines"
    else
      LAST_BUILD_NOTE="BUILD SUCCEEDED"
    fi
    return 0
  fi

  if grep -qi 'Cycle inside' "$logfile"; then
    LAST_BUILD_CLASSIFICATION="FAIL"
    LAST_BUILD_NOTE="Xcode build cycle detected"
    return 1
  fi

  if grep -Eqi 'error:.*sharedApplication|sharedApplication.*error:|sharedApplication.*(is unavailable|not available).*extension' "$logfile"; then
    LAST_BUILD_CLASSIFICATION="FAIL"
    LAST_BUILD_NOTE="sharedApplication error detected"
    return 1
  fi

  if grep -q 'BUILD FAILED' "$logfile"; then
    if grep -Eqi "requires a development team|No signing certificate|No profiles for|Provisioning profile .*doesn't include|Provisioning profile .*does not include|Code signing is required|Signing for .* requires a development team|requires a provisioning profile" "$logfile"; then
      LAST_BUILD_CLASSIFICATION="BLOCCATO SIGNING"
      LAST_BUILD_NOTE="Signing/provisioning blocked"
      return 2
    fi

    LAST_BUILD_CLASSIFICATION="FAIL"
    LAST_BUILD_NOTE="Build failed"
    return 1
  fi

  LAST_BUILD_CLASSIFICATION="BLOCCATO"
  LAST_BUILD_NOTE="Build result unknown: no BUILD SUCCEEDED or BUILD FAILED marker found"
  return 2
}

require_nse_prepared() {
  [[ -d "$NSE_DIR" ]] || fail "$NSE_DIR is missing. Run scripts/f4-ios-nse-e2e.sh prepare first."
  [[ -d "$IOS_WORKSPACE" ]] || fail "$IOS_WORKSPACE is missing. Run pod install from prepare first."
}

build_generic_ios() {
  require_nse_prepared
  local logfile="$LOG_DIR/xcodebuild-generic.log"
  ensure_log_dir

  log "Running xcodebuild generic/platform=iOS CODE_SIGNING_ALLOWED=NO (log: $logfile)"
  if (
    cd "$IOS_DIR"
    xcodebuild \
      -workspace "$IOS_WORKSPACE" \
      -scheme "$IOS_SCHEME" \
      -configuration Debug \
      -destination "generic/platform=iOS" \
      -derivedDataPath "$LOG_DIR/DerivedData-generic" \
      CODE_SIGNING_ALLOWED=NO \
      build
  ) > "$logfile" 2>&1; then
    if ! classify_build_log "$logfile"; then
      record_step "xcodebuild generic" "$LAST_BUILD_CLASSIFICATION" "$LAST_BUILD_NOTE. See $logfile"
      fail "Generic iOS build log check failed: $LAST_BUILD_NOTE"
    fi
    record_step "xcodebuild generic" "$LAST_BUILD_CLASSIFICATION" "$LAST_BUILD_NOTE. See $logfile"
  else
    local build_status=$?
    classify_build_log "$logfile" || true
    record_step "xcodebuild generic" "$LAST_BUILD_CLASSIFICATION" "$LAST_BUILD_NOTE. xcodebuild exit $build_status. See $logfile"
    fail "Generic iOS build failed: $LAST_BUILD_NOTE"
  fi
}

build_device_ios() {
  require_nse_prepared

  if [[ -z "${DEVICE_ID:-}" ]]; then
    detect_device
  fi

  if [[ -z "${DEVELOPMENT_TEAM:-}" ]]; then
    record_step "xcodebuild device" "BLOCCATO SIGNING" "DEVELOPMENT_TEAM is not set. Export DEVELOPMENT_TEAM=<team-id> or open $IOS_WORKSPACE in Xcode and configure signing."
    cat >&2 <<EOF
Physical device signing requires DEVELOPMENT_TEAM.

Run:
  export DEVELOPMENT_TEAM="<team-id>"
  IOS_DEVICE_ID="$DEVICE_ID" scripts/f4-ios-nse-e2e.sh build-device

Fallback:
  open "$IOS_WORKSPACE"
EOF
    return 2
  fi

  local logfile="$LOG_DIR/xcodebuild-device.log"
  ensure_log_dir

  log "Running xcodebuild for device id=$DEVICE_ID (log: $logfile)"
  if (
    cd "$IOS_DIR"
    xcodebuild \
      -workspace "$IOS_WORKSPACE" \
      -scheme "$IOS_SCHEME" \
      -configuration Debug \
      -destination "id=$DEVICE_ID" \
      -derivedDataPath "$LOG_DIR/DerivedData-device" \
      -allowProvisioningUpdates \
      DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
      build
  ) > "$logfile" 2>&1; then
    local class_status=0
    classify_build_log "$logfile" || class_status=$?
    if [[ "$class_status" -ne 0 ]]; then
      record_step "xcodebuild device" "$LAST_BUILD_CLASSIFICATION" "$LAST_BUILD_NOTE. See $logfile"
      if [[ "$class_status" -eq 2 ]]; then
        return 2
      fi
      fail "Device iOS build log check failed: $LAST_BUILD_NOTE"
    fi
    record_step "xcodebuild device" "$LAST_BUILD_CLASSIFICATION" "$LAST_BUILD_NOTE. See $logfile"
  else
    local build_status=$?
    classify_build_log "$logfile" || true
    record_step "xcodebuild device" "$LAST_BUILD_CLASSIFICATION" "$LAST_BUILD_NOTE. xcodebuild exit $build_status. See $logfile"
    if [[ "$LAST_BUILD_CLASSIFICATION" == "BLOCCATO SIGNING" ]]; then
      return 2
    fi
    fail "Device iOS build failed: $LAST_BUILD_NOTE"
  fi
}

open_xcode() {
  if [[ ! -d "$IOS_WORKSPACE" ]]; then
    record_step "open Xcode" "SKIP" "$IOS_WORKSPACE does not exist."
    return 0
  fi

  open "$IOS_WORKSPACE" >/dev/null 2>&1 || {
    record_step "open Xcode" "BLOCCATO" "Could not open $IOS_WORKSPACE. Open it manually."
    return 2
  }
  record_step "open Xcode" "PASS CON NOTE" "Opened $IOS_WORKSPACE for manual signing/run if needed."
}

prompt_enter() {
  local message="$1"
  if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    log "Non-interactive: $message"
    return 0
  fi

  printf '\n%s\nPress Enter to continue...' "$message"
  read -r _
}

confirm_observation() {
  local step="$1"
  local prompt="$2"

  if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    record_step "$step" "PASS CON NOTE" "Payload sent; runtime state not human-verified in --non-interactive mode."
    return 0
  fi

  local answer
  printf '%s [y/N/skip]: ' "$prompt"
  read -r answer
  case "$answer" in
    y | Y | yes | YES)
      record_step "$step" "PASS" "Human-confirmed on device/logs."
      ;;
    skip | s | S)
      record_step "$step" "SKIP" "Human verification skipped."
      ;;
    *)
      record_step "$step" "BLOCCATO" "Human confirmation was not provided."
      ;;
  esac
}

send_one_fcm() {
  local step="$1"
  local scenario="$2"
  local logfile="$LOG_DIR/fcm-$scenario.log"
  local masked_token
  masked_token="$(mask_token "$IOS_FCM_TOKEN")"

  log "Sending FCM scenario '$scenario' to token $masked_token (log: $logfile)"
  if (cd "$REPO_ROOT" && yarn send:test:fcm "$IOS_FCM_TOKEN" "$scenario") 2>&1 | redact_token_from_stream "$IOS_FCM_TOKEN" "$masked_token" > "$logfile"; then
    log "FCM scenario '$scenario' sent."
  else
    local pipeline_status=("${PIPESTATUS[@]}")
    local status="${pipeline_status[0]:-1}"
    local redact_status="${pipeline_status[1]:-0}"
    if [[ "$redact_status" -ne 0 ]]; then
      record_step "$step" "FAIL" "FCM log redaction failed for $scenario with exit $redact_status. See $logfile"
      fail "FCM log redaction failed for scenario $scenario."
    fi
    record_step "$step" "FAIL" "FCM send failed for $scenario with exit $status. See $logfile"
    tail -n 30 "$logfile" >&2 || true
    fail "FCM send failed for scenario $scenario."
  fi
}

send_fcm() {
  if [[ -z "${IOS_FCM_TOKEN:-}" ]]; then
    record_step "FCM foreground" "NON ESEGUITO" 'IOS_FCM_TOKEN missing. export IOS_FCM_TOKEN="<token>"'
    record_step "FCM background/NSE" "NON ESEGUITO" 'IOS_FCM_TOKEN missing. export IOS_FCM_TOKEN="<token>"'
    record_step "FCM killed/NSE" "NON ESEGUITO" 'IOS_FCM_TOKEN missing. export IOS_FCM_TOKEN="<token>"'
    record_step "FCM attachment/NSE" "NON ESEGUITO" 'IOS_FCM_TOKEN missing. export IOS_FCM_TOKEN="<token>"'
    cat >&2 <<'EOF'
IOS_FCM_TOKEN is required for send.

Run:
  export IOS_FCM_TOKEN="<token>"
  scripts/f4-ios-nse-e2e.sh send
EOF
    return 2
  fi

  [[ -f "$FIREBASE_SERVICE_ACCOUNT" ]] || fail "Missing $FIREBASE_SERVICE_ACCOUNT. The key contents will not be printed."

  prompt_enter "1. Porta l'app in foreground sul device, concedi i permessi notifiche se richiesti, poi premi Enter."
  send_one_fcm "FCM foreground" "kitchen-sink"
  confirm_observation "FCM foreground" "Confermi ricezione/log atteso per foreground kitchen-sink?"

  prompt_enter "2. Metti l'app in background, poi premi Enter."
  send_one_fcm "FCM background/NSE" "minimal"
  confirm_observation "FCM background/NSE" "Confermi ricezione/log atteso per background/NSE minimal?"

  prompt_enter "3. Chiudi l'app dallo switcher, poi premi Enter."
  send_one_fcm "FCM killed/NSE" "emoji"
  confirm_observation "FCM killed/NSE" "Confermi ricezione/log atteso per killed/NSE emoji?"

  prompt_enter "4. Lascia l'app background/killed per attachment, poi premi Enter."
  send_one_fcm "FCM attachment/NSE" "ios-attachment"
  confirm_observation "FCM attachment/NSE" "Confermi banner/attachment o log NSE per ios-attachment?"
}

cleanup() {
  ensure_log_dir
  local cleanup_log="$LOG_DIR/cleanup.log"
  if ! validate_nse_target; then
    record_step "cleanup" "FAIL" "Unsafe NSE_TARGET=$NSE_TARGET; expected $EXPECTED_NSE_TARGET."
    return 1
  fi

  log "Cleaning temporary iOS/NSE changes (log: $cleanup_log)"

  {
    printf 'git checkout -- apps/smoke/ios/\n'
    git -C "$REPO_ROOT" checkout -- apps/smoke/ios/
    printf 'rm -rf apps/smoke/ios/%s/\n' "$EXPECTED_NSE_TARGET"
    safe_remove_nse_dir
    printf '\ngit status --short --branch\n'
    git -C "$REPO_ROOT" status --short --branch
  } > "$cleanup_log" 2>&1 || {
    record_step "cleanup" "FAIL" "Cleanup command failed. See $cleanup_log"
    cat >&2 <<EOF
Automatic cleanup failed. Run manually:
  git checkout -- apps/smoke/ios/
  rm -rf apps/smoke/ios/$EXPECTED_NSE_TARGET/
EOF
    return 1
  }

  local unexpected
  unexpected="$(unexpected_git_status)"
  if [[ -n "$unexpected" ]]; then
    record_step "cleanup" "FAIL" "Unexpected changes remain after cleanup: $unexpected. See $cleanup_log"
    cat >&2 <<EOF
Unexpected changes remain after cleanup:
$unexpected

See:
  $cleanup_log
EOF
    return 1
  fi

  record_step "cleanup" "PASS" "apps/smoke/ios reverted; $EXPECTED_NSE_DIR removed. See $cleanup_log"
}

on_error() {
  local line="$1"
  local exit_code="${2:-1}"

  if [[ "$TRAP_CLEANUP_RUNNING" -eq 1 ]]; then
    exit "$exit_code"
  fi

  warn "Command failed at line $line with exit $exit_code."
  if [[ "$CLEANUP_ON_ERROR" -eq 1 ]]; then
    TRAP_CLEANUP_RUNNING=1
    set +e
    cleanup
    local cleanup_status=$?
    set -e
    TRAP_CLEANUP_RUNNING=0
    if [[ "$cleanup_status" -ne 0 ]]; then
      warn "Automatic cleanup failed. Run scripts/f4-ios-nse-e2e.sh cleanup"
    fi
  fi
  write_report || true
  exit "$exit_code"
}

on_exit() {
  local exit_code="${1:-0}"

  if [[ "$TRAP_CLEANUP_RUNNING" -eq 1 ]]; then
    exit "$exit_code"
  fi

  if [[ "$ALWAYS_CLEANUP_ON_EXIT" -eq 1 ]]; then
    TRAP_CLEANUP_RUNNING=1
    set +e
    cleanup
    local cleanup_status=$?
    set -e
    TRAP_CLEANUP_RUNNING=0
    if [[ "$cleanup_status" -ne 0 && "$exit_code" -eq 0 ]]; then
      exit_code="$cleanup_status"
    fi
  fi

  write_report || true
  if [[ "$exit_code" -eq 0 ]]; then
    log "Report: $REPORT_PATH"
  fi
  exit "$exit_code"
}

prepare() {
  CLEANUP_ON_ERROR=1
  require_clean_repo
  check_prerequisites
  detect_device
  build_server_sdk
  build_cli
  init_nse
  pod_install
  verify_rnfb_cycle_fix
  CLEANUP_ON_ERROR=0
}

parse_args() {
  COMMAND="${1:-help}"
  shift || true

  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --non-interactive)
        NON_INTERACTIVE=1
        ;;
      -h | --help)
        COMMAND="help"
        ;;
      *)
        fail "Unknown argument: $1"
        ;;
    esac
    shift
  done
}

main() {
  cd "$REPO_ROOT"
  ensure_log_dir
  trap 'on_error $LINENO $?' ERR
  trap 'on_exit $?' EXIT

  parse_args "$@"

  case "$COMMAND" in
    help | "" | -h | --help)
      ;;
    *)
      validate_nse_target || fail "Unsafe NSE_TARGET; refusing to continue."
      ;;
  esac

  case "$COMMAND" in
    help | "" | -h | --help)
      usage
      ;;
    prepare)
      prepare
      ;;
    build-generic)
      CLEANUP_ON_ERROR=1
      build_generic_ios
      CLEANUP_ON_ERROR=0
      ;;
    build-device)
      CLEANUP_ON_ERROR=1
      build_device_ios
      CLEANUP_ON_ERROR=0
      ;;
    send)
      send_fcm
      ;;
    cleanup)
      cleanup
      ;;
    all)
      CLEANUP_ON_ERROR=1
      ALWAYS_CLEANUP_ON_EXIT=1
      prepare
      build_generic_ios
      local device_status=0
      build_device_ios || device_status=$?
      if [[ "$device_status" -ne 0 ]]; then
        if [[ "$device_status" -eq 2 ]]; then
          open_xcode || true
        else
          return "$device_status"
        fi
      fi
      if [[ -n "${IOS_FCM_TOKEN:-}" ]]; then
        send_fcm || true
      else
        record_step "FCM foreground" "NON ESEGUITO" 'IOS_FCM_TOKEN missing. export IOS_FCM_TOKEN="<token>"'
        record_step "FCM background/NSE" "NON ESEGUITO" 'IOS_FCM_TOKEN missing. export IOS_FCM_TOKEN="<token>"'
        record_step "FCM killed/NSE" "NON ESEGUITO" 'IOS_FCM_TOKEN missing. export IOS_FCM_TOKEN="<token>"'
        record_step "FCM attachment/NSE" "NON ESEGUITO" 'IOS_FCM_TOKEN missing. export IOS_FCM_TOKEN="<token>"'
        log "IOS_FCM_TOKEN is not set; runtime FCM send not executed."
      fi
      CLEANUP_ON_ERROR=0
      ;;
    *)
      usage >&2
      fail "Unknown command: $COMMAND"
      ;;
  esac
}

main "$@"
