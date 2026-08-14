#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/notifee-ios-communication-avatars.XXXXXX")"

cleanup() {
  rm -rf "$BUILD_DIR"
}
trap cleanup EXIT

HARNESS_SOURCE="$REPO_ROOT/ios/NotifeeCoreTests/NotifeeCoreCommunicationAvatarHarness.m"
UTIL_SOURCE="$REPO_ROOT/ios/NotifeeCore/NotifeeCoreUtil.m"
SESSION_SOURCE="$REPO_ROOT/ios/NotifeeCore/NotifeeCore+NSURLSession.m"
DELEGATE_SOURCE="$REPO_ROOT/ios/NotifeeCore/NotifeeCoreDownloadDelegate.m"
OUTPUT_BINARY="$BUILD_DIR/notifee-ios-communication-avatar-tests"

SDK_PATH="$(xcrun --sdk macosx --show-sdk-path)"
HOST_ARCH="$(uname -m)"
IOS_SUPPORT_FRAMEWORKS="$SDK_PATH/System/iOSSupport/System/Library/Frameworks"

xcrun --sdk macosx clang \
  -fobjc-arc \
  -Werror \
  -Wall \
  -Wextra \
  -Wno-implicit-const-int-float-conversion \
  -target "$HOST_ARCH-apple-ios15.0-macabi" \
  -isysroot "$SDK_PATH" \
  -iframework "$IOS_SUPPORT_FRAMEWORKS" \
  -F "$IOS_SUPPORT_FRAMEWORKS" \
  -I "$REPO_ROOT/ios/NotifeeCore" \
  "$UTIL_SOURCE" \
  "$SESSION_SOURCE" \
  "$DELEGATE_SOURCE" \
  "$HARNESS_SOURCE" \
  -framework CoreGraphics \
  -framework Foundation \
  -framework Intents \
  -framework UIKit \
  -framework UserNotifications \
  -o "$OUTPUT_BINARY"

"$OUTPUT_BINARY"
