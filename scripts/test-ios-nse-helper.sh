#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/notifee-ios-nse-helper.XXXXXX")"

cleanup() {
  rm -rf "$BUILD_DIR"
}
trap cleanup EXIT

HARNESS_SOURCE="$REPO_ROOT/ios/NotifeeCoreTests/NotifeeCoreExtensionHelperPayloadHarness.m"
HELPER_SOURCE="$REPO_ROOT/ios/NotifeeCore/NotifeeCoreExtensionHelper.m"
OUTPUT_BINARY="$BUILD_DIR/notifee-ios-nse-helper-tests"

SDK_PATH="$(xcrun --sdk macosx --show-sdk-path)"

xcrun --sdk macosx clang \
  -fobjc-arc \
  -fblocks \
  -Werror \
  -Wall \
  -Wextra \
  -Wno-incomplete-implementation \
  -Wno-unused-parameter \
  -mmacosx-version-min=12.0 \
  -isysroot "$SDK_PATH" \
  -I "$REPO_ROOT/ios/NotifeeCore" \
  "$HELPER_SOURCE" \
  "$HARNESS_SOURCE" \
  -framework Foundation \
  -framework UserNotifications \
  -framework Intents \
  -o "$OUTPUT_BINARY"

"$OUTPUT_BINARY"
