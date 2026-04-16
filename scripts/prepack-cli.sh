#!/usr/bin/env bash
#
# Prepacks the CLI into packages/react-native/cli/ before npm pack/publish.
# Called automatically by the "prepack" lifecycle script in
# packages/react-native/package.json.
#
# Copies the CLI's compiled output (dist/ with templates, bin/) into the
# RN package. CLI runtime deps (xcode, commander, chalk, plist) ship as
# optionalDependencies of the RN package — no bundling needed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI_PKG="$REPO_ROOT/packages/cli"
TARGET="$REPO_ROOT/packages/react-native/cli"

# Build CLI
echo "[prepack-cli] Building CLI..."
(cd "$CLI_PKG" && yarn build)

# Clean previous prepack output
rm -rf "$TARGET"
mkdir -p "$TARGET"

# Copy dist (compiled JS + templates)
cp -R "$CLI_PKG/dist" "$TARGET/dist"

# Copy bin (shebang entry)
cp -R "$CLI_PKG/bin" "$TARGET/bin"
chmod +x "$TARGET/bin/react-native-notify-kit"

# Copy a minimal package.json (cli.ts reads version from it)
node -e "const p=require('$CLI_PKG/package.json');console.log(JSON.stringify({version:p.version}))" > "$TARGET/package.json"

# Verify templates present
if [ ! -d "$TARGET/dist/templates" ]; then
  echo "[prepack-cli] ERROR: dist/templates/ missing." >&2
  exit 1
fi

echo "[prepack-cli] CLI prepacked to $TARGET"
echo "[prepack-cli] Templates: $(ls "$TARGET/dist/templates/" | wc -l | tr -d ' ') files"
