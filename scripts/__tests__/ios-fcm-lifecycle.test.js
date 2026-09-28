const assert = require('node:assert/strict');
const { test } = require('node:test');
const { lifecycle } = require('./helpers/ios-fcm-lifecycle');

function cleaned(result) {
  assert.equal(result.state.installed, 'STANDARD');
  assert.equal(result.state.running, false);
  assert.equal(result.state.autoInit, true);
  assert.equal(result.workspaceExists, false);
  assert.equal(result.cleanup.standardFixtureRestore, 'PASS');
  assert.equal(result.cleanup.standardAutoInitRestore, 'PASS');
  assert.ok(
    result.state.calls.some(call => call.label.includes('cleanup') && call.command === 'xcrun'),
  );
}

test('ordinary failure and success both complete owned cleanup', async () => {
  for (const ordinaryError of [true, false]) {
    const result = await lifecycle({ ordinaryError });
    cleaned(result);
    assert.equal(result.rejected, ordinaryError ? 'QUALIFICATION_DRIVER_FAILURE' : undefined);
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`${signal} invalidates authority immediately and still executes owned cleanup`, async () => {
    const result = await lifecycle({
      signal,
      phase: 'generation',
      onSignal: session => {
        assert.equal(session.evidence().state, 'BLOCKED');
        assert.throws(() => session.beginGeneration());
      },
    });
    cleaned(result);
    assert.equal(result.state.signalProbeError, undefined);
    assert.equal(result.rejected, 'QUALIFICATION_INTERRUPTED');
    assert.equal(result.report.interruption.signal, signal);
    assert.equal(result.state.afterSignalSends, 0);
    assert.equal(result.state.afterSignalTokens, 0);
    assert.throws(() =>
      result.session.authorizeSend({ phase: 'FUNCTIONAL', token: 'synthetic-fcm-token' }),
    );
    assert.equal(result.session.evidence().state, 'CLOSED');
  });
}

test('interruption and a partial cleanup failure remain separately reported', async () => {
  const result = await lifecycle({
    signal: 'SIGINT',
    phase: 'generation',
    cleanupFailure: 'cleanup-driver-terminate',
  });
  assert.equal(result.rejected, 'QUALIFICATION_INTERRUPTED');
  assert.equal(result.report.interruption.signal, 'SIGINT');
  assert.ok(result.report.cleanupErrors.length > 0);
  assert.ok(
    result.state.calls.some(call =>
      call.args.some(value => String(value).includes('standard-fixture')),
    ),
  );
  assert.equal(result.workspaceExists, false);
});

test('changed standard pilot resource is UNPROVEN and never reinstalled', async () => {
  const result = await lifecycle({ corruptPilot: true });
  assert.equal(result.cleanup.standardFixtureRestore, 'UNPROVEN');
  assert.ok(
    !result.state.calls.some(
      call =>
        call.args.includes('install') &&
        call.args.some(value => String(value).includes('standard-fixture')),
    ),
  );
});

test('double signal and signal during cleanup do not kill owned cleanup subprocesses', async () => {
  for (const phase of ['generation', 'cleanup']) {
    const result = await lifecycle({ phase, doubleSignal: true });
    cleaned(result);
    assert.equal(result.rejected, 'QUALIFICATION_INTERRUPTED');
    assert.equal(result.report.runtimeStatus, 'BLOCKED');
    assert.equal(result.state.afterSignalSends, 0);
    assert.equal(result.state.afterSignalTokens, 0);
  }
});

test('signal during native install or launch retains settled ownership for cleanup', async () => {
  for (const phase of ['install-settlement', 'launch-settlement']) {
    const result = await lifecycle({ phase });
    cleaned(result);
    assert.equal(result.rejected, 'QUALIFICATION_INTERRUPTED');
  }
});

test('pilot mutation during the preinstall query is rechecked before reinstall', async () => {
  const result = await lifecycle({ ordinaryError: true, corruptPilotPhase: 'after-verify' });
  assert.equal(result.cleanup.standardFixtureRestore, 'UNPROVEN');
  assert.ok(
    !result.state.calls.some(
      call =>
        call.args.includes('install') &&
        call.args.some(value => String(value).includes('standard-fixture')),
    ),
  );
});

for (const phase of [
  'preparation',
  'pilot-bundle',
  'pilot-build',
  'qualified-bundle',
  'qualified-build',
  'readiness',
  'delete',
  't0-send',
  'functional-send',
  'observation',
]) {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    test(`${signal} at ${phase} closes authority and removes owned temporary resources`, async () => {
      const result = await lifecycle({ phase, signal });
      assert.equal(result.rejected, 'QUALIFICATION_INTERRUPTED');
      assert.equal(result.report.runtimeStatus, 'BLOCKED');
      assert.equal(result.workspaceExists, false);
      assert.equal(result.state.afterSignalTokens, 0);
      assert.equal(result.state.afterSignalSends, 0);
      if (result.state.installed !== 'NONE') cleaned(result);
    });
  }
}

test('original false auto-init setting is restored without a token request', async () => {
  const result = await lifecycle({ phase: 'generation', autoInit: false });
  assert.equal(result.state.autoInit, false);
  assert.equal(result.cleanup.standardAutoInitRestore, 'PASS');
  assert.equal(result.state.afterSignalTokens, 0);
});

test('foreign installation or recycled PID refuses device mutation', async () => {
  for (const options of [
    { foreignInstallation: true },
    { foreignPID: true, phase: 'generation' },
  ]) {
    const result = await lifecycle(options);
    assert.equal(result.report.runtimeStatus, 'BLOCKED');
    assert.equal(result.cleanup.standardFixtureRestore, 'UNPROVEN');
    assert.ok(!result.state.calls.some(call => call.label.includes('cleanup-driver-terminate')));
  }
});

test('repeating registered cleanup does not relaunch or reinstall the restored pilot', async () => {
  const result = await lifecycle({ phase: 'generation', repeatCleanup: true });
  cleaned(result);
  assert.equal(
    result.state.calls.filter(call => call.label.includes('cleanup-settings-launch')).length,
    1,
  );
  assert.equal(
    result.state.calls.filter(call => call.label.includes('cleanup-standard-fixture-install'))
      .length,
    1,
  );
  assert.equal(result.state.afterSignalTokens, 0);
});

test('a work process ignoring SIGTERM is forcibly settled before directory cleanup', async () => {
  const result = await lifecycle({ phase: 'work-hang', ignoreTerm: true, fastTimeout: true });
  assert.equal(result.rejected, 'QUALIFICATION_INTERRUPTED');
  assert.ok(result.state.kills.some(kill => kill.signal === 'SIGKILL'));
  assert.equal(result.workspaceExists, false);
});

test('settings cleanup failure does not prevent owned stop, pilot restore or local cleanup', async () => {
  const result = await lifecycle({ phase: 'generation', settingsFailure: true });
  assert.equal(result.rejected, 'QUALIFICATION_INTERRUPTED');
  assert.equal(result.cleanup.standardAutoInitRestore, 'UNPROVEN');
  assert.equal(result.cleanup.driverCleanup, 'PASS');
  assert.equal(result.cleanup.standardFixtureRestore, 'PASS');
  assert.ok(result.report.cleanupErrors.some(error => error.phase === 'restore-settings'));
  assert.equal(result.workspaceExists, false);
});

test('private cleanup process backend is not exported as a cancellation bypass', () => {
  const controller = require('../ios-fcm-qualification');
  assert.equal(controller.collectCommand, undefined);
  assert.equal(controller.deviceCommand, undefined);
  assert.equal(controller.registerDeviceCleanup, undefined);
});

test('revoked callback rejects stale qualification bodies and keeps the original interruption', async () => {
  const { createCallback, driverCommand } = require('../ios-fcm-qualification');
  const { QualificationError } = require('../lib/ios-fcm-qualification');
  const { server, context } = createCallback('owner', 'synthetic-secret');
  const interruption = new QualificationError(
    'QUALIFICATION_INTERRUPTED',
    'Synthetic interruption',
  );
  context.session = { beginGeneration: () => assert.fail('revoked generation cannot start') };
  context.error = interruption;
  context.stopped = true;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const post = (route, body) =>
    fetch(`http://127.0.0.1:${server.address().port}/${route}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer synthetic-secret' },
      body: JSON.stringify({ ...body, runId: 'owner' }),
    });
  try {
    await assert.rejects(driverCommand(context, 'regenerate'), error => error === interruption);
    assert.equal(context.pending, null);
    assert.equal((await post('token', { token: 'synthetic-fcm' })).status, 400);
    context.cleanupDriverActive = true;
    const restoring = driverCommand(context, 'restore-settings', 2000);
    const command = await (await post('next', {})).json();
    assert.equal(command.action, 'restore-settings');
    assert.equal(
      (await post('event', { commandId: command.id, kind: 'generation-started' })).status,
      400,
    );
    await post('result', {
      commandId: command.id,
      status: 'OK',
      result: { autoInitEnabled: true },
    });
    assert.equal((await restoring).autoInitEnabled, true);
    assert.equal(context.error, interruption);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('actual driver template does not request a token when generation authorization is revoked', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const { createCallback } = require('../ios-fcm-qualification');
  const { QualificationError } = require('../lib/ios-fcm-qualification');
  const { server, context } = createCallback('owner', 'synthetic-secret');
  context.session = {
    beginDelete: () => ({}),
    completeDelete: () => {},
    beginGeneration: () => assert.fail('revoked generation event'),
  };
  context.pending = { command: { id: 'command', action: 'regenerate' } };
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let tokens = 0;
  const template = fs.readFileSync(
    path.join(__dirname, '../fixtures/ios-fcm-qualification/App.tsx.template'),
    'utf8',
  );
  const source = template
    .slice(0, template.indexOf('export default function App'))
    .replace(/^import[\s\S]*?;\n/gm, '')
    .replace(
      '__QUALIFICATION_CONFIG__',
      JSON.stringify({
        runId: 'owner',
        callbackSecret: 'synthetic-secret',
        callbackURL: `http://127.0.0.1:${server.address().port}`,
      }),
    );
  const driver = {
    setTimeout,
    getMessaging: () => ({}),
    getAPNSToken: async () => 'apns',
    deleteToken: async () => {},
    getToken: async () => {
      tokens++;
      return 'synthetic-fcm';
    },
    fetch: async (url, options) => {
      if (JSON.parse(options.body).kind === 'generation-started') {
        context.stopped = true;
        context.error = new QualificationError('QUALIFICATION_INTERRUPTED', 'Synthetic signal');
      }
      return fetch(url, options);
    },
  };
  vm.runInNewContext(source + '\nglobalThis.execute = execute;', driver);
  try {
    await assert.rejects(driver.execute({ id: 'command', action: 'regenerate' }));
    assert.equal(tokens, 0);
    assert.equal(context.error.code, 'QUALIFICATION_INTERRUPTED');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
