#!/usr/bin/env bash
#
# Verifies that packages/react-native/ios/NotifeeCore is the generated copy
# of ios/NotifeeCore. This script is read-only.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_CORE="$REPO_ROOT/ios/NotifeeCore"
PACKAGE_CORE="$REPO_ROOT/packages/react-native/ios/NotifeeCore"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/verify-ios-core-generation.XXXXXX")"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

ROOT_LIST="$TMP_DIR/root-files.txt"
PACKAGE_LIST="$TMP_DIR/package-files.txt"
MISSING_LIST="$TMP_DIR/missing-files.txt"
EXTRA_LIST="$TMP_DIR/extra-files.txt"
DIFF_LIST="$TMP_DIR/different-files.txt"

if [ ! -d "$ROOT_CORE" ]; then
  echo "[verify-ios-core-generation] ERROR: missing root core directory: $ROOT_CORE" >&2
  exit 1
fi

if [ ! -d "$PACKAGE_CORE" ]; then
  echo "[verify-ios-core-generation] ERROR: missing package core directory: $PACKAGE_CORE" >&2
  exit 1
fi

find "$ROOT_CORE" -type f -print | sed "s#^$ROOT_CORE/##" | sort > "$ROOT_LIST"
find "$PACKAGE_CORE" -type f -print | sed "s#^$PACKAGE_CORE/##" | sort > "$PACKAGE_LIST"

comm -23 "$ROOT_LIST" "$PACKAGE_LIST" > "$MISSING_LIST"
comm -13 "$ROOT_LIST" "$PACKAGE_LIST" > "$EXTRA_LIST"

: > "$DIFF_LIST"
while IFS= read -r relative_path; do
  if [ -f "$PACKAGE_CORE/$relative_path" ] && ! cmp -s "$ROOT_CORE/$relative_path" "$PACKAGE_CORE/$relative_path"; then
    echo "$relative_path" >> "$DIFF_LIST"
  fi
done < "$ROOT_LIST"

failed=0

if [ -s "$MISSING_LIST" ]; then
  echo "[verify-ios-core-generation] ERROR: package core missing files:" >&2
  sed 's/^/  - /' "$MISSING_LIST" >&2
  failed=1
fi

if [ -s "$EXTRA_LIST" ]; then
  echo "[verify-ios-core-generation] ERROR: package core has extra files:" >&2
  sed 's/^/  - /' "$EXTRA_LIST" >&2
  failed=1
fi

if [ -s "$DIFF_LIST" ]; then
  echo "[verify-ios-core-generation] ERROR: package core content differs:" >&2
  sed 's/^/  - /' "$DIFF_LIST" >&2
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  root_count="$(wc -l < "$ROOT_LIST" | tr -d ' ')"
  package_count="$(wc -l < "$PACKAGE_LIST" | tr -d ' ')"
  echo "[verify-ios-core-generation] root files: $root_count, package files: $package_count" >&2
  exit 1
fi

file_count="$(wc -l < "$ROOT_LIST" | tr -d ' ')"
echo "[verify-ios-core-generation] OK: $file_count files match."
