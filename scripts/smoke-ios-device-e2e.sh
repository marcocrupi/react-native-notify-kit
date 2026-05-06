#!/usr/bin/env bash
set -euo pipefail

DEFAULT_IOS_DEVICE_ID="C274F5E5-B73D-556F-9589-E384F79EF805"
IOS_DEVICE_ID="${IOS_DEVICE_ID:-}"
IOS_BUNDLE_ID="${IOS_BUNDLE_ID:-org.reactjs.native.example.NotifeeExample}"
SMOKE_TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS:-45}"
SMOKE_LAUNCH_TIMEOUT_SECONDS="${SMOKE_LAUNCH_TIMEOUT_SECONDS:-15}"
SMOKE_INSPECTOR_DEEPLINK_FALLBACK_SECONDS="${SMOKE_INSPECTOR_DEEPLINK_FALLBACK_SECONDS:-2}"
SMOKE_CALLBACK_HOST="${SMOKE_CALLBACK_HOST:-}"
SMOKE_CALLBACK_PORT="${SMOKE_CALLBACK_PORT:-}"
XCRUN="${XCRUN:-xcrun}"

EXIT_SMOKE_FAIL=1
EXIT_TIMEOUT=2
EXIT_LAUNCH_FAILURE=3
EXIT_CONFIG=4

usage() {
  local device_help
  device_help="${IOS_DEVICE_ID:-<auto-detect; fallback: $DEFAULT_IOS_DEVICE_ID>}"

  cat <<EOF
iOS smoke device automation wrapper

Usage:
  scripts/smoke-ios-device-e2e.sh help
  scripts/smoke-ios-device-e2e.sh list-devices
  scripts/smoke-ios-device-e2e.sh launch-url <url>
  scripts/smoke-ios-device-e2e.sh parse-result-test
  scripts/smoke-ios-device-e2e.sh callback-test
  scripts/smoke-ios-device-e2e.sh fcm-token
  scripts/smoke-ios-device-e2e.sh displayed
  scripts/smoke-ios-device-e2e.sh local-display <id>
  scripts/smoke-ios-device-e2e.sh verify-displayed <id>

Deep links:
  notifykit://smoke/run/fcm-token
  notifykit://smoke/run/displayed
  notifykit://smoke/run/local-display?id=<id>
  notifykit://smoke/verify/displayed?id=<id>

Environment:
  IOS_DEVICE_ID=$device_help
  IOS_BUNDLE_ID=$IOS_BUNDLE_ID
  SMOKE_TIMEOUT_SECONDS=$SMOKE_TIMEOUT_SECONDS
  SMOKE_LAUNCH_TIMEOUT_SECONDS=$SMOKE_LAUNCH_TIMEOUT_SECONDS
  SMOKE_INSPECTOR_DEEPLINK_FALLBACK_SECONDS=$SMOKE_INSPECTOR_DEEPLINK_FALLBACK_SECONDS
  SMOKE_CALLBACK_HOST=${SMOKE_CALLBACK_HOST:-<auto-detect en0/en1>}
  SMOKE_CALLBACK_PORT=${SMOKE_CALLBACK_PORT:-<auto; default 49152>}
  XCRUN=$XCRUN

Exit codes:
  0  matching SMOKE:RESULT status PASS
  1  matching SMOKE:RESULT status FAIL
  2  timeout waiting for matching callback result
  3  device/app launch failure
  4  missing or unsupported local configuration or callback failure

Notes:
  - This wrapper does not build, install, clean up, or send FCM messages.
  - The smoke app must already be installed on the selected physical device.
  - Scenario commands launch the deep link and wait for a matching HTTP callback.
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
const http = require('http');

const EXIT_SMOKE_FAIL = 1;
const EXIT_TIMEOUT = 2;
const EXIT_LAUNCH_FAILURE = 3;
const EXIT_CONFIG = 4;
const MARKER = 'SMOKE:RESULT';
const DEFAULT_CALLBACK_PORT = 49152;

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

async function dispatchDeepLinkViaInspector(launchUrl, bundleId) {
  if (typeof fetch !== 'function' || typeof WebSocket !== 'function') {
    throw new Error('Node.js fetch/WebSocket globals are unavailable');
  }

  const response = await fetch('http://localhost:8081/json/list');
  if (!response.ok) {
    throw new Error(`Metro inspector list failed HTTP ${response.status}`);
  }

  const pages = await response.json();
  const page = (Array.isArray(pages) ? pages : []).find(item => item?.appId === bundleId);
  if (!page?.webSocketDebuggerUrl) {
    throw new Error(`Metro inspector page not found for ${bundleId}`);
  }

  const wsUrl = page.webSocketDebuggerUrl.replace('localhost', '127.0.0.1');
  const expression = `(() => {
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

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('Metro inspector openURL dispatch timed out'));
    }, 5000);

    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression,
            awaitPromise: true,
            returnByValue: true,
          },
        }),
      );
    });

    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) {
        return;
      }

      clearTimeout(timer);

      if (message.error || message.result?.exceptionDetails) {
        ws.close();
        reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
        return;
      }

      setTimeout(() => {
        ws.close();
        resolve();
      }, 1000);
    });

    ws.addEventListener('error', error => {
      clearTimeout(timer);
      reject(new Error(error?.message || error?.type || String(error)));
    });
  });

  console.log('[smoke-ios-device-e2e] deep link fallback: Metro inspector Linking.openURL dispatched');
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
  ] = args;

  if (!scenario || !xcrun || !deviceId || !bundleId || !baseUrl || !callbackHost) {
    console.error('[smoke-ios-device-e2e] ERROR: missing wait-callback configuration');
    process.exit(EXIT_CONFIG);
  }

  const timeoutSeconds = parsePositiveInteger(timeoutArg, 45);
  const launchTimeoutSeconds = parsePositiveInteger(launchTimeoutArg, 15);
  const expected = {
    scenario,
    id: expectedId || '',
    correlationId: expectedCorrelationId || expectedId || '',
  };
  const portConfig = parseCallbackPort(callbackPortArg);

  let finished = false;
  let launchClosed = false;
  let child = null;
  let timer = null;
  let inspectorFallbackTimer = null;

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
    console.error(`[smoke-ios-device-e2e] ERROR: callback_server_listen_failed ${error instanceof Error ? error.message : String(error)}`);
    process.exit(EXIT_CONFIG);
  }

  const callbackUrl = `http://${hostForCallbackUrl(callbackHost)}:${actualPort}/result`;
  const launchUrl = appendCallbackParam(baseUrl, callbackUrl);
  const launchArgs = [
    'devicectl',
    'device',
    'process',
    'launch',
    '--timeout',
    String(launchTimeoutSeconds),
    '--device',
    deviceId,
    '--terminate-existing',
    bundleId,
    '--payload-url',
    launchUrl,
  ];

  console.log(`[smoke-ios-device-e2e] device: ${deviceId}`);
  console.log(`[smoke-ios-device-e2e] bundle: ${bundleId}`);
  console.log(`[smoke-ios-device-e2e] callback: ${callbackUrl}`);
  console.log(`[smoke-ios-device-e2e] url: ${launchUrl}`);
  console.log('[smoke-ios-device-e2e] result capture: HTTP callback POST /result');
  console.log(`[smoke-ios-device-e2e] waiting for callback result ${describeExpected(expected)} timeout=${timeoutSeconds}s`);

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
      console.error(`[smoke-ios-device-e2e] ERROR: launch_failed exit_code=${code}`);
      finish(server, EXIT_LAUNCH_FAILURE);
      return;
    }

    const fallbackSeconds = parsePositiveInteger(process.env.SMOKE_INSPECTOR_DEEPLINK_FALLBACK_SECONDS, 2);
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
  ];

  for (const testCase of callbackCases) {
    const validation = validateCallbackPayload(testCase.payload, testCase.expected);
    if (validation.type !== testCase.expectedValidation) {
      console.error(`[smoke-ios-device-e2e] callback parser test failed: ${testCase.name} validation=${validation.type}`);
      process.exit(1);
    }
  }

  console.log(
    `[smoke-ios-device-e2e] parser static test: PASS (${cases.length} log cases, ${callbackCases.length} callback cases)`,
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
    "$SMOKE_LAUNCH_TIMEOUT_SECONDS"
}

launch_smoke_run() {
  local scenario="$1"
  local url="notifykit://smoke/run/$scenario"

  wait_for_smoke_result_via_callback "$scenario" "" "" "$url"
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
  local command="${1:-help}"

  case "$command" in
    "" | -h | --help | help)
      usage
      ;;
    list-devices)
      list_devices
      ;;
    launch-url)
      launch_url "${2:-}"
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
    local-display)
      local_display "${2:-}"
      ;;
    verify-displayed)
      verify_displayed "${2:-}"
      ;;
    *)
      echo "Unknown command: $command" >&2
      usage >&2
      exit "$EXIT_CONFIG"
      ;;
  esac
}

main "$@"
