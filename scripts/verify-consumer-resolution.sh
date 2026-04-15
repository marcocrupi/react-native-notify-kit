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
SCRATCH="$(mktemp -d -t notifykit-consumer-check-XXXXXX)"
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
# are available to the consumer tsc run.
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
const merged: string = serializeNotifeeOptions({ android: androidCfg, ios: iosCfg });

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

run_mode node
run_mode node16
run_mode bundler

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
