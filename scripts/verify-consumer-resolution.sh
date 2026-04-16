#!/usr/bin/env bash
#
# Verifies that `react-native-notify-kit/server` can be resolved by TypeScript
# consumers under all three supported `moduleResolution` modes:
#
#   - `node`     (legacy / node10, still used by older TS and CRA setups)
#   - `node16`   (strict Node.js resolver with exports-field support)
#   - `bundler`  (TS 5.x default for new projects)
#
# The test packs the current RN package, extracts the tarball into a scratch
# `node_modules/` directory, then type-checks a synthetic consumer file that
# imports every named export from `react-native-notify-kit/server`.
#
# Exits 1 on the first failure. Run before tagging releases that touch
# `packages/react-native/package.json` (`exports`, `files`),
# `packages/react-native/server/package.json` (the subdirectory resolver
# redirect shim), or the shared type file at
# `packages/react-native/src/internal/fcmContract.d.ts`.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RN_PKG="$ROOT/packages/react-native"
# Use the portable form: `mktemp -d -t` has different semantics on BSD (macOS)
# vs GNU (Linux CI). Passing a full template under $TMPDIR works identically
# on both. Strip any trailing slash from $TMPDIR (macOS often sets it with
# one) so we don't emit ugly `//` paths.
TMP_ROOT="${TMPDIR:-/tmp}"
TMP_ROOT="${TMP_ROOT%/}"
SCRATCH="$(mktemp -d "$TMP_ROOT/notifykit-consumer-check-XXXXXX")"
TSC="$ROOT/node_modules/.bin/tsc"

cleanup() {
  rm -rf "$SCRATCH"
}
trap cleanup EXIT

if [ ! -x "$TSC" ]; then
  echo "ERROR: local tsc not found at $TSC" >&2
  echo "Run 'yarn install' at the repo root first." >&2
  exit 2
fi

echo "[verify-consumer-resolution] Building server SDK..."
(cd "$RN_PKG" && yarn build:server >/dev/null 2>&1)

echo "[verify-consumer-resolution] Packing real tarball to $SCRATCH..."
(cd "$RN_PKG" && npm pack --pack-destination "$SCRATCH" >/dev/null 2>&1)

TARBALL="$(ls "$SCRATCH"/react-native-notify-kit-*.tgz | head -1)"
if [ -z "$TARBALL" ]; then
  echo "ERROR: npm pack did not produce a tarball" >&2
  exit 2
fi

echo "[verify-consumer-resolution] Extracting tarball into scratch node_modules..."
mkdir -p "$SCRATCH/node_modules"
tar -xzf "$TARBALL" -C "$SCRATCH/node_modules/"
mv "$SCRATCH/node_modules/package" "$SCRATCH/node_modules/react-native-notify-kit"

# Symlink @types/node so the consumer's Node built-ins (Buffer, console, etc.)
# are available to the consumer tsc run. The workspace expects @types/node to
# be hoisted to the repo root under Yarn's default nmHoistingLimits; fail
# loudly if that assumption breaks so the regression surfaces here rather
# than as a cryptic TS2580 later.
if [ ! -d "$ROOT/node_modules/@types/node" ]; then
  echo "ERROR: @types/node is not present at $ROOT/node_modules/@types/node." >&2
  echo "This usually means Yarn did not hoist @types/node to the repo root." >&2
  echo "Run 'yarn install' at the repo root, or adjust Yarn's nmHoistingLimits." >&2
  exit 2
fi
mkdir -p "$SCRATCH/node_modules/@types"
ln -sf "$ROOT/node_modules/@types/node" "$SCRATCH/node_modules/@types/node"

cat > "$SCRATCH/package.json" <<'EOF'
{
  "name": "notifykit-consumer-check",
  "version": "0.0.0",
  "private": true,
  "type": "commonjs"
}
EOF

cat > "$SCRATCH/blocked.ts" <<'EOF'
// Confirms that `./src/internal/*` is blocked from consumers by the exports
// map. The blocked path must NOT be resolvable under modern resolvers. This
// file is expected to FAIL type-checking with TS2307. If it compiles, the
// exports block has regressed and the "internal" contract is leaking.
import type { NotifyKitPayloadInput } from 'react-native-notify-kit/src/internal/fcmContract';
const _leaked: NotifyKitPayloadInput = {
  token: 't',
  notification: { title: 'a', body: 'b' },
};
console.log(_leaked);
EOF

cat > "$SCRATCH/index.ts" <<'EOF'
import {
  buildNotifyKitPayload,
  buildIosApnsPayload,
  buildAndroidPayload,
  serializeNotifeeOptions,
  type NotifyKitPayloadInput,
  type NotifyKitPayloadOutput,
  type NotifyKitNotification,
  type NotifyKitOptions,
  type NotifyKitAndroidConfig,
  type NotifyKitIosConfig,
} from 'react-native-notify-kit/server';

const androidCfg: NotifyKitAndroidConfig = {
  channelId: 'orders',
  smallIcon: 'ic_notification',
  style: { type: 'BIG_TEXT', text: 'Order #42 shipped' },
  actions: [
    { title: 'Reply', pressAction: { id: 'reply' }, input: true },
    { title: 'Done', pressAction: { id: 'done' } },
  ],
};

const iosCfg: NotifyKitIosConfig = {
  sound: 'chime.caf',
  categoryId: 'order-updates',
  threadId: 'orders',
  interruptionLevel: 'timeSensitive',
  attachments: [{ url: 'https://cdn.example.com/map.png', identifier: 'map' }],
};

const notification: NotifyKitNotification = {
  id: 'order-42',
  title: 'Your order is ready',
  body: 'Tap to see details',
  data: { orderId: '42', customer: 'acme' },
  android: androidCfg,
  ios: iosCfg,
};

const options: NotifyKitOptions = {
  androidPriority: 'high',
  iosBadgeCount: 3,
  ttl: 3600,
};

const input: NotifyKitPayloadInput = {
  token: 'device-token',
  notification,
  options,
};

const out: NotifyKitPayloadOutput = buildNotifyKitPayload(input);
const apns = buildIosApnsPayload(input, { notifeeOptions: '{"_v":1}' });
const android = buildAndroidPayload(input, { collapseKey: 'k', ttlSeconds: 60 });
const merged: string = serializeNotifeeOptions({ title: 'a', body: 'b', android: androidCfg, ios: iosCfg });

const priority: 'HIGH' | 'NORMAL' = out.android.priority;
const pushType: 'alert' = out.apns.headers['apns-push-type'];
const mutableContent: 1 = out.apns.payload.aps['mutable-content'];

console.log(priority, pushType, mutableContent, apns, android, merged);
EOF

write_tsconfig() {
  local file="$1"
  local module="$2"
  local moduleResolution="$3"
  cat > "$file" <<EOF
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "$module",
    "moduleResolution": "$moduleResolution",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["index.ts"]
}
EOF
}

write_tsconfig "$SCRATCH/tsconfig.node.json"     "CommonJS" "node"
write_tsconfig "$SCRATCH/tsconfig.node16.json"   "Node16"   "node16"
write_tsconfig "$SCRATCH/tsconfig.bundler.json"  "ESNext"   "bundler"

# A second tsconfig per mode that only includes the `blocked.ts` file, used to
# assert that consumers CANNOT reach `react-native-notify-kit/src/internal/*`.
# Under modern resolvers (node16/bundler) the exports map rejects the subpath;
# under legacy `node` the exports field is ignored entirely, so the block
# cannot be enforced there — that's a known limitation documented in the
# CHANGELOG.
cat > "$SCRATCH/tsconfig.blocked.node16.json" <<'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "Node16",
    "moduleResolution": "node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["blocked.ts"]
}
EOF
cat > "$SCRATCH/tsconfig.blocked.bundler.json" <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["blocked.ts"]
}
EOF

fail=0

run_mode() {
  local mode="$1"
  local cfg="$SCRATCH/tsconfig.$mode.json"
  echo "[verify-consumer-resolution] moduleResolution: $mode"
  if (cd "$SCRATCH" && "$TSC" -p "$cfg"); then
    echo "  → PASS"
  else
    echo "  → FAIL (see errors above)" >&2
    fail=1
  fi
}

# Asserts that compiling `blocked.ts` under `mode` FAILS — i.e. the consumer
# CANNOT reach `src/internal/*`. A successful compile here is a regression.
run_blocked() {
  local mode="$1"
  local cfg="$SCRATCH/tsconfig.blocked.$mode.json"
  echo "[verify-consumer-resolution] blocked-subpath check (mode: $mode)"
  if (cd "$SCRATCH" && "$TSC" -p "$cfg" >/dev/null 2>&1); then
    echo "  → FAIL — src/internal/* is reachable from consumers! exports block regressed." >&2
    fail=1
  else
    echo "  → PASS (block enforced)"
  fi
}

run_mode node
run_mode node16
run_mode bundler
run_blocked node16
run_blocked bundler

if [ $fail -ne 0 ]; then
  echo ""
  echo "[verify-consumer-resolution] At least one moduleResolution mode failed." >&2
  echo "If you changed packages/react-native/package.json (exports/files)," >&2
  echo "packages/react-native/server/package.json (subdirectory shim), or the" >&2
  echo "shared type file at src/internal/fcmContract.d.ts, this is expected — " >&2
  echo "fix the resolution chain before committing." >&2
  exit 1
fi

echo ""
echo "[verify-consumer-resolution] All three moduleResolution modes PASS."
