#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/notifee-ios-fcm-identity.XXXXXX")"
trap 'rm -rf "$BUILD_DIR"' EXIT
SDK_PATH="$(xcrun --sdk macosx --show-sdk-path)"
xcrun --sdk macosx clang -fobjc-arc -fblocks -Werror -Wall -Wextra \
  -mmacosx-version-min=12.0 -isysroot "$SDK_PATH" \
  -I "$REPO_ROOT/ios/NotifeeCore" \
  "$REPO_ROOT/ios/NotifeeCoreTests/NotifeeCoreFcmIdentityHarness.m" \
  -framework Foundation -framework UserNotifications -o "$BUILD_DIR/fcm-identity"
"$BUILD_DIR/fcm-identity"
