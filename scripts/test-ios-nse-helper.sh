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
CORE_SOURCE="$REPO_ROOT/ios/NotifeeCore/NotifeeCore.m"
BUILDER_SOURCE="$BUILD_DIR/production-builder.m"
OUTPUT_BINARY="$BUILD_DIR/notifee-ios-nse-helper-tests"

SDK_PATH="$(xcrun --sdk macosx --show-sdk-path)"
IOS_SDK_PATH="$(xcrun --sdk iphoneos --show-sdk-path)"

# Witness tooling only: Clang identifies the production method's exact byte
# range. No textual boundary guesses, method rewrites, or fallback builder.
python3 - "$CORE_SOURCE" "$BUILDER_SOURCE" "$IOS_SDK_PATH" <<'PY'
import hashlib
import json
from pathlib import Path
import subprocess
import sys

source_path = Path(sys.argv[1]).resolve()
output_path = Path(sys.argv[2])
source_bytes = source_path.read_bytes()
result = subprocess.run(
    [
        "xcrun", "--sdk", "iphoneos", "clang",
        "-target", "arm64-apple-ios13.0",
        "-fsyntax-only", "-fobjc-arc", "-fblocks", "-Werror",
        "-isysroot", sys.argv[3], "-I", str(source_path.parent),
        "-Xclang", "-ast-dump=json",
        "-Xclang", "-ast-dump-filter", "-Xclang", "buildNotificationContent",
        str(source_path),
    ],
    capture_output=True,
    text=True,
)
if result.returncode:
    sys.stderr.write(result.stderr)
    sys.exit("STOP: Clang could not identify the production builder")
if source_path.read_bytes() != source_bytes:
    sys.exit("STOP: production source changed during extraction")

decoder = json.JSONDecoder()
remaining = result.stdout.strip()
definitions = []
while remaining:
    node, end = decoder.raw_decode(remaining)
    if (
        node.get("kind") == "ObjCMethodDecl"
        and node.get("name") == "buildNotificationContent:withTrigger:"
        and any(child.get("kind") == "CompoundStmt" for child in node.get("inner", []))
    ):
        definitions.append(node)
    remaining = remaining[end:].strip()
if len(definitions) != 1:
    sys.exit("STOP: production builder definition is missing or ambiguous")

method = definitions[0]
location = method["loc"]
begin = method["range"]["begin"]
end = method["range"]["end"]
if (
    method.get("instance") is not False
    or method.get("mangledName") != "+[NotifeeCore buildNotificationContent:withTrigger:]"
    or Path(location.get("file", "")).resolve() != source_path
    or any("spellingLoc" in point or "expansionLoc" in point for point in (location, begin, end))
    or any("includedFrom" in point for point in (location, begin, end))
):
    sys.exit("STOP: builder source range is not a direct production class method")
start_offset = begin["offset"]
end_offset = end["offset"] + end["tokLen"]
if not 0 <= start_offset < end_offset <= len(source_bytes):
    sys.exit("STOP: invalid builder source range")
method_bytes = source_bytes[start_offset:end_offset]
if not method_bytes.startswith(b"+") or not method_bytes.endswith(b"}"):
    sys.exit("STOP: incomplete builder source range")

# The macOS header marks launchImageName unavailable. Remove header availability
# annotations only in this generated unit; the entire method remains verbatim.
# This host witness does not qualify iOS-only APIs or physical delivery.
prefix = (
    '#import <Foundation/Foundation.h>\n'
    '#undef API_UNAVAILABLE\n'
    '#define API_UNAVAILABLE(...)\n'
    '#import "NotifeeCore.h"\n'
    '#import "NotifeeCoreUtil.h"\n'
    '@implementation NotifeeCore\n'
    f'#line {location["line"]} {json.dumps(str(source_path))}\n'
).encode()
output_path.write_bytes(prefix + method_bytes + b"\n@end\n")
if output_path.read_bytes()[len(prefix):len(prefix) + len(method_bytes)] != method_bytes:
    sys.exit("STOP: generated builder differs from production source")
print(
    f"WITNESS production builder: source={source_path} "
    f"bytes={start_offset}:{end_offset} sha256={hashlib.sha256(method_bytes).hexdigest()}",
    flush=True,
)
PY

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
  "$BUILDER_SOURCE" \
  "$HARNESS_SOURCE" \
  -framework Foundation \
  -framework UserNotifications \
  -framework Intents \
  -o "$OUTPUT_BINARY"

"$OUTPUT_BINARY" "$REPO_ROOT/ios/NotifeeCoreTests/fixtures/fcm-mode-ios-batch1.json"
