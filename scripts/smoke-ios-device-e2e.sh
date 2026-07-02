#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)"

DEFAULT_IOS_DEVICE_ID="C274F5E5-B73D-556F-9589-E384F79EF805"
IOS_DEVICE_ID="${IOS_DEVICE_ID:-}"
IOS_BUNDLE_ID="${IOS_BUNDLE_ID:-org.reactjs.native.example.NotifeeExample}"
SMOKE_TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS:-45}"
SMOKE_LAUNCH_TIMEOUT_SECONDS="${SMOKE_LAUNCH_TIMEOUT_SECONDS:-15}"
SMOKE_INSPECTOR_DEEPLINK_FALLBACK_SECONDS="${SMOKE_INSPECTOR_DEEPLINK_FALLBACK_SECONDS:-2}"
SMOKE_FCM_WAIT_SECONDS_ENV="${SMOKE_FCM_WAIT_SECONDS:-}"
SMOKE_FCM_ATTACHMENT_WAIT_SECONDS_ENV="${SMOKE_FCM_ATTACHMENT_WAIT_SECONDS:-}"
SMOKE_FCM_WAIT_SECONDS="${SMOKE_FCM_WAIT_SECONDS:-8}"
SMOKE_CALLBACK_HOST="${SMOKE_CALLBACK_HOST:-}"
SMOKE_CALLBACK_PORT="${SMOKE_CALLBACK_PORT:-}"
SMOKE_TERMINATE_EXISTING="${SMOKE_TERMINATE_EXISTING:-1}"
XCRUN="${XCRUN:-xcrun}"

EXIT_SMOKE_FAIL=1
EXIT_TIMEOUT=2
EXIT_LAUNCH_FAILURE=3
EXIT_CONFIG=4

usage() {
  local device_help
  local attachment_wait_help
  device_help="${IOS_DEVICE_ID:-<auto-detect; fallback: $DEFAULT_IOS_DEVICE_ID>}"
  if [[ -n "$SMOKE_FCM_ATTACHMENT_WAIT_SECONDS_ENV" ]]; then
    attachment_wait_help="$SMOKE_FCM_ATTACHMENT_WAIT_SECONDS_ENV"
  elif [[ -n "$SMOKE_FCM_WAIT_SECONDS_ENV" ]]; then
    attachment_wait_help="<unset; using SMOKE_FCM_WAIT_SECONDS=$SMOKE_FCM_WAIT_SECONDS_ENV>"
  else
    attachment_wait_help="<unset; default 12>"
  fi

  cat <<EOF
iOS smoke device automation wrapper

Usage:
  scripts/smoke-ios-device-e2e.sh [options] help
  scripts/smoke-ios-device-e2e.sh [options] list-devices
  scripts/smoke-ios-device-e2e.sh [options] launch-url <url>
  scripts/smoke-ios-device-e2e.sh [options] parse-result-test
  scripts/smoke-ios-device-e2e.sh [options] callback-test
  scripts/smoke-ios-device-e2e.sh [options] fcm-token
  scripts/smoke-ios-device-e2e.sh [options] displayed
  scripts/smoke-ios-device-e2e.sh [options] listener-only
  scripts/smoke-ios-device-e2e.sh [options] local-display <id>
  scripts/smoke-ios-device-e2e.sh [options] verify-displayed <id>
  scripts/smoke-ios-device-e2e.sh [options] fcm-minimal <id>
  scripts/smoke-ios-device-e2e.sh [options] fcm-ios-attachment <id>

Options:
  --no-terminate-existing  Do not pass devicectl --terminate-existing for scenario commands.
                           Use when the app is already running from Xcode and must be preserved.
  --terminate-existing     Pass devicectl --terminate-existing for scenario commands (default).

Deep links:
  notifykit://smoke/run/fcm-token
  notifykit://smoke/run/displayed
  notifykit://smoke/run/listener-only
  notifykit://smoke/run/local-display?id=<id>
  notifykit://smoke/verify/displayed?id=<id>

Environment:
  IOS_DEVICE_ID=$device_help
  IOS_BUNDLE_ID=$IOS_BUNDLE_ID
  SMOKE_TIMEOUT_SECONDS=$SMOKE_TIMEOUT_SECONDS
  SMOKE_LAUNCH_TIMEOUT_SECONDS=$SMOKE_LAUNCH_TIMEOUT_SECONDS
  SMOKE_INSPECTOR_DEEPLINK_FALLBACK_SECONDS=$SMOKE_INSPECTOR_DEEPLINK_FALLBACK_SECONDS
  SMOKE_FCM_WAIT_SECONDS=$SMOKE_FCM_WAIT_SECONDS
  SMOKE_FCM_ATTACHMENT_WAIT_SECONDS=$attachment_wait_help
  SMOKE_CALLBACK_HOST=${SMOKE_CALLBACK_HOST:-<auto-detect en0/en1>}
  SMOKE_CALLBACK_PORT=${SMOKE_CALLBACK_PORT:-<auto; default 49152>}
  SMOKE_TERMINATE_EXISTING=$SMOKE_TERMINATE_EXISTING
  IOS_FCM_TOKEN=${IOS_FCM_TOKEN:+<set>}
  FCM_TOKEN=${FCM_TOKEN:+<set>}
  XCRUN=$XCRUN

Exit codes:
  0  matching SMOKE:RESULT status PASS
  1  matching SMOKE:RESULT status FAIL
  2  timeout waiting for matching callback result
  3  device/app launch failure
  4  missing or unsupported local configuration or callback failure

Notes:
  - This wrapper does not build, install, or clean up.
  - Only fcm-minimal and fcm-ios-attachment send real FCM messages; all other commands are local/deep-link flows.
  - The smoke app must already be installed on the selected physical device.
  - Scenario commands launch the deep link and wait for a matching HTTP callback.
  - Scenario commands use devicectl --terminate-existing by default; pass
    --no-terminate-existing to preserve an app process already started by Xcode.
  - fcm-minimal sends, waits SMOKE_FCM_WAIT_SECONDS, then verifies via displayed-notification callback.
  - fcm-ios-attachment: Sends a real FCM ios-attachment push, waits, then verifies displayed notification by id.
  - fcm-ios-attachment: Does not visually verify the attachment.
  - If devicectl --payload-url does not produce a callback, the wrapper dispatches
    the same deep link through the Metro inspector after the fallback delay.
  - launch-url is a launcher-only utility and does not wait for SMOKE:RESULT.
  - SMOKE_CALLBACK_HOST must be reachable from the iPhone; localhost is not used
    as the device callback default.
EOF
}

fail_config() {
  echo "[smoke-ios-device-e2e] ERROR: $*" >&2
  exit "$EXIT_CONFIG"
}

fail_launch() {
  echo "[smoke-ios-device-e2e] ERROR: $*" >&2
  exit "$EXIT_LAUNCH_FAILURE"
}

require_arg() {
  local value="${1:-}"
  local name="$2"

  if [[ -z "$value" ]]; then
    fail_config "Missing $name."
  fi
}

require_non_negative_integer() {
  local value="${1:-}"
  local name="$2"

  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    fail_config "$name must be a non-negative integer."
  fi
}

urlencode() {
  local input="$1"
  local output=""
  local char
  local encoded

  local i
  for ((i = 0; i < ${#input}; i++)); do
    char="${input:i:1}"
    case "$char" in
      [a-zA-Z0-9.~_-])
        output+="$char"
        ;;
      *)
        printf -v encoded '%%%02X' "'$char"
        output+="$encoded"
        ;;
    esac
  done

  printf '%s' "$output"
}

smoke_notification_id_for() {
  local id="$1"

  if [[ "$id" == smoke-* ]]; then
    printf '%s' "$id"
  else
    printf 'smoke-%s' "$id"
  fi
}

autodetect_device_id() {
  local temp_json
  local detected=""

  if ! command -v node >/dev/null 2>&1; then
    printf '%s' ""
    return
  fi

  temp_json="$(mktemp)"
  if "$XCRUN" devicectl list devices --timeout 10 --json-output "$temp_json" >/dev/null 2>&1; then
    detected="$(node - "$temp_json" <<'NODE'
const fs = require('fs');
const path = process.argv[2];

try {
  const data = JSON.parse(fs.readFileSync(path, 'utf8'));
  const devices = Array.isArray(data?.result?.devices) ? data.result.devices : [];
  const candidates = devices.filter(device => {
    const hardware = device.hardwareProperties ?? {};
    const properties = device.deviceProperties ?? {};
    const connection = device.connectionProperties ?? {};
    return (
      hardware.platform === 'iOS' &&
      hardware.reality === 'physical' &&
      (properties.bootState === 'booted' || connection.pairingState === 'paired')
    );
  });
  const selected = candidates[0];
  process.stdout.write(selected?.identifier ?? selected?.hardwareProperties?.udid ?? '');
} catch {
  process.stdout.write('');
}
NODE
)"
  fi

  rm -f "$temp_json"
  printf '%s' "$detected"
}

resolve_device_id() {
  local detected

  if [[ -n "$IOS_DEVICE_ID" ]]; then
    return
  fi

  detected="$(autodetect_device_id)"
  if [[ -n "$detected" ]]; then
    IOS_DEVICE_ID="$detected"
    echo "[smoke-ios-device-e2e] autodetected device: $IOS_DEVICE_ID"
    return
  fi

  IOS_DEVICE_ID="$DEFAULT_IOS_DEVICE_ID"
  echo "[smoke-ios-device-e2e] WARNING: IOS_DEVICE_ID not set and autodetect failed; using fallback $IOS_DEVICE_ID" >&2
}

require_wait_support() {
  if ! command -v node >/dev/null 2>&1; then
    fail_config "Node.js is required for the smoke callback server and result parser."
  fi
}

autodetect_callback_host() {
  local iface
  local detected=""

  if ! command -v ipconfig >/dev/null 2>&1; then
    printf '%s' ""
    return
  fi

  for iface in en0 en1; do
    detected="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    if [[ -n "$detected" ]]; then
      printf '%s' "$detected"
      return
    fi
  done

  printf '%s' ""
}

resolve_callback_host() {
  local detected

  if [[ -n "$SMOKE_CALLBACK_HOST" ]]; then
    echo "[smoke-ios-device-e2e] callback host: $SMOKE_CALLBACK_HOST"
    return
  fi

  detected="$(autodetect_callback_host)"
  if [[ -n "$detected" ]]; then
    SMOKE_CALLBACK_HOST="$detected"
    echo "[smoke-ios-device-e2e] autodetected callback host: $SMOKE_CALLBACK_HOST"
    return
  fi

  fail_config "SMOKE_CALLBACK_HOST is not set and no en0/en1 IPv4 address was detected. Set SMOKE_CALLBACK_HOST to the Mac IP reachable from the iPhone."
}

list_devices() {
  "$XCRUN" devicectl list devices
  "$XCRUN" xctrace list devices
}

launch_url() {
  local url="$1"
  require_arg "$url" "url"
  resolve_device_id

  echo "[smoke-ios-device-e2e] device: $IOS_DEVICE_ID"
  echo "[smoke-ios-device-e2e] bundle: $IOS_BUNDLE_ID"
  echo "[smoke-ios-device-e2e] url: $url"

  if ! "$XCRUN" devicectl device process launch \
    --timeout "$SMOKE_LAUNCH_TIMEOUT_SECONDS" \
    --device "$IOS_DEVICE_ID" \
    "$IOS_BUNDLE_ID" \
    --payload-url "$url"; then
    fail_launch "Could not launch $IOS_BUNDLE_ID on $IOS_DEVICE_ID. Ensure the smoke app is installed and the bundle id is correct."
  fi
}

run_smoke_node() {
  node - "$@" <<'NODE'
const { spawn } = require('child_process');
const crypto = require('crypto');
const http = require('http');
const net = require('net');
const tls = require('tls');

const EXIT_SMOKE_FAIL = 1;
const EXIT_TIMEOUT = 2;
const EXIT_LAUNCH_FAILURE = 3;
const EXIT_CONFIG = 4;
const MARKER = 'SMOKE:RESULT';
const DEFAULT_CALLBACK_PORT = 49152;
const INSPECTOR_ORIGIN = 'http://localhost:8081';
const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function stringValue(value) {
  return typeof value === 'string' ? value : '';
}

function extractSmokeResult(line) {
  const markerIndex = line.indexOf(MARKER);
  if (markerIndex === -1) {
    return null;
  }

  const jsonStart = line.indexOf('{', markerIndex + MARKER.length);
  if (jsonStart === -1) {
    return { type: 'invalid', reason: 'missing_json', line };
  }

  const jsonEnd = line.lastIndexOf('}');
  if (jsonEnd < jsonStart) {
    return { type: 'invalid', reason: 'unterminated_json', line };
  }

  const raw = line.slice(jsonStart, jsonEnd + 1);
  try {
    return { type: 'result', payload: JSON.parse(raw), raw };
  } catch (error) {
    return {
      type: 'invalid',
      reason: `invalid_json:${error instanceof Error ? error.message : String(error)}`,
      line,
    };
  }
}

function matchesExpected(payload, expected) {
  if (payload == null || payload.scenario !== expected.scenario) {
    return false;
  }

  if (!expected.id) {
    return true;
  }

  const id = stringValue(payload.id);
  const correlationId = stringValue(payload.correlationId);
  return (
    id === expected.id ||
    id === expected.correlationId ||
    correlationId === expected.id ||
    correlationId === expected.correlationId
  );
}

function describeExpected(expected) {
  return `scenario=${expected.scenario}${expected.id ? ` id=${expected.id}` : ''}`;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanFlag(value, fallback) {
  if (value === '1' || value === 'true') {
    return true;
  }

  if (value === '0' || value === 'false') {
    return false;
  }

  return fallback;
}

function parseCallbackPort(value) {
  if (!value) {
    return { port: DEFAULT_CALLBACK_PORT, fixed: false };
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`invalid callback port '${value}'`);
  }

  return { port: parsed, fixed: true };
}

function describeCallbackPort(portConfig) {
  if (portConfig.fixed) {
    return String(portConfig.port);
  }

  return `${portConfig.port}..${Math.min(65535, portConfig.port + 99)} (auto fallback)`;
}

function describeCallbackListenError(error, portConfig) {
  const message = error instanceof Error ? error.message : String(error);
  if (portConfig.fixed && error?.code === 'EADDRINUSE') {
    return `callback port ${portConfig.port} is already in use; unset SMOKE_CALLBACK_PORT to allow fallback ports or choose a free port`;
  }

  return message;
}

function hostForCallbackUrl(host) {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function appendCallbackParam(rawUrl, callbackUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.set('callback', callbackUrl);
    return parsed.toString();
  } catch (error) {
    throw new Error(`invalid smoke deep link '${rawUrl}': ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateCallbackPayload(payload, expected) {
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { type: 'invalid', reason: 'body_not_object' };
  }

  if (!matchesExpected(payload, expected)) {
    return { type: 'mismatch' };
  }

  if (payload.status !== 'PASS' && payload.status !== 'FAIL') {
    return { type: 'invalid', reason: `unsupported_status:${String(payload.status)}` };
  }

  return { type: 'match' };
}

function createCallbackServer(expected, handleMatchedPayload, handleFatalPayload) {
  return http.createServer((request, response) => {
    const path = new URL(request.url || '/', 'http://smoke.callback').pathname;
    if (request.method !== 'POST' || path !== '/result') {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('not found');
      return;
    }

    let body = '';
    request.setEncoding('utf8');

    request.on('data', chunk => {
      body += chunk;
    });

    request.on('error', error => {
      console.error(`[smoke-ios-device-e2e] WARNING: callback request error ${error instanceof Error ? error.message : String(error)}`);
    });

    request.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch (error) {
        response.writeHead(400, { 'Content-Type': 'text/plain' });
        response.end(`invalid json: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }

      const validation = validateCallbackPayload(payload, expected);
      if (validation.type === 'mismatch') {
        console.log(
          `[smoke-ios-device-e2e] ignored callback result scenario=${stringValue(payload.scenario)} id=${stringValue(payload.id)} correlationId=${stringValue(payload.correlationId)}`,
        );
        response.writeHead(202, { 'Content-Type': 'text/plain' });
        response.end('ignored');
        return;
      }

      if (validation.type === 'invalid') {
        console.error(`[smoke-ios-device-e2e] ERROR: invalid matching callback result (${validation.reason})`);
        response.writeHead(422, { 'Content-Type': 'text/plain' });
        response.end(validation.reason, () => handleFatalPayload());
        return;
      }

      console.log(`[smoke-ios-device-e2e] matched callback result ${JSON.stringify(payload)}`);
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('ok', () => handleMatchedPayload(payload));
    });
  });
}

function listenCallbackServer(server, portConfig) {
  return new Promise((resolve, reject) => {
    const firstPort = portConfig.port;
    const lastPort = portConfig.fixed ? firstPort : Math.min(65535, firstPort + 99);
    let port = firstPort;

    const tryListen = () => {
      const handleError = error => {
        server.off('listening', handleListening);

        if (!portConfig.fixed && error?.code === 'EADDRINUSE' && port < lastPort) {
          port += 1;
          tryListen();
          return;
        }

        reject(error);
      };

      const handleListening = () => {
        server.off('error', handleError);
        const address = server.address();
        const actualPort = typeof address === 'object' && address != null ? address.port : port;
        resolve(actualPort);
      };

      server.once('error', handleError);
      server.once('listening', handleListening);
      server.listen(port, '0.0.0.0');
    };

    tryListen();
  });
}

function closeServerAndExit(server, code) {
  const forcedExit = setTimeout(() => process.exit(code), 500);
  forcedExit.unref();
  server.close(() => process.exit(code));
}

function buildDevicectlLaunchArgs({
  launchTimeoutSeconds,
  deviceId,
  bundleId,
  launchUrl,
  terminateExisting,
}) {
  const launchArgs = [
    'devicectl',
    'device',
    'process',
    'launch',
    '--timeout',
    String(launchTimeoutSeconds),
    '--device',
    deviceId,
  ];

  if (terminateExisting) {
    launchArgs.push('--terminate-existing');
  }

  launchArgs.push(
    bundleId,
    '--payload-url',
    launchUrl,
  );

  return launchArgs;
}

function metroPageLabel(page) {
  return [
    page?.appId,
    page?.description,
    page?.title,
    page?.id,
  ]
    .map(value => (typeof value === 'string' && value.length > 0 ? value : null))
    .filter(Boolean)
    .join(' ');
}

function selectMetroInspectorPage(pages, bundleId) {
  const candidates = (Array.isArray(pages) ? pages : []).filter(
    page => typeof page?.webSocketDebuggerUrl === 'string' && page.webSocketDebuggerUrl.length > 0,
  );

  const exact = candidates.find(page => page?.appId === bundleId);
  if (exact) {
    return { page: exact, reason: 'appId' };
  }

  const descriptive = candidates.find(page => metroPageLabel(page).includes(bundleId));
  if (descriptive) {
    return { page: descriptive, reason: 'description' };
  }

  if (candidates.length === 1) {
    return { page: candidates[0], reason: 'single_inspector_page' };
  }

  const available = candidates.map(page => metroPageLabel(page) || page.webSocketDebuggerUrl).join('; ');
  return {
    page: null,
    reason: available.length > 0 ? `available_pages=${available}` : 'no_inspector_pages',
  };
}

function createWebSocketUpgradeRequest(target, key, origin) {
  const path = `${target.pathname || '/'}${target.search || ''}`;
  return [
    `GET ${path} HTTP/1.1`,
    `Host: ${target.host}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13',
    `Origin: ${origin}`,
    '',
    '',
  ].join('\r\n');
}

function expectedWebSocketAccept(key) {
  return crypto.createHash('sha1').update(`${key}${WEBSOCKET_GUID}`).digest('base64');
}

function createClientWebSocketFrame(opcode, payload) {
  const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const length = payloadBuffer.length;
  const lengthBytes = length < 126 ? 0 : length <= 0xffff ? 2 : 8;
  const frame = Buffer.alloc(2 + lengthBytes + 4 + length);
  let offset = 0;

  frame[offset++] = 0x80 | opcode;
  if (length < 126) {
    frame[offset++] = 0x80 | length;
  } else if (length <= 0xffff) {
    frame[offset++] = 0x80 | 126;
    frame.writeUInt16BE(length, offset);
    offset += 2;
  } else {
    frame[offset++] = 0x80 | 127;
    frame.writeUInt32BE(Math.floor(length / 0x100000000), offset);
    frame.writeUInt32BE(length >>> 0, offset + 4);
    offset += 8;
  }

  const mask = crypto.randomBytes(4);
  mask.copy(frame, offset);
  offset += 4;

  for (let index = 0; index < length; index += 1) {
    frame[offset + index] = payloadBuffer[index] ^ mask[index % 4];
  }

  return frame;
}

function readWebSocketFrame(buffer) {
  if (buffer.length < 2) {
    return null;
  }

  const first = buffer[0];
  const second = buffer[1];
  const fin = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < offset + 2) {
      return null;
    }
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) {
      return null;
    }
    const high = buffer.readUInt32BE(offset);
    const low = buffer.readUInt32BE(offset + 4);
    length = high * 0x100000000 + low;
    offset += 8;
  }

  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + length) {
    return null;
  }

  let payload = buffer.subarray(offset + maskLength, offset + maskLength + length);
  if (masked) {
    const mask = buffer.subarray(offset, offset + 4);
    payload = Buffer.from(payload);
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }

  return {
    frame: { fin, opcode, payload },
    remaining: buffer.subarray(offset + maskLength + length),
  };
}

function parseHandshakeHeaders(rawHeaders) {
  return rawHeaders
    .split('\r\n')
    .slice(1)
    .reduce((headers, line) => {
      const separator = line.indexOf(':');
      if (separator === -1) {
        return headers;
      }

      headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
      return headers;
    }, {});
}

function sendInspectorMessage(wsUrl, message, isExpectedMessage) {
  return new Promise((resolve, reject) => {
    const target = new URL(wsUrl);
    const secure = target.protocol === 'wss:';
    if (!secure && target.protocol !== 'ws:') {
      reject(new Error(`unsupported Metro inspector WebSocket protocol ${target.protocol}`));
      return;
    }

    const key = crypto.randomBytes(16).toString('base64');
    const port = Number.parseInt(target.port || (secure ? '443' : '80'), 10);
    const connectOptions = {
      host: target.hostname,
      port,
      servername: target.hostname,
    };
    const socket = secure ? tls.connect(connectOptions) : net.connect(connectOptions);
    let buffer = Buffer.alloc(0);
    let handshakeComplete = false;
    let settled = false;
    let fragments = [];

    const timer = setTimeout(() => {
      fail(new Error('Metro inspector openURL dispatch timed out'));
    }, 5000);

    function cleanup() {
      clearTimeout(timer);
      socket.removeAllListeners();
    }

    function fail(error) {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    }

    function succeed(value) {
      if (settled) {
        return;
      }

      settled = true;
      try {
        socket.write(createClientWebSocketFrame(0x8, Buffer.alloc(0)));
      } catch {
        // Ignore close-frame failures; the inspector command already completed.
      }
      cleanup();
      socket.end();
      resolve(value);
    }

    function handleTextMessage(text) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }

      if (isExpectedMessage(parsed)) {
        succeed(parsed);
      }
    }

    socket.on(secure ? 'secureConnect' : 'connect', () => {
      socket.write(createWebSocketUpgradeRequest(target, key, INSPECTOR_ORIGIN));
    });

    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);

      if (!handshakeComplete) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) {
          return;
        }

        const rawHeaders = buffer.subarray(0, headerEnd).toString('utf8');
        const statusLine = rawHeaders.split('\r\n')[0] || '';
        if (!/^HTTP\/1\.[01] 101\b/.test(statusLine)) {
          fail(new Error(`Metro inspector websocket handshake failed: ${statusLine || '<empty>'}`));
          return;
        }

        const headers = parseHandshakeHeaders(rawHeaders);
        if (headers['sec-websocket-accept'] !== expectedWebSocketAccept(key)) {
          fail(new Error('Metro inspector websocket handshake failed: invalid Sec-WebSocket-Accept'));
          return;
        }

        handshakeComplete = true;
        buffer = buffer.subarray(headerEnd + 4);
        socket.write(createClientWebSocketFrame(0x1, JSON.stringify(message)));
      }

      while (buffer.length > 0) {
        let parsedFrame;
        try {
          parsedFrame = readWebSocketFrame(buffer);
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
          return;
        }

        if (parsedFrame == null) {
          return;
        }

        buffer = parsedFrame.remaining;
        const { frame } = parsedFrame;

        if (frame.opcode === 0x8) {
          fail(new Error('Metro inspector websocket closed before Runtime.evaluate response'));
          return;
        }

        if (frame.opcode === 0x9) {
          socket.write(createClientWebSocketFrame(0xA, frame.payload));
          continue;
        }

        if (frame.opcode === 0x1 || frame.opcode === 0x0) {
          fragments.push(frame.payload);
          if (frame.fin) {
            const text = Buffer.concat(fragments).toString('utf8');
            fragments = [];
            handleTextMessage(text);
            if (settled) {
              return;
            }
          }
        }
      }
    });

    socket.on('error', fail);
    socket.on('end', () => {
      fail(new Error('Metro inspector websocket ended before Runtime.evaluate response'));
    });
  });
}

async function dispatchDeepLinkViaInspector(launchUrl, bundleId) {
  if (typeof fetch !== 'function') {
    throw new Error('Node.js fetch global is unavailable');
  }

  const response = await fetch('http://localhost:8081/json/list');
  if (!response.ok) {
    throw new Error(`Metro inspector list failed HTTP ${response.status}`);
  }

  const pages = await response.json();
  const selection = selectMetroInspectorPage(pages, bundleId);
  const page = selection.page;
  if (!page?.webSocketDebuggerUrl) {
    throw new Error(`Metro inspector page not found for ${bundleId}; ${selection.reason}`);
  }

  const wsUrl = page.webSocketDebuggerUrl.replace('localhost', '127.0.0.1');
  const expression = `(() => {
    const smokeHandler = globalThis.__NOTIFEE_SMOKE_HANDLE_URL__;
    if (typeof smokeHandler === 'function') {
      return smokeHandler(${JSON.stringify(launchUrl)});
    }
    const modules = Array.from(globalThis.__r?.getModules?.() ?? []);
    const entry = modules.find(([, module]) => {
      const name = String(module?.verboseName || module?.path || '');
      return name === 'node_modules/react-native/index.js' || name.endsWith('/node_modules/react-native/index.js');
    });
    if (!entry) {
      throw new Error('react_native_module_not_found');
    }
    const reactNative = globalThis.__r(entry[0]);
    return reactNative.Linking.openURL(${JSON.stringify(launchUrl)});
  })()`;

  const messageId = 1;
  const message = await sendInspectorMessage(
    wsUrl,
    {
      id: messageId,
      method: 'Runtime.evaluate',
      params: {
        expression,
        awaitPromise: true,
        returnByValue: true,
      },
    },
    candidate => candidate?.id === messageId,
  );

  if (message.error || message.result?.exceptionDetails) {
    throw new Error(JSON.stringify(message.error || message.result.exceptionDetails));
  }

  console.log(
    `[smoke-ios-device-e2e] deep link fallback: Metro inspector dispatched via ${selection.reason}`,
  );
}

async function preflightMetroInspector(bundleId) {
  if (typeof fetch !== 'function') {
    return { available: false, reason: 'Node.js fetch global is unavailable' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try {
    const response = await fetch('http://localhost:8081/json/list', { signal: controller.signal });
    if (!response.ok) {
      return { available: false, reason: `HTTP ${response.status}` };
    }

    const pages = await response.json();
    const selection = selectMetroInspectorPage(pages, bundleId);
    return {
      available: true,
      hasBundlePage: selection.page != null,
      selectionReason: selection.reason,
    };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function waitCallback(args) {
  const [
    scenario,
    expectedId,
    expectedCorrelationId,
    timeoutArg,
    xcrun,
    deviceId,
    bundleId,
    baseUrl,
    callbackHost,
    callbackPortArg,
    launchTimeoutArg,
    terminateExistingArg,
  ] = args;

  if (!scenario || !xcrun || !deviceId || !bundleId || !baseUrl || !callbackHost) {
    console.error('[smoke-ios-device-e2e] ERROR: missing wait-callback configuration');
    process.exit(EXIT_CONFIG);
  }

  const timeoutSeconds = parsePositiveInteger(timeoutArg, 45);
  const launchTimeoutSeconds = parsePositiveInteger(launchTimeoutArg, 15);
  const terminateExisting = parseBooleanFlag(terminateExistingArg, true);
  const expected = {
    scenario,
    id: expectedId || '',
    correlationId: expectedCorrelationId || expectedId || '',
  };
  const portConfig = parseCallbackPort(callbackPortArg);
  const fallbackSeconds = parsePositiveInteger(process.env.SMOKE_INSPECTOR_DEEPLINK_FALLBACK_SECONDS, 2);

  let finished = false;
  let launchClosed = false;
  let child = null;
  let timer = null;
  let inspectorFallbackTimer = null;

  async function dispatchInspectorFallbackOrFail(server, reason) {
    console.error(`[smoke-ios-device-e2e] WARNING: ${reason}`);
    try {
      await dispatchDeepLinkViaInspector(launchUrl, bundleId);
    } catch (error) {
      console.error(
        `[smoke-ios-device-e2e] ERROR: non_terminating_deeplink_dispatch_failed ${error instanceof Error ? error.message : String(error)}`,
      );
      finish(server, EXIT_LAUNCH_FAILURE);
    }
  }

  function finish(server, code) {
    if (finished) {
      return;
    }

    finished = true;
    if (timer != null) {
      clearTimeout(timer);
    }
    if (inspectorFallbackTimer != null) {
      clearTimeout(inspectorFallbackTimer);
    }
    if (child != null && !launchClosed && child.exitCode == null) {
      child.kill('SIGTERM');
    }
    closeServerAndExit(server, code);
  }

  const server = createCallbackServer(
    expected,
    payload => {
      if (payload.status === 'PASS') {
        console.log('[smoke-ios-device-e2e] result: PASS');
        finish(server, 0);
        return;
      }

      console.error(`[smoke-ios-device-e2e] result: FAIL reason=${stringValue(payload.reason) || 'unknown'}`);
      finish(server, EXIT_SMOKE_FAIL);
    },
    () => finish(server, EXIT_CONFIG),
  );

  let actualPort;
  try {
    actualPort = await listenCallbackServer(server, portConfig);
  } catch (error) {
    console.error(`[smoke-ios-device-e2e] ERROR: callback_server_listen_failed ${describeCallbackListenError(error, portConfig)}`);
    process.exit(EXIT_CONFIG);
  }

  const callbackUrl = `http://${hostForCallbackUrl(callbackHost)}:${actualPort}/result`;
  const launchUrl = appendCallbackParam(baseUrl, callbackUrl);
  const launchArgs = buildDevicectlLaunchArgs({
    launchTimeoutSeconds,
    deviceId,
    bundleId,
    launchUrl,
    terminateExisting,
  });

  console.log(`[smoke-ios-device-e2e] device: ${deviceId}`);
  console.log(`[smoke-ios-device-e2e] bundle: ${bundleId}`);
  console.log(`[smoke-ios-device-e2e] callback host: ${callbackHost}`);
  console.log(`[smoke-ios-device-e2e] callback port: ${describeCallbackPort(portConfig)} selected=${actualPort}`);
  console.log(`[smoke-ios-device-e2e] callback: ${callbackUrl}`);
  console.log(`[smoke-ios-device-e2e] url: ${launchUrl}`);
  console.log(
    `[smoke-ios-device-e2e] launch mode: ${terminateExisting ? 'terminate existing app process before payload URL launch' : 'preserve existing app process; no devicectl --terminate-existing'}`,
  );
  if (!terminateExisting) {
    console.log('[smoke-ios-device-e2e] non-terminating mode: keep the app running from Xcode if attached; Metro inspector may be used if devicectl cannot dispatch the URL.');
  }
  console.log('[smoke-ios-device-e2e] result capture: HTTP callback POST /result');
  console.log(`[smoke-ios-device-e2e] waiting for callback result ${describeExpected(expected)} timeout=${timeoutSeconds}s`);

  if (fallbackSeconds > 0) {
    preflightMetroInspector(bundleId).then(status => {
      if (status.available) {
        console.log(
          `[smoke-ios-device-e2e] Metro inspector fallback preflight: available${status.hasBundlePage ? ` with app page (${status.selectionReason})` : `; matching app page not found yet (${status.selectionReason})`}`,
        );
        return;
      }

      console.log(`[smoke-ios-device-e2e] Metro inspector fallback preflight: unavailable (${status.reason})`);
    });
  }

  timer = setTimeout(() => {
    console.error(
      `[smoke-ios-device-e2e] ERROR: timeout_waiting_for_callback_result ${describeExpected(expected)} timeout=${timeoutSeconds}s`,
    );
    finish(server, EXIT_TIMEOUT);
  }, timeoutSeconds * 1000);

  child = spawn(xcrun, launchArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    const text = String(chunk).trim();
    if (text.length > 0) {
      console.log(`[smoke-ios-device-e2e] devicectl stdout: ${text}`);
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => {
    const text = String(chunk).trim();
    if (text.length > 0) {
      console.error(`[smoke-ios-device-e2e] devicectl stderr: ${text}`);
    }
  });

  child.on('error', error => {
    console.error(`[smoke-ios-device-e2e] ERROR: launch_failed ${error instanceof Error ? error.message : String(error)}`);
    finish(server, EXIT_LAUNCH_FAILURE);
  });

  child.on('close', code => {
    launchClosed = true;
    if (finished) {
      return;
    }

    if (code !== 0) {
      if (!terminateExisting) {
        console.error(`[smoke-ios-device-e2e] WARNING: launch_failed exit_code=${code}`);
        void dispatchInspectorFallbackOrFail(
          server,
          'devicectl payload-url launch failed in non-terminating mode; trying Metro inspector fallback before failing',
        );
        return;
      }
      console.error(`[smoke-ios-device-e2e] ERROR: launch_failed exit_code=${code}`);
      finish(server, EXIT_LAUNCH_FAILURE);
      return;
    }

    inspectorFallbackTimer = setTimeout(() => {
      if (finished) {
        return;
      }

      dispatchDeepLinkViaInspector(launchUrl, bundleId).catch(error => {
        console.error(
          `[smoke-ios-device-e2e] WARNING: deep_link_inspector_fallback_failed ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, fallbackSeconds * 1000);
  });
}

async function runCallbackTest(args) {
  const [timeoutArg, callbackPortArg] = args;
  const timeoutSeconds = parsePositiveInteger(timeoutArg, 5);
  const expected = {
    scenario: 'callback-test',
    id: 'smoke-callback-test',
    correlationId: 'callback-test',
  };

  let finished = false;
  let timer = null;

  function finish(server, code) {
    if (finished) {
      return;
    }

    finished = true;
    if (timer != null) {
      clearTimeout(timer);
    }
    closeServerAndExit(server, code);
  }

  const server = createCallbackServer(
    expected,
    payload => {
      console.log(`[smoke-ios-device-e2e] callback static test received ${payload.status}`);
      finish(server, payload.status === 'PASS' ? 0 : EXIT_SMOKE_FAIL);
    },
    () => finish(server, EXIT_CONFIG),
  );

  let actualPort;
  try {
    actualPort = await listenCallbackServer(server, parseCallbackPort(callbackPortArg));
  } catch (error) {
    console.error(`[smoke-ios-device-e2e] ERROR: callback_test_listen_failed ${error instanceof Error ? error.message : String(error)}`);
    process.exit(EXIT_CONFIG);
  }

  const callbackUrl = `http://127.0.0.1:${actualPort}/result`;
  timer = setTimeout(() => {
    console.error(`[smoke-ios-device-e2e] ERROR: callback_test_timeout timeout=${timeoutSeconds}s`);
    finish(server, EXIT_TIMEOUT);
  }, timeoutSeconds * 1000);

  const body = JSON.stringify({
    scenario: expected.scenario,
    status: 'PASS',
    timestamp: new Date().toISOString(),
    id: expected.id,
    correlationId: expected.correlationId,
  });
  const request = http.request(callbackUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  });

  request.on('error', error => {
    console.error(`[smoke-ios-device-e2e] ERROR: callback_test_post_failed ${error instanceof Error ? error.message : String(error)}`);
    finish(server, EXIT_CONFIG);
  });
  request.on('response', response => {
    response.resume();
  });
  request.end(body);
}

function runParserTest() {
  const cases = [
    {
      name: 'PASS valido',
      expected: { scenario: 'displayed', id: '', correlationId: '' },
      line: '2026-05-06 SMOKE:RESULT {"scenario":"displayed","status":"PASS","timestamp":"2026-05-06T00:00:00.000Z","count":1}',
      expectedStatus: 'PASS',
      expectedMatch: true,
    },
    {
      name: 'FAIL valido',
      expected: { scenario: 'verify-displayed', id: 'smoke-abc', correlationId: 'abc' },
      line: 'SMOKE:RESULT {"scenario":"verify-displayed","status":"FAIL","timestamp":"2026-05-06T00:00:00.000Z","id":"smoke-abc","correlationId":"abc","reason":"not_found"}',
      expectedStatus: 'FAIL',
      expectedMatch: true,
    },
    {
      name: 'riga senza marker',
      expected: { scenario: 'displayed', id: '', correlationId: '' },
      line: 'some unrelated log line',
      expectedNoResult: true,
    },
    {
      name: 'JSON invalido',
      expected: { scenario: 'displayed', id: '', correlationId: '' },
      line: 'SMOKE:RESULT {"scenario":"displayed","status":',
      expectedInvalid: true,
    },
    {
      name: 'stesso scenario con id diverso',
      expected: { scenario: 'verify-displayed', id: 'smoke-abc', correlationId: 'abc' },
      line: 'SMOKE:RESULT {"scenario":"verify-displayed","status":"PASS","timestamp":"2026-05-06T00:00:00.000Z","id":"smoke-other"}',
      expectedMatch: false,
    },
    {
      name: 'correlationId diverso',
      expected: { scenario: 'verify-displayed', id: 'smoke-abc', correlationId: 'abc' },
      line: 'SMOKE:RESULT {"scenario":"verify-displayed","status":"PASS","timestamp":"2026-05-06T00:00:00.000Z","correlationId":"other"}',
      expectedMatch: false,
    },
    {
      name: 'id normalizzato',
      expected: { scenario: 'verify-displayed', id: 'abc', correlationId: '' },
      line: 'SMOKE:RESULT {"scenario":"verify-displayed","status":"PASS","timestamp":"2026-05-06T00:00:00.000Z","id":"smoke-abc","correlationId":"abc"}',
      expectedStatus: 'PASS',
      expectedMatch: true,
    },
  ];

  for (const testCase of cases) {
    const parsed = extractSmokeResult(testCase.line);

    if (testCase.expectedNoResult) {
      if (parsed !== null) {
        console.error(`[smoke-ios-device-e2e] parser test failed: ${testCase.name} should not parse`);
        process.exit(1);
      }
      continue;
    }

    if (testCase.expectedInvalid) {
      if (parsed?.type !== 'invalid') {
        console.error(`[smoke-ios-device-e2e] parser test failed: ${testCase.name} should be ignored as invalid`);
        process.exit(1);
      }
      continue;
    }

    if (parsed?.type !== 'result') {
      console.error(`[smoke-ios-device-e2e] parser test failed: ${testCase.name} did not parse as result`);
      process.exit(1);
    }

    const matched = matchesExpected(parsed.payload, testCase.expected);
    if (matched !== testCase.expectedMatch) {
      console.error(`[smoke-ios-device-e2e] parser test failed: ${testCase.name} match=${matched}`);
      process.exit(1);
    }

    if (testCase.expectedStatus && parsed.payload.status !== testCase.expectedStatus) {
      console.error(`[smoke-ios-device-e2e] parser test failed: ${testCase.name} status mismatch`);
      process.exit(1);
    }
  }

  const callbackCases = [
    {
      name: 'callback PASS valido',
      expected: { scenario: 'local-display', id: 'smoke-abc', correlationId: 'abc' },
      payload: {
        scenario: 'local-display',
        status: 'PASS',
        timestamp: '2026-05-06T00:00:00.000Z',
        id: 'smoke-abc',
        correlationId: 'abc',
      },
      expectedValidation: 'match',
    },
    {
      name: 'callback scenario diverso',
      expected: { scenario: 'verify-displayed', id: 'smoke-abc', correlationId: 'abc' },
      payload: {
        scenario: 'local-display',
        status: 'PASS',
        timestamp: '2026-05-06T00:00:00.000Z',
        id: 'smoke-abc',
        correlationId: 'abc',
      },
      expectedValidation: 'mismatch',
    },
    {
      name: 'callback status non supportato',
      expected: { scenario: 'local-display', id: 'smoke-abc', correlationId: 'abc' },
      payload: {
        scenario: 'local-display',
        status: 'UNKNOWN',
        timestamp: '2026-05-06T00:00:00.000Z',
        id: 'smoke-abc',
        correlationId: 'abc',
      },
      expectedValidation: 'invalid',
    },
    {
      name: 'callback listener-only PASS valido',
      expected: { scenario: 'listener-only', id: '', correlationId: '' },
      payload: {
        scenario: 'listener-only',
        status: 'PASS',
        timestamp: '2026-05-06T00:00:00.000Z',
        details: {
          foregroundListenerRegistered: true,
          backgroundHandlerRegistered: true,
          nativeCallIntentionallyAvoided: true,
        },
      },
      expectedValidation: 'match',
    },
  ];

  for (const testCase of callbackCases) {
    const validation = validateCallbackPayload(testCase.payload, testCase.expected);
    if (validation.type !== testCase.expectedValidation) {
      console.error(`[smoke-ios-device-e2e] callback parser test failed: ${testCase.name} validation=${validation.type}`);
      process.exit(1);
    }
  }

  const callbackUrl = 'http://192.0.2.10:49152/result';
  const listenerLaunchUrl = appendCallbackParam('notifykit://smoke/run/listener-only', callbackUrl);
  const parsedListenerUrl = new URL(listenerLaunchUrl);
  if (
    parsedListenerUrl.protocol !== 'notifykit:' ||
    parsedListenerUrl.host !== 'smoke' ||
    parsedListenerUrl.pathname !== '/run/listener-only' ||
    parsedListenerUrl.searchParams.get('callback') !== callbackUrl
  ) {
    console.error(`[smoke-ios-device-e2e] listener-only URL static test failed: ${listenerLaunchUrl}`);
    process.exit(1);
  }

  const localDisplayUrl = appendCallbackParam('notifykit://smoke/run/local-display?id=abc', callbackUrl);
  const parsedLocalDisplayUrl = new URL(localDisplayUrl);
  if (
    parsedLocalDisplayUrl.host !== 'smoke' ||
    parsedLocalDisplayUrl.pathname !== '/run/local-display' ||
    parsedLocalDisplayUrl.searchParams.get('id') !== 'abc' ||
    parsedLocalDisplayUrl.searchParams.get('callback') !== callbackUrl
  ) {
    console.error(`[smoke-ios-device-e2e] local-display URL static test failed: ${localDisplayUrl}`);
    process.exit(1);
  }

  const nonTerminatingArgs = buildDevicectlLaunchArgs({
    launchTimeoutSeconds: 15,
    deviceId: 'device',
    bundleId: 'bundle',
    launchUrl: listenerLaunchUrl,
    terminateExisting: false,
  });
  if (nonTerminatingArgs.includes('--terminate-existing')) {
    console.error('[smoke-ios-device-e2e] no-terminate static test failed: unexpected --terminate-existing');
    process.exit(1);
  }

  const terminatingArgs = buildDevicectlLaunchArgs({
    launchTimeoutSeconds: 15,
    deviceId: 'device',
    bundleId: 'bundle',
    launchUrl: listenerLaunchUrl,
    terminateExisting: true,
  });
  if (!terminatingArgs.includes('--terminate-existing')) {
    console.error('[smoke-ios-device-e2e] terminate static test failed: missing --terminate-existing');
    process.exit(1);
  }

  const selectedPage = selectMetroInspectorPage(
    [{ appId: 'org.reactjs.native.example.NotifeeExample', webSocketDebuggerUrl: 'ws://localhost:8081/inspector/debug?page=1' }],
    'org.reactjs.native.example.NotifeeExample',
  );
  if (selectedPage.page == null || selectedPage.reason !== 'appId') {
    console.error('[smoke-ios-device-e2e] Metro inspector page selection static test failed');
    process.exit(1);
  }

  const upgradeRequest = createWebSocketUpgradeRequest(
    new URL('ws://127.0.0.1:8081/inspector/debug?page=1'),
    'dGhlIHNhbXBsZSBub25jZQ==',
    INSPECTOR_ORIGIN,
  );
  if (!upgradeRequest.includes('\r\nOrigin: http://localhost:8081\r\n')) {
    console.error('[smoke-ios-device-e2e] Metro inspector Origin static test failed');
    process.exit(1);
  }

  console.log(
    `[smoke-ios-device-e2e] parser static test: PASS (${cases.length} log cases, ${callbackCases.length} callback cases, URL/launch/fallback cases)`,
  );
}

const [mode, ...args] = process.argv.slice(2);

if (mode === 'wait-console') {
  console.error('[smoke-ios-device-e2e] ERROR: wait-console is no longer supported; use wait-callback');
  process.exit(EXIT_CONFIG);
} else if (mode === 'wait-callback') {
  waitCallback(args).catch(error => {
    console.error(`[smoke-ios-device-e2e] ERROR: wait_callback_failed ${error instanceof Error ? error.message : String(error)}`);
    process.exit(EXIT_CONFIG);
  });
} else if (mode === 'parse-result-test') {
  runParserTest();
} else if (mode === 'callback-test') {
  runCallbackTest(args).catch(error => {
    console.error(`[smoke-ios-device-e2e] ERROR: callback_test_failed ${error instanceof Error ? error.message : String(error)}`);
    process.exit(EXIT_CONFIG);
  });
} else {
  console.error(`[smoke-ios-device-e2e] ERROR: unknown node mode ${mode || '<empty>'}`);
  process.exit(EXIT_CONFIG);
}
NODE
}

wait_for_smoke_result_via_callback() {
  local scenario="$1"
  local expected_id="${2:-}"
  local expected_correlation_id="${3:-}"
  local url="$4"

  require_wait_support
  resolve_device_id
  resolve_callback_host

  run_smoke_node wait-callback \
    "$scenario" \
    "$expected_id" \
    "$expected_correlation_id" \
    "$SMOKE_TIMEOUT_SECONDS" \
    "$XCRUN" \
    "$IOS_DEVICE_ID" \
    "$IOS_BUNDLE_ID" \
    "$url" \
    "$SMOKE_CALLBACK_HOST" \
    "$SMOKE_CALLBACK_PORT" \
    "$SMOKE_LAUNCH_TIMEOUT_SECONDS" \
    "$SMOKE_TERMINATE_EXISTING"
}

launch_smoke_run() {
  local scenario="$1"
  local url="notifykit://smoke/run/$scenario"

  wait_for_smoke_result_via_callback "$scenario" "" "" "$url"
}

listener_only() {
  launch_smoke_run "listener-only"
}

local_display() {
  local id="$1"
  local expected_id
  local url

  require_arg "$id" "id"
  expected_id="$(smoke_notification_id_for "$id")"
  url="notifykit://smoke/run/local-display?id=$(urlencode "$id")"

  wait_for_smoke_result_via_callback "local-display" "$expected_id" "$id" "$url"
}

verify_displayed() {
  local id="$1"
  local expected_id
  local url

  require_arg "$id" "id"
  expected_id="$(smoke_notification_id_for "$id")"
  url="notifykit://smoke/verify/displayed?id=$(urlencode "$id")"

  wait_for_smoke_result_via_callback "verify-displayed" "$expected_id" "$id" "$url"
}

resolve_fcm_token() {
  if [[ -n "${IOS_FCM_TOKEN:-}" ]]; then
    printf '%s' "$IOS_FCM_TOKEN"
    return
  fi

  if [[ -n "${FCM_TOKEN:-}" ]]; then
    printf '%s' "$FCM_TOKEN"
    return
  fi

  printf '%s' ""
}

resolve_fcm_attachment_wait_seconds() {
  if [[ -n "$SMOKE_FCM_ATTACHMENT_WAIT_SECONDS_ENV" ]]; then
    printf '%s' "$SMOKE_FCM_ATTACHMENT_WAIT_SECONDS_ENV"
    return
  fi

  if [[ -n "$SMOKE_FCM_WAIT_SECONDS_ENV" ]]; then
    printf '%s' "$SMOKE_FCM_WAIT_SECONDS_ENV"
    return
  fi

  printf '%s' "12"
}

require_callback_port_config() {
  local port="$SMOKE_CALLBACK_PORT"

  if [[ -z "$SMOKE_CALLBACK_PORT" ]]; then
    return
  fi

  if [[ ! "$port" =~ ^[0-9]+$ ]] || ((10#$port < 1 || 10#$port > 65535)); then
    fail_config "SMOKE_CALLBACK_PORT must be an integer from 1 to 65535."
  fi
}

validate_global_options() {
  case "$SMOKE_TERMINATE_EXISTING" in
    0 | 1 | true | false)
      ;;
    *)
      fail_config "SMOKE_TERMINATE_EXISTING must be 1, 0, true, or false."
      ;;
  esac
}

require_fcm_verify_config() {
  require_wait_support
  require_arg "$IOS_BUNDLE_ID" "IOS_BUNDLE_ID"
  require_callback_port_config
  resolve_device_id
  resolve_callback_host
}

fcm_minimal() {
  local id="$1"
  local token

  require_arg "$id" "id"
  require_non_negative_integer "$SMOKE_FCM_WAIT_SECONDS" "SMOKE_FCM_WAIT_SECONDS"

  token="$(resolve_fcm_token)"
  if [[ -z "$token" ]]; then
    fail_config "Missing IOS_FCM_TOKEN or FCM_TOKEN for fcm-minimal."
  fi

  if [[ ! -f "$REPO_ROOT/firebase-notifykittest.json" ]]; then
    fail_config "Missing firebase-notifykittest.json in repo root."
  fi

  if ! command -v node >/dev/null 2>&1; then
    fail_config "Node.js is required to send fcm-minimal."
  fi

  echo "[smoke-ios-device-e2e] sending FCM minimal correlationId=$id"
  (
    cd "$REPO_ROOT"
    IOS_FCM_TOKEN="$token" node scripts/send-test-fcm.js minimal --correlation-id "$id"
  )

  if ((SMOKE_FCM_WAIT_SECONDS > 0)); then
    echo "[smoke-ios-device-e2e] waiting ${SMOKE_FCM_WAIT_SECONDS}s before verify-displayed"
    sleep "$SMOKE_FCM_WAIT_SECONDS"
  fi

  verify_displayed "$id"
}

fcm_ios_attachment() {
  local id="$1"
  local token
  local wait_seconds

  require_arg "$id" "id"
  wait_seconds="$(resolve_fcm_attachment_wait_seconds)"
  require_non_negative_integer "$wait_seconds" "SMOKE_FCM_ATTACHMENT_WAIT_SECONDS or SMOKE_FCM_WAIT_SECONDS"
  wait_seconds=$((10#$wait_seconds))

  token="$(resolve_fcm_token)"
  if [[ -z "$token" ]]; then
    fail_config "Missing IOS_FCM_TOKEN or FCM_TOKEN for fcm-ios-attachment."
  fi

  if [[ ! -f "$REPO_ROOT/firebase-notifykittest.json" ]]; then
    fail_config "Missing firebase-notifykittest.json in repo root."
  fi

  if ! command -v node >/dev/null 2>&1; then
    fail_config "Node.js is required to send fcm-ios-attachment."
  fi

  require_fcm_verify_config

  echo "[smoke-ios-device-e2e] sending FCM ios-attachment correlationId=$id"
  (
    cd "$REPO_ROOT"
    IOS_FCM_TOKEN="$token" node scripts/send-test-fcm.js ios-attachment --correlation-id "$id"
  )

  if ((wait_seconds > 0)); then
    echo "[smoke-ios-device-e2e] waiting ${wait_seconds}s before verify-displayed"
    sleep "$wait_seconds"
  fi

  verify_displayed "$id"
}

parse_result_test() {
  if ! command -v node >/dev/null 2>&1; then
    fail_config "Node.js is required to run parse-result-test."
  fi

  run_smoke_node parse-result-test
}

callback_test() {
  if ! command -v node >/dev/null 2>&1; then
    fail_config "Node.js is required to run callback-test."
  fi

  run_smoke_node callback-test "$SMOKE_TIMEOUT_SECONDS" "$SMOKE_CALLBACK_PORT"
}

main() {
  local command=""
  local args=()

  while (($# > 0)); do
    case "$1" in
      --no-terminate-existing)
        SMOKE_TERMINATE_EXISTING=0
        ;;
      --terminate-existing)
        SMOKE_TERMINATE_EXISTING=1
        ;;
      -h | --help)
        if [[ -z "$command" ]]; then
          command="help"
        else
          args+=("$1")
        fi
        ;;
      --)
        shift
        if [[ -z "$command" && $# -gt 0 ]]; then
          command="$1"
          shift
        fi
        while (($# > 0)); do
          args+=("$1")
          shift
        done
        break
        ;;
      --*)
        fail_config "Unknown option: $1"
        ;;
      *)
        if [[ -z "$command" ]]; then
          command="$1"
        else
          args+=("$1")
        fi
        ;;
    esac
    shift
  done

  command="${command:-help}"
  validate_global_options

  case "$command" in
    "" | -h | --help | help)
      usage
      ;;
    list-devices)
      list_devices
      ;;
    launch-url)
      launch_url "${args[0]:-}"
      ;;
    parse-result-test)
      parse_result_test
      ;;
    callback-test)
      callback_test
      ;;
    fcm-token)
      launch_smoke_run "fcm-token"
      ;;
    displayed)
      launch_smoke_run "displayed"
      ;;
    listener-only)
      listener_only
      ;;
    local-display)
      local_display "${args[0]:-}"
      ;;
    verify-displayed)
      verify_displayed "${args[0]:-}"
      ;;
    fcm-minimal)
      fcm_minimal "${args[0]:-}"
      ;;
    fcm-ios-attachment)
      fcm_ios_attachment "${args[0]:-}"
      ;;
    *)
      echo "Unknown command: $command" >&2
      usage >&2
      exit "$EXIT_CONFIG"
      ;;
  esac
}

main "$@"
