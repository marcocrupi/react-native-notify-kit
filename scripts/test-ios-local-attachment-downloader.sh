#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/notifee-ios-local-attachment-downloader.XXXXXX")"

cleanup() {
  rm -rf "$BUILD_DIR"
}
trap cleanup EXIT

HARNESS_SOURCE="$REPO_ROOT/ios/NotifeeCoreTests/NotifeeCoreLocalAttachmentDownloaderHarness.m"
SESSION_SOURCE="$REPO_ROOT/ios/NotifeeCore/NotifeeCore+NSURLSession.m"
DELEGATE_SOURCE="$REPO_ROOT/ios/NotifeeCore/NotifeeCoreDownloadDelegate.m"
OUTPUT_BINARY="$BUILD_DIR/notifee-ios-local-attachment-downloader-tests"

SDK_PATH="$(xcrun --sdk macosx --show-sdk-path)"

xcrun --sdk macosx clang \
  -fobjc-arc \
  -Werror \
  -Wall \
  -Wextra \
  -mmacosx-version-min=12.0 \
  -isysroot "$SDK_PATH" \
  -I "$REPO_ROOT/ios/NotifeeCore" \
  "$SESSION_SOURCE" \
  "$DELEGATE_SOURCE" \
  "$HARNESS_SOURCE" \
  -framework Foundation \
  -o "$OUTPUT_BINARY"

"$OUTPUT_BINARY"
