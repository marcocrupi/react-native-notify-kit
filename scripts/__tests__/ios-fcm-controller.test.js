const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const {
  createCallback,
  parseArgs,
  proveAppAbsent,
  verifyInstallation,
  commandLog,
  wireDriverResource,
  smokeSigningTeam,
  verifyArtifactIdentity,
  finishCleanup,
  driverCommand,
  candidateEvidence,
} = require('../ios-fcm-qualification');

test('public candidate fingerprint remains reviewable after report redaction', () => {
  const { redact, digest } = require('../lib/ios-fcm-qualification');
  const fingerprint = digest('public candidate manifest');
  const result = redact(candidateEvidence({ fingerprint, head: 'baseline' }));
  assert.equal(result.fingerprintSHA256, fingerprint);
  assert.equal(result.fingerprint, undefined);
});

test('standard fixture restoration rejects modified signing, bundle and NSE identities', () => {
  const artifact = {
    bundleId: 'fixture',
    apsEnvironment: 'development',
    teamId: 'team',
    sha256: 'app',
    jsBundleSHA256: 'standard-js',
    proxyEnabled: true,
    autoInitPlist: 'ABSENT',
    nse: { sha256: 'nse', bundleId: 'fixture.nse' },
  };
  assert.doesNotThrow(() => verifyArtifactIdentity(artifact, JSON.parse(JSON.stringify(artifact))));
  for (const changed of [
    { ...artifact, proxyEnabled: false },
    { ...artifact, jsBundleSHA256: 'diagnostic-js' },
    { ...artifact, apsEnvironment: 'production' },
    { ...artifact, nse: { ...artifact.nse, sha256: 'other-nse' } },
  ])
    assert.throws(
      () => verifyArtifactIdentity(artifact, changed),
      error => error.code === 'CANDIDATE_IDENTITY_MISMATCH',
    );
});

test('cleanup still removes its workspace when another owned resource fails to stop', async () => {
  const calls = [];
  const result = await finishCleanup([
    [
      'relay',
      async () => {
        calls.push('relay');
        throw new Error('failed relay');
      },
    ],
    [
      'callback',
      async () => {
        calls.push('callback');
      },
    ],
    [
      'workspace',
      async () => {
        calls.push('workspace');
      },
    ],
  ]);
  assert.deepEqual(calls, ['relay', 'callback', 'workspace']);
  assert.deepEqual(result.statuses, { relay: 'UNPROVEN', callback: 'PASS', workspace: 'PASS' });
  assert.equal(result.errors.length, 1);
});

test('bare fixture diagnostic resource enters the application resource phase', () => {
  const xcode = require('../../packages/cli/node_modules/xcode');
  const project = xcode.project(
    path.join(__dirname, '../../apps/smoke/ios/NotifeeExample.xcodeproj/project.pbxproj'),
  );
  project.parseSync();
  assert.equal(smokeSigningTeam(project, 'Release'), 'RTFK2YEQ4J');
  wireDriverResource(project);
  const reference = Object.entries(project.pbxFileReferenceSection()).find(
    ([key, value]) =>
      !key.endsWith('_comment') &&
      value.path?.replaceAll('"', '') === 'NotifeeExample/main.jsbundle',
  );
  assert.ok(reference);
  assert.match(project.writeSync(), /main.jsbundle in Resources/);
});

test('private device callback rejects unauthenticated and foreign run input', async () => {
  const { server, context } = createCallback('owner', 'private-session-secret');
  context.session = { ready: () => assert.fail('must not accept foreign proof') };
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/native`;
  try {
    const unauthenticated = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ runId: 'owner' }),
    });
    assert.equal(unauthenticated.status, 403);
    assert.equal(context.error, null);
    const foreign = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer private-session-secret' },
      body: JSON.stringify({ runId: 'foreign' }),
    });
    assert.equal(foreign.status, 400);
    assert.equal(context.error.code, 'CANDIDATE_IDENTITY_MISMATCH');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
test('terminal failure allows only settings cleanup and does not clear the blocker', async () => {
  const { server, context } = createCallback('owner', 'synthetic-secret');
  const blocker = new Error('transport stopped');
  context.error = blocker;
  context.session = { beginDelete: () => assert.fail('cleanup cannot regenerate FCM') };
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const post = async (route, body) =>
    fetch(`http://127.0.0.1:${server.address().port}/${route}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer synthetic-secret' },
      body: JSON.stringify({ ...body, runId: 'owner' }),
    });
  try {
    const cleanup = driverCommand(context, 'restore-settings', 2000);
    const command = await (await post('next', {})).json();
    await post('result', {
      commandId: command.id,
      status: 'OK',
      result: { autoInitEnabled: true },
    });
    assert.equal((await cleanup).autoInitEnabled, true);
    assert.equal(context.error, blocker);
    await assert.rejects(driverCommand(context, 'regenerate', 2000), error => error === blocker);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
test('correction requires explicit opt-in, independent of Release label', () => {
  assert.equal(parseArgs([], {}).mode, 'default');
  assert.equal(parseArgs(['--configuration', 'Release'], {}).mode, 'default');
  assert.equal(
    parseArgs(['--apns-association', 'signed-entitlement'], {}).mode,
    'signed-entitlement',
  );
});
test('unknown process inventory cannot prove main app absence', () => {
  for (const data of [
    {},
    { result: { runningProcesses: [] } },
    { info: { outcome: 'success' }, result: { runningProcesses: [{}] } },
    {
      info: { outcome: 'success' },
      result: {
        runningProcesses: [{ processIdentifier: 1, executable: 'file:///app/NotifeeExample' }],
      },
    },
  ])
    assert.throws(
      () => proveAppAbsent(data, 42),
      error => error.code === 'QUALIFICATION_DRIVER_FAILURE',
    );
  assert.doesNotThrow(() =>
    proveAppAbsent(
      {
        info: { outcome: 'success' },
        result: {
          runningProcesses: [{ processIdentifier: 1, executable: 'file:///sbin/launchd' }],
        },
      },
      42,
    ),
  );
});
test('app replacement invalidates the installation receipt binding', () => {
  const receipt = {
    info: { outcome: 'success' },
    result: {
      installedApplications: [{ bundleID: 'fixture', installationURL: 'file:///original.app/' }],
    },
  };
  const apps = url => ({
    info: { outcome: 'success' },
    result: { apps: [{ bundleIdentifier: 'fixture', url }] },
  });
  assert.equal(
    verifyInstallation(receipt, apps('file:///original.app/'), { bundleId: 'fixture' }),
    'file:///original.app/',
  );
  assert.throws(
    () => verifyInstallation(receipt, apps('file:///different.app/'), { bundleId: 'fixture' }),
    error => error.code === 'CANDIDATE_IDENTITY_MISMATCH',
  );
});
test('command spawn failure closes its log and does not leave an owned process', async () => {
  const root = fs.mkdtempSync('/tmp/ios-fcm-command-test-');
  try {
    await assert.rejects(
      commandLog(path.join(root, 'missing-executable'), [], root, path.join(root, 'log')),
      error => error.code === 'ENOENT',
    );
    assert.equal(fs.readFileSync(path.join(root, 'log'), 'utf8'), '');
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test('compiler replay uses exact in-memory invocation while persisted paths are redacted', async () => {
  const root = fs.mkdtempSync('/tmp/ios-fcm-compiler-stream-');
  const line =
    '/usr/bin/clang -ivfsstatcache /tmp/sdk-' +
    'd'.repeat(64) +
    '.sdkstatcache -c /tmp/RNFBMessaging+AppDelegate.m -o /tmp/test.o';
  try {
    const result = await commandLog(
      '/usr/bin/printf',
      ['%s\n', line],
      root,
      path.join(root, 'log'),
    );
    assert.deepEqual(result.compilerInvocations, [line]);
    assert.ok(!fs.readFileSync(path.join(root, 'log'), 'utf8').includes('d'.repeat(64)));
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

for (const [script, argv, expectedScenarios] of [
  ['smoke-ios-device-e2e.sh', ['fcm-minimal', 'correlation'], ['minimal']],
  ['smoke-ios-device-e2e.sh', ['fcm-ios-attachment', 'correlation'], ['ios-attachment']],
  [
    'f4-ios-nse-e2e.sh',
    ['send', '--non-interactive'],
    ['kitchen-sink', 'minimal', 'emoji', 'ios-attachment'],
  ],
  [
    'f4-ios-nse-e2e.sh',
    ['all', '--non-interactive'],
    ['kitchen-sink', 'minimal', 'emoji', 'ios-attachment'],
  ],
]) {
  test(`${script} ${argv[0]} dispatches through qualification controller`, () => {
    const tmp = fs.mkdtempSync('/tmp/ios-fcm-routing-test-');
    const receipt = path.join(tmp, 'argv');
    fs.writeFileSync(path.join(tmp, 'node'), `#!/bin/bash\nprintf '%s\\n' "$@" > '${receipt}'\n`, {
      mode: 0o755,
    });
    try {
      const result = spawnSync('bash', [path.join(__dirname, '..', script), ...argv], {
        env: {
          ...process.env,
          PATH: tmp + ':' + process.env.PATH,
          IOS_DEVICE_ID: 'physical-fixture',
          IOS_FCM_TOKEN: '',
          FCM_TOKEN: '',
          SMOKE_CALLBACK_HOST: '192.0.2.1',
        },
        encoding: 'utf8',
        timeout: 10000,
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const args = fs.readFileSync(receipt, 'utf8').trim().split('\n');
      assert.ok(args[0].endsWith('/ios-fcm-qualification.js'));
      assert.deepEqual(
        args.flatMap((arg, index) => (arg === '--scenario' ? [args[index + 1]] : [])),
        expectedScenarios,
      );
      assert.ok(!result.stdout.includes('private-token'));
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });
}
