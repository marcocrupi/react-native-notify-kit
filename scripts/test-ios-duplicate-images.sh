#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$(mktemp -d "${TMPDIR:-/tmp}/notifee-duplicate-images.XXXXXX")"
trap 'if [[ "${KEEP_TMP:-0}" == "1" ]]; then echo "$BUILD"; else rm -rf "$BUILD"; fi' EXIT
for variant in A B; do
  xcrun clang -fobjc-arc -fblocks -dynamiclib -Werror -Wall -Wextra -Wno-unused-parameter -Wno-incomplete-implementation -mmacosx-version-min=12.0 \
    -I "$ROOT/ios/NotifeeCore" "$ROOT/ios/NotifeeCore/NotifeeCore+UNUserNotificationCenter.m" \
    "$ROOT/ios/NotifeeCoreTests/NotifeeCoreDuplicateImageStubs.m" \
    -framework Foundation -framework UserNotifications -framework Intents -o "$BUILD/core$variant.dylib"
done
xcrun clang -fobjc-arc -fblocks -Werror -Wall -Wextra -Wno-unused-parameter \
  "$ROOT/ios/NotifeeCoreTests/NotifeeCoreDuplicateImageLoader.m" \
  -framework Foundation -framework UserNotifications -o "$BUILD/loader"
"$BUILD/loader" "$BUILD/coreA.dylib" "$BUILD/coreB.dylib"
