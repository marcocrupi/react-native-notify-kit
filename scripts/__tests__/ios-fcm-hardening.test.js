const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');
const { lifecycle } = require('./helpers/ios-fcm-lifecycle');
const { digest } = require('../lib/ios-fcm-qualification');

async function supervised(options) {
  const scratch = fs.mkdtempSync('/tmp/ios-fcm-supervisor-');
  const observations = path.join(scratch, 'processes.jsonl');
  const shim = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const command=path.basename(process.argv[1]), args=process.argv.slice(2);
const record=value=>fs.appendFileSync(${JSON.stringify(observations)},JSON.stringify(value)+'\\n');
record({command,pid:process.pid});
if(command===${JSON.stringify(options.hangTool)}) {
 process.on('SIGTERM',()=>record({command,pid:process.pid,signal:'SIGTERM'}));
 process.on('SIGINT',()=>{});process.stdout.write('ready');setInterval(()=>{},1000);
} else if(command==='codesign') {if(!args.includes('--verify'))process.stdout.write('<signed>');}
else {
 const extension=args.at(-1).includes('.appex/');
 process.stdout.write(JSON.stringify(args.at(-1)==='-'?{'aps-environment':'development','com.apple.developer.team-identifier':'TEAM'}:{CFBundleExecutable:extension?'NotifyKitNSE':'Fixture',CFBundleIdentifier:extension?'fixture.nse':'fixture',...(extension?{NSExtension:{NSExtensionPointIdentifier:'com.apple.usernotifications.service'}}:{})}));
}
`;
  for (const command of ['codesign', 'plutil', ...(options.hangTool === 'git' ? ['git'] : [])])
    fs.writeFileSync(path.join(scratch, command), shim, { mode: 0o700 });
  const code = `const {lifecycle}=require(${JSON.stringify(path.join(__dirname, 'helpers/ios-fcm-lifecycle.js'))});
lifecycle({...JSON.parse(process.env.WITNESS_OPTIONS),actualInspection:true,retain:true}).then(r=>{
 console.log(JSON.stringify({root:r.root,rejected:r.rejected,workspaceExists:r.workspaceExists,report:r.report,cleanup:r.cleanup,state:r.state}));
 require('node:fs').rmSync(r.root,{recursive:true});
}).catch(e=>{console.error(e.code||e.message);process.exitCode=1});`;
  const child = spawn(process.execPath, ['-e', code], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      WITNESS_OPTIONS: JSON.stringify({
        ...options,
        inspectorPath: scratch,
        supervisorRoot: scratch,
      }),
    },
  });
  let output = '',
    stderr = '',
    timedOut = false;
  child.stdout.on('data', bytes => {
    output += bytes;
  });
  child.stderr.on('data', bytes => {
    stderr += bytes;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    process.kill(-child.pid, 'SIGKILL');
  }, 7000);
  try {
    const status = await new Promise(resolve => child.once('close', resolve));
    assert.equal(timedOut, false, 'controller required an external supervisor kill');
    assert.equal(status, 0, stderr);
    const result = JSON.parse(output);
    result.observations = fs.existsSync(observations)
      ? fs.readFileSync(observations, 'utf8').trim().split('\n').map(JSON.parse)
      : [];
    return result;
  } finally {
    clearTimeout(timer);
    if (fs.existsSync(observations))
      for (const entry of fs
        .readFileSync(observations, 'utf8')
        .trim()
        .split('\n')
        .map(JSON.parse)) {
        try {
          process.kill(entry.pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
    if (fs.existsSync(path.join(scratch, 'workspace-root')))
      fs.rmSync(fs.readFileSync(path.join(scratch, 'workspace-root'), 'utf8'), {
        recursive: true,
        force: true,
      });
    fs.rmSync(scratch, { recursive: true });
  }
}

test('cleanup identity timeout is separate from interruption and prevents cleanup PASS', async () => {
  const result = await supervised({
    signal: 'SIGINT',
    phase: 'generation',
    hangTool: 'git',
    realIdentity: true,
  });
  assert.equal(result.rejected, 'QUALIFICATION_INTERRUPTED');
  assert.equal(result.report.interruption.signal, 'SIGINT');
  assert.ok(
    result.report.cleanupErrors.some(
      error => error.phase === 'final-identity' && error.code === 'IDENTITY_VERIFICATION_TIMEOUT',
    ),
  );
  assert.equal(result.cleanup.status, 'UNPROVEN');
  assert.equal(result.cleanup.driverCleanup, 'PASS');
  assert.equal(result.cleanup.callbackStopped, true);
  assert.equal(result.workspaceExists, false);
  assert.equal(result.state.forbiddenSyncCalls, 0);
});

test('unproven inspector settlement blocks aggregate PASS and retains workspace, independent callback still closes', async () => {
  const result = await lifecycle({ phase: 'generation', unprovenInspection: true, retain: true });
  try {
    assert.equal(result.rejected, 'QUALIFICATION_INTERRUPTED');
    assert.equal(result.cleanup.status, 'UNPROVEN');
    assert.equal(result.cleanup.workspaceCleanup, 'UNPROVEN');
    assert.equal(result.workspaceExists, true);
    assert.equal(result.cleanup.callbackStopped, true);
    assert.equal(result.cleanup.driverCleanup, 'PASS');
    assert.ok(
      result.report.cleanupErrors.some(error => error.code === 'PROCESS_SETTLEMENT_UNPROVEN'),
    );
    assert.equal(result.state.afterSignalTokens, 0);
    assert.equal(result.state.afterSignalSends, 0);
  } finally {
    fs.rmSync(result.root, { recursive: true });
  }
});

test('call graph witness falsifies a mutant routing finally to synchronous identity', async () => {
  const result = await lifecycle({ phase: 'generation', mutateCleanupIdentity: true });
  assert.ok(result.state.forbiddenSyncCalls > 0);
  assert.equal(result.report.runtimeStatus, 'BLOCKED');
  assert.equal(result.workspaceExists, false);
});

for (const primitive of ['execFileSync', 'spawnSync', 'execSync']) {
  test(`call graph witness detects forbidden ${primitive} reached from finally`, async () => {
    const result = await lifecycle({ phase: 'generation', mutateCleanupPrimitive: primitive });
    assert.ok(result.state.forbiddenSyncCalls > 0);
    assert.equal(result.state.afterSignalSends, 0);
  });
}

test('call graph witness detects the real synchronous sender reached from finally', async () => {
  const result = await lifecycle({
    phase: 'generation',
    realSender: true,
    mutateCleanupSender: true,
  });
  assert.equal(result.state.forbiddenSenderCalls, 1);
  assert.ok(result.state.forbiddenSyncCalls > 0);
  assert.equal(result.state.afterSignalSends, 0);
});

test('real sender and synchronous Git adapter work before cancellation and remain unreachable in cleanup failure', async () => {
  const result = await lifecycle({
    phase: 'functional-send',
    doubleSignal: true,
    realSender: true,
    realIdentity: true,
    cleanupFailure: 'cleanup-driver-terminate',
  });
  assert.equal(result.report.interruption.signal, 'SIGINT');
  assert.equal(result.report.runtimeStatus, 'BLOCKED');
  assert.deepEqual(result.state.sends, ['T0']);
  assert.ok(result.state.synchronousWorkCalls > 0);
  assert.equal(result.state.forbiddenSyncCalls, 0);
  assert.equal(result.state.forbiddenSenderCalls, 0);
  assert.equal(result.state.afterSignalSends, 0);
  assert.equal(result.state.afterSignalTokens, 0);
});

test('pilot mutation after the final async signature inspection never reaches reinstall', async () => {
  const result = await lifecycle({ ordinaryError: true, corruptPilotAfterInspection: true });
  assert.equal(result.cleanup.standardFixtureRestore, 'UNPROVEN');
  assert.ok(
    result.report.cleanupErrors.some(
      error => error.phase === 'reinstall-pilot' && error.code === 'QUALIFICATION_CLEANUP_REFUSED',
    ),
  );
  assert.equal(
    result.state.calls.some(call => call.label.includes('cleanup-standard-fixture-install')),
    false,
  );
  assert.equal(result.workspaceExists, false);
});

for (const filename of ['report.json', 'cleanup.json', 'device-system-redacted.log']) {
  test(`hostile evidence ${filename}: reporting rejection preserves foreign bytes and independent cleanup`, async () => {
    const foreign = fs.mkdtempSync('/tmp/ios-fcm-evidence-foreign-');
    fs.writeFileSync(path.join(foreign, 'target'), 'foreign evidence sentinel');
    const before = digest(fs.readFileSync(path.join(foreign, 'target')));
    try {
      const result = await lifecycle({ hostileEvidence: filename, foreign });
      assert.equal(result.rejected, 'PATH_CONFINEMENT_VIOLATION');
      assert.equal(result.report.runtimeStatus, 'BLOCKED');
      assert.equal(
        result.cleanup.status,
        filename === 'device-system-redacted.log' ? 'PASS' : 'UNPROVEN',
      );
      assert.equal(result.workspaceExists, false);
      assert.equal(result.cleanup.callbackStopped, true);
      assert.equal(digest(fs.readFileSync(path.join(foreign, 'target'))), before);
      assert.deepEqual(fs.readdirSync(foreign), ['target']);
    } finally {
      fs.rmSync(foreign, { recursive: true });
    }
  });
}

for (const hangTool of ['codesign', 'plutil'])
  for (const [signal, phase] of [
    ['SIGINT', 'generation'],
    ['SIGTERM', 'cleanup'],
  ]) {
    test(`${signal} at ${phase} with real hanging ${hangTool}: bounded cleanup, original interruption, no sync call graph`, async () => {
      const result = await supervised({
        signal,
        phase,
        hangTool,
        realIdentity: true,
        doubleSignal: true,
      });
      assert.equal(result.rejected, 'QUALIFICATION_INTERRUPTED');
      assert.equal(result.report.interruption.signal, signal);
      assert.equal(result.report.runtimeStatus, 'BLOCKED');
      assert.ok(
        result.report.cleanupErrors.some(
          error =>
            error.phase === 'reinstall-pilot' && error.code === 'ARTIFACT_VERIFICATION_TIMEOUT',
        ),
      );
      assert.equal(result.cleanup.standardFixtureRestore, 'UNPROVEN');
      assert.equal(result.cleanup.driverCleanup, 'PASS');
      assert.equal(result.cleanup.callbackStopped, true);
      assert.equal(result.workspaceExists, false);
      assert.equal(result.state.forbiddenSyncCalls, 0);
      assert.ok(result.state.synchronousWorkCalls > 0);
      assert.equal(result.state.forbiddenSenderCalls, 0);
      assert.equal(result.state.afterSignalTokens, 0);
      assert.equal(result.state.afterSignalSends, 0);
      assert.ok(
        result.observations.some(entry => entry.command === hangTool && entry.signal === 'SIGTERM'),
        JSON.stringify({
          observations: result.observations,
          cleanupErrors: result.report.cleanupErrors,
        }),
      );
    });
  }

for (const output of [
  'apps/smoke/App.tsx',
  'apps/smoke/metro.qualification.cjs',
  'apps/smoke/ios/NotifeeExample/AppDelegate.swift',
  'apps/smoke/ios/NotifeeExample/Info.plist',
  'apps/smoke/ios/NotifeeExample/main.jsbundle',
  'apps/smoke/ios/NotifeeExample.xcodeproj/project.pbxproj',
]) {
  test(`controller rejects ${output} symlink, cleans its workspace, preserves all foreign bytes`, async () => {
    const foreign = fs.mkdtempSync('/tmp/ios-fcm-controller-foreign-');
    fs.writeFileSync(path.join(foreign, 'target'), 'foreign existing target');
    fs.writeFileSync(path.join(foreign, 'sentinel'), 'foreign sentinel');
    const before = Object.fromEntries(
      fs
        .readdirSync(foreign)
        .map(name => [name, digest(fs.readFileSync(path.join(foreign, name)))]),
    );
    try {
      const result = await lifecycle({
        hostileOutput: output,
        foreign,
        actualNative: output.endsWith('.swift') || output.endsWith('.plist'),
        realMetro:
          output.includes('metro.') || output.endsWith('.jsbundle') || output.endsWith('.pbxproj'),
      });
      assert.equal(result.rejected, 'PATH_CONFINEMENT_VIOLATION');
      assert.equal(result.report.runtimeStatus, 'BLOCKED');
      assert.equal(result.workspaceExists, false);
      const after = Object.fromEntries(
        fs
          .readdirSync(foreign)
          .map(name => [name, digest(fs.readFileSync(path.join(foreign, name)))]),
      );
      assert.deepEqual(after, before);
      assert.equal(
        fs.readFileSync(path.join(foreign, 'target'), 'utf8'),
        'foreign existing target',
      );
    } finally {
      fs.rmSync(foreign, { recursive: true });
    }
  });
}

test('actual native generator edits only the owned staged Info.plist and restores ordinary settings', async () => {
  const result = await lifecycle({ actualNative: true });
  assert.equal(result.rejected, undefined);
  assert.equal(result.report.runtimeStatus, 'PASS');
  assert.equal(result.cleanup.standardAutoInitRestore, 'PASS');
  assert.equal(result.workspaceExists, false);
});

for (const kind of ['hostileCoreParent', 'hostileVersion']) {
  test(`delegated ${kind} output rejects foreign links before dispatch`, async () => {
    const foreign = fs.mkdtempSync('/tmp/ios-fcm-build-output-foreign-');
    fs.mkdirSync(path.join(foreign, 'NotifeeCore'));
    for (const file of ['target', 'sentinel', 'NotifeeCore/target'])
      fs.writeFileSync(path.join(foreign, file), 'foreign generated sentinel');
    const files = ['target', 'sentinel', 'NotifeeCore/target'];
    const before = files.map(file => digest(fs.readFileSync(path.join(foreign, file))));
    try {
      const result = await lifecycle({ [kind]: true, foreign });
      assert.equal(result.rejected, 'PATH_CONFINEMENT_VIOLATION');
      assert.equal(result.workspaceExists, false);
      assert.deepEqual(
        files.map(file => digest(fs.readFileSync(path.join(foreign, file)))),
        before,
      );
    } finally {
      fs.rmSync(foreign, { recursive: true });
    }
  });
}

for (const [phase, file] of [
  ['init-nse', 'apps/smoke/ios/Podfile'],
  ['init-nse', 'apps/smoke/ios/Podfile.bak.synthetic'],
  ['pod', 'apps/smoke/ios/Podfile.lock'],
  ['pod', 'apps/smoke/ios/Pods/Manifest.lock'],
  ['pod', 'apps/smoke/ios/Pods/Pods.xcodeproj/project.pbxproj'],
  ['pod', 'apps/smoke/ios/Pods/Target Support Files/fixture/config.xcconfig'],
  ['pod', 'apps/smoke/ios/NotifeeExample.xcworkspace/contents.xcworkspacedata'],
  ['pod', 'apps/smoke/ios/build/generated/ios/fixture.h'],
]) {
  test(`delegated ${phase} output ${file} is rejected before any foreign write`, async () => {
    const foreign = fs.mkdtempSync('/tmp/ios-fcm-delegated-foreign-');
    for (const name of ['target', 'sentinel'])
      fs.writeFileSync(path.join(foreign, name), 'foreign delegated sentinel');
    const before = fs
      .readdirSync(foreign)
      .map(name => [name, digest(fs.readFileSync(path.join(foreign, name)))]);
    try {
      const result = await lifecycle({ hostileDelegated: { phase, file }, foreign });
      assert.equal(result.rejected, 'PATH_CONFINEMENT_VIOLATION');
      assert.equal(result.workspaceExists, false);
      assert.deepEqual(
        fs
          .readdirSync(foreign)
          .map(name => [name, digest(fs.readFileSync(path.join(foreign, name)))]),
        before,
      );
    } finally {
      fs.rmSync(foreign, { recursive: true });
    }
  });
}
