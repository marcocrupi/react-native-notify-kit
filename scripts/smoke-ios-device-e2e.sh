#!/usr/bin/env bash
set -euo pipefail

DEFAULT_IOS_DEVICE_ID="C274F5E5-B73D-556F-9589-E384F79EF805"
IOS_DEVICE_ID="${IOS_DEVICE_ID:-}"
IOS_BUNDLE_ID="${IOS_BUNDLE_ID:-org.reactjs.native.example.NotifeeExample}"
SMOKE_TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS:-30}"
SMOKE_LAUNCH_TIMEOUT_SECONDS="${SMOKE_LAUNCH_TIMEOUT_SECONDS:-15}"
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
  XCRUN=$XCRUN

Exit codes:
  0  matching SMOKE:RESULT status PASS
  1  matching SMOKE:RESULT status FAIL
  2  timeout waiting for matching SMOKE:RESULT
  3  device/app launch failure
  4  missing or unsupported local configuration

Notes:
  - This wrapper does not build, install, clean up, or send FCM messages.
  - The smoke app must already be installed on the selected physical device.
  - Scenario commands launch the deep link and wait for matching SMOKE:RESULT.
  - launch-url is a launcher-only utility and does not wait for SMOKE:RESULT.
  - Log capture uses devicectl process launch --console because this Xcode does
    not expose devicectl device log stream.
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

supports_launch_console() {
  "$XCRUN" devicectl device process launch --help 2>/dev/null | grep -q -- '--console'
}

require_wait_support() {
  if ! command -v node >/dev/null 2>&1; then
    fail_config "Node.js is required to parse SMOKE:RESULT JSON."
  fi

  if ! supports_launch_console; then
    fail_config "devicectl process launch --console is not available, and no supported device log stream fallback is configured."
  fi
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

const EXIT_SMOKE_FAIL = 1;
const EXIT_TIMEOUT = 2;
const EXIT_LAUNCH_FAILURE = 3;
const EXIT_CONFIG = 4;
const MARKER = 'SMOKE:RESULT';

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

function waitConsole(args) {
  const [
    scenario,
    expectedId,
    expectedCorrelationId,
    timeoutArg,
    xcrun,
    deviceId,
    bundleId,
    url,
  ] = args;

  if (!scenario || !xcrun || !deviceId || !bundleId || !url) {
    console.error('[smoke-ios-device-e2e] ERROR: missing wait-console configuration');
    process.exit(EXIT_CONFIG);
  }

  const timeoutSeconds = parsePositiveInteger(timeoutArg, 30);
  const expected = {
    scenario,
    id: expectedId || '',
    correlationId: expectedCorrelationId || expectedId || '',
  };
  const launchArgs = [
    'devicectl',
    'device',
    'process',
    'launch',
    '--device',
    deviceId,
    bundleId,
    '--payload-url',
    url,
    '--console',
  ];

  console.log(`[smoke-ios-device-e2e] device: ${deviceId}`);
  console.log(`[smoke-ios-device-e2e] bundle: ${bundleId}`);
  console.log(`[smoke-ios-device-e2e] url: ${url}`);
  console.log('[smoke-ios-device-e2e] log capture: devicectl process launch --console');
  console.log(`[smoke-ios-device-e2e] waiting for SMOKE:RESULT ${describeExpected(expected)} timeout=${timeoutSeconds}s`);

  let finished = false;
  const child = spawn(xcrun, launchArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  function finish(code) {
    if (finished) {
      return;
    }

    finished = true;
    clearTimeout(timer);

    if (child.exitCode == null && !child.killed) {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode == null && !child.killed) {
          child.kill('SIGKILL');
        }
      }, 1000).unref();
    }

    setTimeout(() => process.exit(code), 50);
  }

  const timer = setTimeout(() => {
    console.error(
      `[smoke-ios-device-e2e] ERROR: timeout_waiting_for_smoke_result ${describeExpected(expected)} timeout=${timeoutSeconds}s`,
    );
    finish(EXIT_TIMEOUT);
  }, timeoutSeconds * 1000);

  function handleLine(source, line) {
    if (line.includes('SMOKE:EVENT')) {
      console.log(`[smoke-ios-device-e2e] ${source}: ${line}`);
      return;
    }

    const parsed = extractSmokeResult(line);
    if (parsed == null) {
      return;
    }

    if (parsed.type === 'invalid') {
      console.error(`[smoke-ios-device-e2e] WARNING: ignoring invalid SMOKE:RESULT (${parsed.reason})`);
      return;
    }

    const payload = parsed.payload;
    if (!matchesExpected(payload, expected)) {
      console.log(
        `[smoke-ios-device-e2e] ignored SMOKE:RESULT scenario=${stringValue(payload.scenario)} id=${stringValue(payload.id)} correlationId=${stringValue(payload.correlationId)}`,
      );
      return;
    }

    console.log(`[smoke-ios-device-e2e] matched SMOKE:RESULT ${JSON.stringify(payload)}`);

    if (payload.status === 'PASS') {
      console.log('[smoke-ios-device-e2e] result: PASS');
      finish(0);
      return;
    }

    if (payload.status === 'FAIL') {
      console.error(`[smoke-ios-device-e2e] result: FAIL reason=${stringValue(payload.reason) || 'unknown'}`);
      finish(EXIT_SMOKE_FAIL);
      return;
    }

    console.error(`[smoke-ios-device-e2e] WARNING: matching SMOKE:RESULT has unsupported status=${String(payload.status)}`);
  }

  function attachLineReader(stream, source) {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', chunk => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        handleLine(source, line);
      }
    });
    stream.on('end', () => {
      if (buffer.length > 0) {
        handleLine(source, buffer);
      }
    });
  }

  child.on('error', error => {
    console.error(`[smoke-ios-device-e2e] ERROR: launch_failed ${error instanceof Error ? error.message : String(error)}`);
    finish(EXIT_LAUNCH_FAILURE);
  });

  child.on('close', code => {
    if (finished) {
      return;
    }

    if (code === 0) {
      console.error(`[smoke-ios-device-e2e] ERROR: process_ended_before_smoke_result ${describeExpected(expected)}`);
      finish(EXIT_TIMEOUT);
      return;
    }

    console.error(`[smoke-ios-device-e2e] ERROR: launch_failed exit_code=${code}`);
    finish(EXIT_LAUNCH_FAILURE);
  });

  attachLineReader(child.stdout, 'stdout');
  attachLineReader(child.stderr, 'stderr');
}

function runParserTest() {
  const cases = [
    {
      name: 'displayed pass',
      expected: { scenario: 'displayed', id: '', correlationId: '' },
      line: '2026-05-06 SMOKE:RESULT {"scenario":"displayed","status":"PASS","timestamp":"2026-05-06T00:00:00.000Z","count":1}',
      status: 'PASS',
    },
    {
      name: 'verify displayed fail with normalized id',
      expected: { scenario: 'verify-displayed', id: 'smoke-abc', correlationId: 'abc' },
      line: 'SMOKE:RESULT {"scenario":"verify-displayed","status":"FAIL","timestamp":"2026-05-06T00:00:00.000Z","id":"smoke-abc","correlationId":"abc","reason":"not_found"}',
      status: 'FAIL',
    },
  ];

  for (const testCase of cases) {
    const parsed = extractSmokeResult(testCase.line);
    if (parsed?.type !== 'result') {
      console.error(`[smoke-ios-device-e2e] parser test failed: ${testCase.name} did not parse`);
      process.exit(1);
    }
    if (!matchesExpected(parsed.payload, testCase.expected)) {
      console.error(`[smoke-ios-device-e2e] parser test failed: ${testCase.name} did not match`);
      process.exit(1);
    }
    if (parsed.payload.status !== testCase.status) {
      console.error(`[smoke-ios-device-e2e] parser test failed: ${testCase.name} status mismatch`);
      process.exit(1);
    }
  }

  const mismatch = extractSmokeResult(
    'SMOKE:RESULT {"scenario":"local-display","status":"PASS","id":"smoke-other","correlationId":"other"}',
  );
  if (mismatch?.type !== 'result') {
    console.error('[smoke-ios-device-e2e] parser test failed: mismatch fixture did not parse');
    process.exit(1);
  }
  if (matchesExpected(mismatch.payload, { scenario: 'verify-displayed', id: 'smoke-abc', correlationId: 'abc' })) {
    console.error('[smoke-ios-device-e2e] parser test failed: accepted mismatched scenario/id');
    process.exit(1);
  }

  console.log('[smoke-ios-device-e2e] parser static test: PASS');
}

const [mode, ...args] = process.argv.slice(2);

if (mode === 'wait-console') {
  waitConsole(args);
} else if (mode === 'parse-result-test') {
  runParserTest();
} else {
  console.error(`[smoke-ios-device-e2e] ERROR: unknown node mode ${mode || '<empty>'}`);
  process.exit(EXIT_CONFIG);
}
NODE
}

wait_for_smoke_result_via_console() {
  local scenario="$1"
  local expected_id="${2:-}"
  local expected_correlation_id="${3:-}"
  local url="$4"

  require_wait_support
  resolve_device_id

  run_smoke_node wait-console \
    "$scenario" \
    "$expected_id" \
    "$expected_correlation_id" \
    "$SMOKE_TIMEOUT_SECONDS" \
    "$XCRUN" \
    "$IOS_DEVICE_ID" \
    "$IOS_BUNDLE_ID" \
    "$url"
}

launch_smoke_run() {
  local scenario="$1"
  local url="notifykit://smoke/run/$scenario"

  wait_for_smoke_result_via_console "$scenario" "" "" "$url"
}

local_display() {
  local id="$1"
  local expected_id
  local url

  require_arg "$id" "id"
  expected_id="$(smoke_notification_id_for "$id")"
  url="notifykit://smoke/run/local-display?id=$(urlencode "$id")"

  wait_for_smoke_result_via_console "local-display" "$expected_id" "$id" "$url"
}

verify_displayed() {
  local id="$1"
  local expected_id
  local url

  require_arg "$id" "id"
  expected_id="$(smoke_notification_id_for "$id")"
  url="notifykit://smoke/verify/displayed?id=$(urlencode "$id")"

  wait_for_smoke_result_via_console "verify-displayed" "$expected_id" "$id" "$url"
}

parse_result_test() {
  if ! command -v node >/dev/null 2>&1; then
    fail_config "Node.js is required to run parse-result-test."
  fi

  run_smoke_node parse-result-test
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
