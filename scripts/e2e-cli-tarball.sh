#!/usr/bin/env bash
#
# E2E test: pack react-native-notify-kit, install in a scratch consumer
# project, and verify the CLI runs from the tarball's bin entry.
#
# Usage: yarn e2e:cli-tarball
#
# This simulates what a real consumer sees after `npm install react-native-notify-kit`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RN_PKG="$REPO_ROOT/packages/react-native"
CLI_FIXTURE="$REPO_ROOT/packages/cli/src/__tests__/fixtures/sample-rn-app"

TMP_ROOT="${TMPDIR:-/tmp}"
TMP_ROOT="${TMP_ROOT%/}"
SCRATCH="$(mktemp -d "$TMP_ROOT/e2e-cli-tarball-XXXXXX")"
cleanup() { rm -rf "$SCRATCH"; }
trap cleanup EXIT

echo "[e2e-cli-tarball] Packing react-native-notify-kit..."
cd "$RN_PKG"
TARBALL="$(npm pack --pack-destination "$SCRATCH" 2>/dev/null | tail -1)"
TARBALL_PATH="$SCRATCH/$TARBALL"

if [ ! -f "$TARBALL_PATH" ]; then
  echo "ERROR: npm pack did not produce a tarball at $TARBALL_PATH" >&2
  exit 1
fi
echo "[e2e-cli-tarball] Tarball: $TARBALL ($(wc -c < "$TARBALL_PATH" | tr -d ' ') bytes)"

# Verify tarball contains CLI files
echo "[e2e-cli-tarball] Verifying tarball contents..."
tar -tzf "$TARBALL_PATH" | grep -q "package/cli/bin/react-native-notify-kit" || {
  echo "ERROR: tarball missing cli/bin/react-native-notify-kit" >&2
  exit 1
}
tar -tzf "$TARBALL_PATH" | grep -q "package/cli/dist/cli.bundle.js" || {
  echo "ERROR: tarball missing cli/dist/cli.bundle.js" >&2
  exit 1
}
tar -tzf "$TARBALL_PATH" | grep -q "package/cli/dist/templates" || {
  echo "ERROR: tarball missing cli/dist/templates/" >&2
  exit 1
}
echo "[e2e-cli-tarball] Tarball contents verified."

# Create scratch consumer project
echo "[e2e-cli-tarball] Setting up scratch consumer..."
mkdir -p "$SCRATCH/consumer"
cp -R "$CLI_FIXTURE/ios" "$SCRATCH/consumer/ios"
cd "$SCRATCH/consumer"

cat > package.json << 'EOF'
{ "name": "e2e-consumer", "version": "0.0.0", "private": true }
EOF

# Install the tarball
npm install "$TARBALL_PATH" --no-save --no-audit --no-fund 2>/dev/null

# Verify bin is available
BIN_PATH="./node_modules/.bin/react-native-notify-kit"
if [ ! -f "$BIN_PATH" ]; then
  echo "ERROR: bin not installed at $BIN_PATH" >&2
  exit 1
fi
echo "[e2e-cli-tarball] Bin installed at $BIN_PATH"

# Test --help
echo "[e2e-cli-tarball] Testing --help..."
"$BIN_PATH" --help > /dev/null 2>&1 || {
  echo "ERROR: --help failed" >&2
  exit 1
}

# Test --dry-run
echo "[e2e-cli-tarball] Testing init-nse --dry-run..."
OUTPUT=$("$BIN_PATH" init-nse --dry-run --ios-path ios 2>&1)
echo "$OUTPUT"
echo "$OUTPUT" | grep -q "DRY RUN" || {
  echo "ERROR: dry-run output missing [DRY RUN]" >&2
  exit 1
}
echo "$OUTPUT" | grep -q "NotifyKitNSE" || {
  echo "ERROR: dry-run output missing target name" >&2
  exit 1
}

# Test real run (creates files)
echo "[e2e-cli-tarball] Testing init-nse (real run)..."
"$BIN_PATH" init-nse --ios-path ios 2>&1
if [ ! -f "ios/NotifyKitNSE/NotificationService.swift" ]; then
  echo "ERROR: NotificationService.swift not created" >&2
  exit 1
fi
if [ ! -f "ios/NotifyKitNSE/Info.plist" ]; then
  echo "ERROR: Info.plist not created" >&2
  exit 1
fi

# Verify Podfile patched
grep -q "NotifyKitNSE" ios/Podfile || {
  echo "ERROR: Podfile not patched" >&2
  exit 1
}

echo ""
echo "[e2e-cli-tarball] All checks PASSED."
echo "[e2e-cli-tarball] Consumer can install + run the CLI from the packed tarball."
