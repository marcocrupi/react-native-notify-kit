#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { runBounded } = require('./lib/ios-fcm-process');
const {
  QualificationError,
  fail,
  now,
  digest,
  expectedEnvironment,
  checkEnvironment,
  redact,
  classify,
  QualificationSession,
  runMatrix,
  patchAppDelegate,
} = require('./lib/ios-fcm-qualification');
const { inspectSignedApp, inspectCompiledRNFirebase } = require('./lib/ios-fcm-artifact');

const {
  createOwnedRuntime,
  assertOwnedRuntime,
  writeMetroConfig,
  artifactManifest,
  createOwnedRoot,
  assertOwnedPath,
  ensureOwnedDirectory,
  writeOwnedFile,
  openOwnedLog,
  assertOwnedTree,
  copyOwnedFile,
  copyOwnedTree,
  cleanupOwnedWorkspace,
} = require('./lib/ios-fcm-runtime');

const REPO = path.resolve(__dirname, '..');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const exec = (command, args, options = {}) => {
  assertWorking();
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
    timeout: 10000,
    killSignal: 'SIGKILL',
    env: activeRun?.runtime?.env ?? process.env,
  });
};
const note = value => console.log('[ios-fcm-qualification] ' + JSON.stringify(value));
const ownedChildren = new Map();
let loggingSecrets = [];
let activeRun;

function assertWorking() {
  if (activeRun?.interruptionError) throw activeRun.interruptionError;
  if (activeRun?.closing) fail('QUALIFICATION_TOOLING_FAILURE', 'Qualification work has closed.');
}

async function executeOwned(command, args, options = {}, role = 'work') {
  const executionRun = activeRun;
  let child, owner;
  try {
    const result = await runBounded(command, args, {
      ...options,
      env: executionRun?.runtime?.env ?? {
        ...process.env,
        IOS_FCM_TOKEN: '',
        FCM_TOKEN: '',
        ANDROID_FCM_TOKEN: '',
      },
      onSpawn: (value, control) => {
        child = value;
        owner = { run: executionRun, role, control };
        ownedChildren.set(child, owner);
        options.onSpawn?.(value, control);
      },
    });
    executionRun?.processes.push({ role, command: path.basename(command), ...result.process });
    ownedChildren.delete(child);
    return result;
  } catch (error) {
    if (error.process)
      executionRun?.processes.push({ role, command: path.basename(command), ...error.process });
    if (error.code === 'PROCESS_SETTLEMENT_UNPROVEN' && owner) owner.unproven = true;
    else ownedChildren.delete(child);
    throw error;
  }
}

async function artifactExecutor(command, args, options = {}) {
  const target = args.at(-1);
  const expected = activeRun?.runtime?.paths.workspace;
  const allowed =
    (command === 'codesign' &&
      (args.slice(0, 2).join(' ') === '--verify --strict' ||
        args.slice(0, 4).join(' ') === '--display --entitlements - --xml')) ||
    (command === 'plutil' && args.slice(0, 4).join(' ') === '-convert json -o -');
  if (
    !allowed ||
    (target !== '-' && (!expected || !path.resolve(target).startsWith(expected + path.sep)))
  )
    fail('QUALIFICATION_CLEANUP_REFUSED', 'Artifact inspection is outside the owned runtime.');
  if (target !== '-')
    assertOwnedPath(activeRun.runtime.owner, target, { directory: command === 'codesign' });
  if (!activeRun.closing) assertWorking();
  const result = await executeOwned(
    command,
    args,
    { ...options, timeoutMs: 30000, timeoutCode: 'ARTIFACT_VERIFICATION_TIMEOUT' },
    activeRun.closing ? 'cleanup' : 'work',
  );
  if (!activeRun.closing) assertWorking();
  return result.stdout;
}

function parseArgs(argv, env = process.env) {
  const options = {
    configuration: env.IOS_FCM_CONFIGURATION || 'Release',
    mode: env.IOS_FCM_APNS_ASSOCIATION || 'default',
    device: env.IOS_DEVICE_ID || '',
    callbackHost: env.SMOKE_CALLBACK_HOST || '',
    scenarios: [],
    output: '',
    requireNse: true,
  };
  const names = {
    '--configuration': 'configuration',
    '--apns-association': 'mode',
    '--device': 'device',
    '--callback-host': 'callbackHost',
    '--output': 'output',
    '--scenario': 'scenario',
    '--correlation-id': 'correlationId',
  };
  for (let index = 0; index < argv.length; index++) {
    if (['--help', '-h'].includes(argv[index])) return { help: true };
    const key = names[argv[index]];
    if (!key || !argv[index + 1] || argv[index + 1].startsWith('--'))
      fail('QUALIFICATION_CONFIGURATION', 'Unsupported or incomplete qualification option.');
    const value = argv[++index];
    if (key === 'scenario') options.scenarios.push(value);
    else options[key] = value;
  }
  if (
    !['Debug', 'Release'].includes(options.configuration) ||
    !['default', 'signed-entitlement'].includes(options.mode)
  )
    fail(
      'QUALIFICATION_CONFIGURATION',
      'Use Debug/Release and default/signed-entitlement association.',
    );
  for (const scenario of options.scenarios)
    if (!['minimal', 'ios-attachment', 'kitchen-sink', 'emoji', 'marketing'].includes(scenario))
      fail('QUALIFICATION_CONFIGURATION', 'Unsupported iOS functional scenario.');
  if (
    options.correlationId &&
    (!/^[A-Za-z0-9_-]{1,128}$/.test(options.correlationId) || options.scenarios.length !== 1)
  )
    fail(
      'QUALIFICATION_CONFIGURATION',
      'Correlation ID requires one scenario and 1-128 safe characters.',
    );
  return options;
}

function inventory(root = REPO) {
  assertWorking();
  const data = Object.fromEntries(
    identityCommands().map(([name, args]) => [name, exec('git', args, { cwd: root })]),
  );
  return identityManifest(root, data);
}

function identityCommands() {
  return [
    ['tracked', ['ls-files', '-z']],
    ['untracked', ['ls-files', '--others', '--exclude-standard', '-z']],
    ['status', ['status', '--porcelain=v1', '-uall']],
    ['staging', ['diff', '--cached', '--name-only']],
    ['head', ['rev-parse', 'HEAD']],
    ['branch', ['branch', '--show-current']],
  ];
}

async function inventoryAsync(root = REPO) {
  const data = {};
  for (const [name, args] of identityCommands())
    data[name] = (
      await executeOwned(
        'git',
        args,
        {
          cwd: root,
          timeoutMs: 10000,
          timeoutCode: 'IDENTITY_VERIFICATION_TIMEOUT',
        },
        activeRun?.closing ? 'cleanup' : 'work',
      )
    ).stdout;
  return identityManifest(root, data);
}

function identityManifest(root, data) {
  const tracked = data.tracked.split('\0').filter(Boolean);
  const untracked = data.untracked.split('\0').filter(Boolean);
  const status = data.status;
  if (data.staging.trim())
    fail('CANDIDATE_IDENTITY_MISMATCH', 'Qualification requires empty staging.');
  for (const line of status.split('\n').filter(Boolean)) {
    const filename = line.slice(3);
    if (!(filename.startsWith('scripts/') || filename === 'apps/smoke/README.md'))
      fail(
        'CANDIDATE_IDENTITY_MISMATCH',
        'Unexpected workspace drift outside this tooling candidate.',
      );
  }
  const files = [...new Set([...tracked, ...untracked])].sort().map(filename => {
    const full = path.join(root, filename);
    if (!fs.existsSync(full))
      fail('CANDIDATE_IDENTITY_MISMATCH', 'Candidate contains a removed file.');
    const stat = fs.lstatSync(full);
    return {
      path: filename,
      mode: stat.mode % 0o1000,
      sha256: digest(stat.isSymbolicLink() ? fs.readlinkSync(full) : fs.readFileSync(full)),
    };
  });
  const sourceNames = [
    'apps/smoke/node_modules/@react-native-firebase/messaging/ios/RNFBMessaging/RNFBMessaging+AppDelegate.m',
    'apps/smoke/ios/Pods/FirebaseMessaging/FirebaseMessaging/Sources/FIRMessaging.m',
    'apps/smoke/ios/Pods/FirebaseMessaging/FirebaseMessaging/Sources/Token/FIRMessagingTokenManager.m',
    'apps/smoke/ios/Pods/GoogleUtilities/GoogleUtilities/AppDelegateSwizzler/GULAppDelegateSwizzler.m',
  ];
  const installedSources = sourceNames.map(filename => ({
    path: filename,
    sha256: digest(fs.readFileSync(path.join(root, filename))),
  }));
  return {
    head: data.head.trim(),
    branch: data.branch.trim(),
    status,
    files,
    installedSources,
    fingerprint: digest(JSON.stringify({ files, installedSources })),
  };
}

function assertIdentity(initial) {
  assertWorking();
  const current = inventory();
  compareIdentity(initial, current);
}

async function assertCleanupIdentity(initial) {
  const current = await inventoryAsync();
  compareIdentity(initial, current);
}

function compareIdentity(initial, current) {
  if (
    current.head !== initial.head ||
    current.fingerprint !== initial.fingerprint ||
    current.status !== initial.status
  )
    fail('CANDIDATE_IDENTITY_MISMATCH', 'Candidate identity changed during qualification.');
}

function deviceId(requested) {
  const data = JSON.parse(
    exec('xcrun', [
      'devicectl',
      'list',
      'devices',
      '--timeout',
      '10',
      '--json-output',
      '-',
      '--quiet',
    ]),
  );
  const devices = (data.result?.devices ?? []).filter(
    device =>
      device.hardwareProperties?.platform === 'iOS' &&
      device.hardwareProperties?.reality === 'physical' &&
      device.connectionProperties?.pairingState === 'paired',
  );
  const matches = requested
    ? devices.filter(device =>
        [device.identifier, device.hardwareProperties?.udid].includes(requested),
      )
    : devices;
  if (matches.length !== 1)
    fail('QUALIFICATION_CONFIGURATION', 'Select exactly one paired physical iPhone with --device.');
  return {
    id: matches[0].hardwareProperties.udid ?? matches[0].identifier,
    name: matches[0].deviceProperties?.name,
    osVersion: matches[0].deviceProperties?.osVersionNumber,
  };
}

function callbackHost(requested) {
  let host = requested;
  if (!host)
    for (const iface of ['en0', 'en1']) {
      try {
        host = exec('ipconfig', ['getifaddr', iface]).trim();
      } catch {
        /* try the next interface */
      }
      if (host) break;
    }
  if (
    !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(host) ||
    host.startsWith('127.') ||
    host === '0.0.0.0'
  )
    fail('QUALIFICATION_CONFIGURATION', 'A device-reachable IPv4 callback host is required.');
  return host;
}

async function commandLog(command, args, cwd, filename, secrets = []) {
  assertWorking();
  if (activeRun?.runtime) protectCommandOutputs(command, args, cwd);
  const result = await collectCommand(command, args, cwd, filename, secrets, 'work');
  assertWorking();
  return result;
}

function protectCommandOutputs(command, args, cwd) {
  const runtime = activeRun.runtime;
  assertOwnedRuntime(runtime);
  const workspace = runtime.paths.workspace;
  const directories = [runtime.paths.runtime];
  if (command === 'bash' && args.includes('build_ios_core.sh'))
    directories.push(path.join(workspace, 'packages/react-native/ios/NotifeeCore'));
  if (command === 'yarn') {
    if (args.includes('build:rn')) {
      directories.push(path.join(workspace, 'packages/react-native/dist'));
      assertOwnedPath(runtime.owner, path.join(workspace, 'packages/react-native/src/version.ts'), {
        createParents: true,
      });
    }
    if (args.includes('build:rn:server'))
      directories.push(path.join(workspace, 'packages/react-native/server/dist'));
    if (args.includes('build')) directories.push(path.join(cwd, 'dist'));
  }
  if (args.includes('init-nse')) {
    directories.push(path.join(workspace, 'apps/smoke/ios/NotifyKitNSE'));
  }
  if (args.includes('init-nse') || command === 'pod') {
    const ios = path.join(workspace, 'apps/smoke/ios');
    assertOwnedPath(runtime.owner, ios, { directory: true });
    for (const file of ['Podfile', 'Podfile.lock', 'NotifeeExample.xcodeproj/project.pbxproj'])
      assertOwnedPath(runtime.owner, path.join(ios, file), { createParents: true });
    for (const file of fs.readdirSync(ios).filter(name => name.startsWith('Podfile.bak.')))
      assertOwnedPath(runtime.owner, path.join(ios, file));
    directories.push(path.join(ios, 'NotifeeExample.xcodeproj'));
  }
  if (command === 'xcodebuild') directories.push(path.join(workspace, 'DerivedData'));
  if (command === 'pod') {
    const ios = path.join(workspace, 'apps/smoke/ios');
    const pods = path.join(ios, 'Pods');
    assertOwnedPath(runtime.owner, pods, {
      directory: true,
    });
    assertOwnedPath(runtime.owner, path.join(pods, 'Manifest.lock'), { createParents: true });
    for (const directory of [
      'Pods/Pods.xcodeproj',
      'Pods/Target Support Files',
      'Pods/Local Podspecs',
      'NotifeeExample.xcworkspace',
      'build',
    ])
      directories.push(path.join(ios, directory));
  }
  for (const directory of directories) assertOwnedTree(runtime.owner, directory);
}

function generatedFile(filename, bytes, options) {
  assertWorking();
  writeOwnedFile(activeRun.runtime.owner, filename, bytes, options);
}

// Private process backend. Cleanup reaches this only through the registered
// owned-device actions below; no caller-facing cancellation bypass exists.
async function collectCommand(command, args, cwd, filename, secrets, role, timeout = 0) {
  const log = openOwnedLog(
    activeRun?.outputOwner ?? createOwnedRoot(path.dirname(filename)),
    filename,
  );
  let pending = '';
  const compilerInvocations = [];
  const consume = chunk => {
    pending += chunk.toString();
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) {
      // Keep exact compiler paths in memory: redaction also masks SDK cache hashes.
      // Persisted logs remain redacted; only this input feeds compiler replay.
      if (
        /^\s*\/.*\/clang\s/.test(line) &&
        line.includes('RNFBMessaging+AppDelegate.m') &&
        /\s-c\s/.test(line)
      )
        compilerInvocations.push(line);
      log.write(redact(line, [...loggingSecrets, ...secrets]) + '\n');
    }
  };
  let processEvidence;
  try {
    processEvidence = (
      await executeOwned(
        command,
        args,
        {
          cwd,
          timeoutMs: timeout,
          capture: false,
          maxBuffer: 256 * 1024 * 1024,
          onStdout: consume,
          onStderr: consume,
        },
        role,
      )
    ).process;
  } finally {
    if (pending) log.write(redact(pending, [...loggingSecrets, ...secrets]) + '\n');
    await closeLog(log);
  }
  return { compilerInvocations, process: processEvidence };
}

function closeLog(log) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      log.destroy();
      reject(
        new QualificationError(
          'QUALIFICATION_TOOLING_FAILURE',
          'Owned log settlement is unproven.',
        ),
      );
    }, 3000);
    log.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    log.end(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function copyWorkspace(root, initial, runId, report) {
  const workspace = path.join(root, 'workspace');
  if (fs.readFileSync(path.join(workspace, '.qualification-owner'), 'utf8') !== runId)
    fail('QUALIFICATION_CLEANUP_REFUSED', 'Workspace creation ownership differs from this run.');
  for (const file of initial.files) {
    const from = path.join(REPO, file.path),
      to = path.join(workspace, file.path);
    if (fs.lstatSync(from).isSymbolicLink()) copyOwnedTree(activeRun.runtime.owner, from, to);
    else copyOwnedFile(activeRun.runtime.owner, from, to, { mode: file.mode });
  }
  const dependencies = [
    'node_modules',
    'apps/smoke/node_modules',
    'packages/react-native/node_modules',
    'packages/cli/node_modules',
    'apps/smoke/ios/Pods',
  ];
  for (const dependency of dependencies) {
    const from = path.join(REPO, dependency);
    if (fs.existsSync(from)) {
      assertOwnedPath(activeRun.runtime.owner, path.join(workspace, dependency), {
        createParents: true,
        directory: true,
      });
      assertOwnedTree(activeRun.runtime.owner, path.join(workspace, dependency));
      await commandLog(
        'cp',
        ['-cR', from, path.join(workspace, dependency)],
        REPO,
        path.join(report, `copy-${dependency.replaceAll('/', '-')}.log`),
      );
    }
  }
  const firebaseConfig = 'apps/smoke/ios/GoogleService-Info.plist';
  if (!fs.existsSync(path.join(REPO, firebaseConfig)))
    fail('QUALIFICATION_CONFIGURATION', 'Smoke Firebase app configuration is missing.');
  copyOwnedFile(
    activeRun.runtime.owner,
    path.join(REPO, firebaseConfig),
    path.join(workspace, firebaseConfig),
  );
  assertIdentity(initial);
  return workspace;
}

function createCallback(runId, secret) {
  const context = {
    session: null,
    error: null,
    pending: null,
    deletion: null,
    generation: null,
    bootCount: 0,
    nativeDelivery: null,
    stopped: false,
    cleanupDriverActive: false,
  };
  const server = http.createServer(async (request, response) => {
    const reply = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    if (request.method !== 'POST' || request.headers.authorization !== 'Bearer ' + secret)
      return reply(403, { error: 'unauthorized' });
    let bytes = 0,
      body = '';
    try {
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 128 * 1024) fail('QUALIFICATION_CALLBACK_REJECTED', 'Callback body too large.');
        body += chunk.toString();
      }
      const value = JSON.parse(body);
      if (value.runId !== runId || !context.session)
        fail('CANDIDATE_IDENTITY_MISMATCH', 'Foreign or premature qualification callback.');
      if (context.stopped) {
        if (request.url === '/next') {
          if (context.pending?.command.action !== 'restore-settings') return reply(200, null);
        } else if (
          !(request.url === '/boot' && context.cleanupDriverActive) &&
          !(request.url === '/result' && context.pending?.command.action === 'restore-settings')
        )
          throw (
            context.error ??
            new QualificationError(
              'T0_GATE_REQUIRED',
              'Qualification callback authority has closed.',
            )
          );
      }
      if (request.url === '/native') {
        if (value.errorCode) fail(value.errorCode, 'Native initial APNs association failed.');
        context.session.ready(value);
      } else if (request.url === '/delivery') {
        if (!Array.isArray(value.notifications) || !Number.isFinite(Date.parse(value.timestamp)))
          fail('QUALIFICATION_CALLBACK_REJECTED', 'Invalid native delivery evidence.');
        context.nativeDelivery = value;
      } else if (request.url === '/boot') context.bootCount++;
      else if (request.url === '/next') {
        const command =
          context.pending && !context.pending.dispatched ? context.pending.command : null;
        if (command) context.pending.dispatched = true;
        return reply(200, command);
      } else {
        if (!context.pending || value.commandId !== context.pending.command.id)
          fail('STALE_FCM_TOKEN_ASSOCIATION', 'Stale qualification command callback.');
        if (request.url === '/event') {
          if (context.pending.command.action !== 'regenerate')
            fail('STALE_FCM_TOKEN_ASSOCIATION', 'Token event outside regeneration.');
          if (value.kind === 'delete-started') context.deletion = context.session.beginDelete();
          else if (value.kind === 'delete-completed')
            context.session.completeDelete(context.deletion);
          else if (value.kind === 'generation-started')
            context.generation = context.session.beginGeneration();
          else fail('STALE_FCM_TOKEN_ASSOCIATION', 'Unknown token sequence event.');
        } else if (request.url === '/token') {
          if (context.pending.command.action !== 'regenerate')
            fail('STALE_FCM_TOKEN_ASSOCIATION', 'Token outside regeneration.');
          context.session.completeGeneration(context.generation, value.token);
        } else if (request.url === '/result') {
          if (value.status !== 'OK') {
            context.pending.error = new QualificationError(
              value.errorCode || 'QUALIFICATION_DRIVER_FAILURE',
              'Qualification device driver failed.',
            );
            throw context.pending.error;
          }
          context.pending.result = value.result;
        } else return reply(404, { error: 'unknown route' });
      }
      reply(200, { ok: true });
    } catch (error) {
      context.error ??=
        error instanceof QualificationError
          ? error
          : new QualificationError('QUALIFICATION_CALLBACK_REJECTED', 'Invalid device callback.');
      reply(400, { error: context.error.code });
    }
  });
  return { context, server };
}

async function driverCommand(context, action, timeout = 35000) {
  if (context.error && action !== 'restore-settings') throw context.error;
  if (context.stopped && (action !== 'restore-settings' || !context.cleanupDriverActive))
    fail('QUALIFICATION_CLEANUP_REFUSED', 'Device command is not a registered cleanup action.');
  if (context.pending)
    fail('QUALIFICATION_TOOLING_FAILURE', 'Only one device command may be active.');
  context.pending = {
    command: { id: crypto.randomUUID(), action },
    dispatched: false,
    result: null,
  };
  const deadline = Date.now() + timeout;
  try {
    while (Date.now() < deadline) {
      if (context.pending.error) throw context.pending.error;
      if (context.error && action !== 'restore-settings') throw context.error;
      if (context.pending.result) return context.pending.result;
      await pause(150);
    }
    fail(
      action === 'readiness' ? 'APNS_TOKEN_UNAVAILABLE' : 'QUALIFICATION_DRIVER_TIMEOUT',
      'Timed out waiting for the installed qualification driver.',
    );
  } finally {
    context.pending = null;
  }
}

function writeDriver(workspace, config) {
  const app = path.join(workspace, 'apps/smoke');
  const template = fs.readFileSync(
    path.join(__dirname, 'fixtures/ios-fcm-qualification/App.tsx.template'),
    'utf8',
  );
  generatedFile(
    path.join(app, 'App.tsx'),
    template.replace('__QUALIFICATION_CONFIG__', JSON.stringify(config)),
  );
  generatedFile(
    path.join(app, 'index.js'),
    `import '@react-native-firebase/app';\nimport '@react-native-firebase/messaging';\nimport { AppRegistry } from 'react-native';\nimport App from './App';\nimport { name } from './app.json';\nAppRegistry.registerComponent(name, () => App);\n`,
  );
}

async function bundleDriver(workspace, configuration, reportDir, phase) {
  assertWorking();
  const metroConfig = writeMetroConfig(activeRun.runtime);
  const native = path.join(workspace, 'apps/smoke/ios/NotifeeExample');
  const bundle = path.join(native, 'main.jsbundle');
  const projectFile = path.join(
    workspace,
    'apps/smoke/ios/NotifeeExample.xcodeproj/project.pbxproj',
  );
  assertOwnedPath(activeRun.runtime.owner, projectFile);
  assertOwnedPath(activeRun.runtime.owner, bundle, { createParents: true });
  assertOwnedTree(activeRun.runtime.owner, native);
  const staging = path.join(activeRun.runtime.paths.runtime, 'bundle-' + crypto.randomUUID());
  ensureOwnedDirectory(activeRun.runtime.owner, staging);
  const stagedBundle = path.join(staging, 'main.jsbundle');
  const assets = path.join(staging, 'assets');
  ensureOwnedDirectory(activeRun.runtime.owner, assets);
  await commandLog(
    process.execPath,
    [
      path.join(workspace, 'apps/smoke/node_modules/react-native/cli.js'),
      'bundle',
      '--config',
      metroConfig,
      '--platform',
      'ios',
      '--dev',
      configuration === 'Debug' ? 'true' : 'false',
      '--entry-file',
      'index.js',
      '--bundle-output',
      stagedBundle,
      '--assets-dest',
      assets,
      '--reset-cache',
    ],
    path.join(workspace, 'apps/smoke'),
    path.join(reportDir, phase + '-bundle.log'),
  );
  assertOwnedTree(activeRun.runtime.owner, staging);
  copyOwnedFile(activeRun.runtime.owner, stagedBundle, bundle);
  copyOwnedTree(activeRun.runtime.owner, assets, native);
  const requireWorkspace = createRequire(path.join(workspace, 'packages/cli/package.json'));
  const xcode = requireWorkspace('xcode');
  assertOwnedPath(activeRun.runtime.owner, projectFile);
  const project = xcode.project(projectFile);
  project.parseSync();
  if (phase === 'pilot') wireDriverResource(project);
  generatedFile(projectFile, project.writeSync());
}

function wireDriverResource(project) {
  const target = Object.entries(project.pbxNativeTargetSection()).find(
    ([key, value]) => !key.endsWith('_comment') && value.name === 'NotifeeExample',
  );
  if (!target) fail('QUALIFICATION_CONFIGURATION', 'Smoke application target is missing.');
  const group = Object.entries(project.hash.project.objects.PBXGroup).find(
    ([key, value]) => !key.endsWith('_comment') && value.name === 'NotifeeExample',
  );
  if (!group) fail('QUALIFICATION_CONFIGURATION', 'Smoke application group is missing.');
  // The bare fixture has no Resources PBXGroup. Use its application group and
  // the existing target's resource build phase, without xcode's default-group assumption.
  const file = project.addFile('NotifeeExample/main.jsbundle', group[0], {
    lastKnownFileType: 'text',
    defaultEncoding: 4,
  });
  if (!file) fail('QUALIFICATION_CONFIGURATION', 'Diagnostic bundle resource already exists.');
  file.uuid = project.generateUuid();
  file.target = target[0];
  project.addToPbxBuildFileSection(file);
  project.addToPbxResourcesBuildPhase(file);
}

async function writeNativeDriver(workspace, config) {
  const native = path.join(workspace, 'apps/smoke/ios/NotifeeExample');
  const source = fs.readFileSync(
    path.join(REPO, 'apps/smoke/ios/NotifeeExample/AppDelegate.swift'),
    'utf8',
  );
  generatedFile(path.join(native, 'AppDelegate.swift'), patchAppDelegate(source, config));
  const info = path.join(native, 'Info.plist');
  assertOwnedPath(activeRun.runtime.owner, info);
  const staging = path.join(activeRun.runtime.paths.runtime, 'plist-' + crypto.randomUUID());
  ensureOwnedDirectory(activeRun.runtime.owner, staging);
  const stagedInfo = path.join(staging, 'Info.plist');
  copyOwnedFile(activeRun.runtime.owner, info, stagedInfo);
  const edit = async args => {
    assertWorking();
    assertOwnedPath(activeRun.runtime.owner, stagedInfo);
    await executeOwned('plutil', [...args, stagedInfo], {
      timeoutMs: 30000,
      timeoutCode: 'ARTIFACT_VERIFICATION_TIMEOUT',
    });
    assertWorking();
    assertOwnedPath(activeRun.runtime.owner, stagedInfo);
  };
  await edit(['-insert', 'FirebaseMessagingAutoInitEnabled', '-bool', 'NO']);
  await edit(['-replace', 'NSAppTransportSecurity.NSAllowsArbitraryLoads', '-bool', 'YES']);
  await edit([
    '-insert',
    'NSLocalNetworkUsageDescription',
    '-string',
    'Connect to the temporary iOS FCM qualification controller.',
  ]);
  if (config.mode === 'signed-entitlement')
    await edit(['-insert', 'FirebaseAppDelegateProxyEnabled', '-bool', 'NO']);
  copyOwnedFile(activeRun.runtime.owner, stagedInfo, info);
}

async function build(workspace, output, device, configuration, phase) {
  const filename = path.join(output, `${phase}-xcodebuild.log`);
  const requireWorkspace = createRequire(path.join(workspace, 'packages/cli/package.json'));
  const project = requireWorkspace('xcode').project(
    path.join(workspace, 'apps/smoke/ios/NotifeeExample.xcodeproj/project.pbxproj'),
  );
  project.parseSync();
  const team = smokeSigningTeam(project, configuration);
  note({ phase, configuration });
  const compilation = await commandLog(
    'xcodebuild',
    [
      '-workspace',
      path.join(workspace, 'apps/smoke/ios/NotifeeExample.xcworkspace'),
      '-scheme',
      'NotifeeExample',
      '-configuration',
      configuration,
      '-destination',
      'id=' + device,
      '-derivedDataPath',
      path.join(workspace, 'DerivedData'),
      '-allowProvisioningUpdates',
      'IPHONEOS_DEPLOYMENT_TARGET=15.1',
      'DEVELOPMENT_TEAM=' + team,
      'SKIP_BUNDLING=1',
      'build',
    ],
    path.join(workspace, 'apps/smoke'),
    filename,
  );
  return { filename, compilerInvocations: compilation.compilerInvocations };
}

function smokeSigningTeam(project, configuration) {
  const target = Object.entries(project.pbxNativeTargetSection()).find(
    ([key, value]) => !key.endsWith('_comment') && value.name === 'NotifeeExample',
  )?.[1];
  const list = project.pbxXCConfigurationList()[target?.buildConfigurationList];
  const configs = project.pbxXCBuildConfigurationSection();
  const config = list?.buildConfigurations
    .map(value => configs[value.value])
    .find(value => value.name === configuration);
  const team = config?.buildSettings?.DEVELOPMENT_TEAM?.replaceAll('"', '');
  if (!/^[A-Z0-9]{10}$/.test(team ?? ''))
    fail(
      'QUALIFICATION_CONFIGURATION',
      'The smoke application signing team is missing or unverifiable.',
    );
  return team;
}

async function deviceCommand(args, device, output, label, role) {
  const filename = path.join(output, label + '.json');
  assertOwnedPath(activeRun.outputOwner, filename);
  const command = [
    'devicectl',
    ...args.slice(0, 3),
    '--device',
    device,
    '--timeout',
    '25',
    '--json-output',
    filename,
    ...args.slice(3),
  ];
  await collectCommand('xcrun', command, REPO, path.join(output, label + '.log'), [], role, 30000);
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

async function devicectl(args, device, output, label) {
  assertWorking();
  const driver = activeRun?.driver;
  const installing = args[1] === 'install' && args[3] === driver?.app;
  const launching =
    args[1] === 'process' && args[2] === 'launch' && args.at(-1) === driver?.artifact.bundleId;
  // Already-dispatched native mutations settle and record ownership before
  // cancellation is rethrown. This never authorizes another operation.
  const data = await deviceCommand(
    args,
    device,
    output,
    label,
    installing || launching ? 'settlement' : 'work',
  );
  if (installing) driver.receipt = data;
  if (launching) driver.pid = data.result?.process?.processIdentifier;
  if (args[2] === 'terminate' && args.at(-1) === String(driver?.pid)) driver.pid = null;
  assertWorking();
  return data;
}

function startDeviceLog(device, output, secrets) {
  assertWorking();
  const lines = [];
  const filename = path.join(output, 'device-system-redacted.log');
  const stream = openOwnedLog(activeRun.outputOwner, filename);
  let control;
  let pending = '',
    error = null;
  const consume = chunk => {
    pending += chunk.toString();
    const complete = pending.split('\n');
    pending = complete.pop();
    for (const line of complete) {
      if (
        !/NotifyKitNSE|NotifeeExample/i.test(line) ||
        /token|Bearer|authorization|credential|private.key|APA91/i.test(line)
      )
        continue;
      const safe = now() + ' ' + redact(line, secrets());
      lines.push(safe);
      stream.write(safe + '\n');
    }
  };
  const settled = executeOwned('idevicesyslog', ['-u', device, '--no-colors'], {
    timeoutMs: 0,
    capture: false,
    acceptStopped: true,
    onSpawn: (_, value) => {
      control = value;
    },
    onStdout: consume,
  });
  settled.then(
    () => {
      error ??= new Error('Device log relay exited.');
    },
    value => {
      error = value;
    },
  );
  return {
    lines,
    error: () => error,
    stop: async () => {
      control?.stop();
      try {
        await settled;
      } finally {
        await closeLog(stream);
      }
    },
  };
}

function proveAppAbsent(data, stoppedPID) {
  const remaining = data.result?.runningProcesses ?? data.result?.processes;
  if (
    data.info?.outcome !== 'success' ||
    !Array.isArray(remaining) ||
    remaining.some(
      process =>
        !Number.isInteger(process.processIdentifier) ||
        typeof process.executable !== 'string' ||
        process.processIdentifier === stoppedPID ||
        process.executable.endsWith('/NotifeeExample'),
    )
  )
    fail('QUALIFICATION_DRIVER_FAILURE', 'Main app absence before NSE delivery is not proven.');
}

function verifyInstallation(receipt, apps, artifact) {
  const installed = receipt.result?.installedApplications?.filter(
    app => app.bundleID === artifact.bundleId,
  );
  const current = apps.result?.apps?.filter(app => app.bundleIdentifier === artifact.bundleId);
  if (
    receipt.info?.outcome !== 'success' ||
    apps.info?.outcome !== 'success' ||
    installed?.length !== 1 ||
    current?.length !== 1 ||
    !installed[0].installationURL ||
    current[0].url !== installed[0].installationURL
  )
    fail(
      'CANDIDATE_IDENTITY_MISMATCH',
      'Installed app identity differs from the verified artifact installation receipt.',
    );
  return installed[0].installationURL;
}

function registerDeviceCleanup(resources, summary, callback, initial) {
  const driver = resources.driver;
  const pilot = resources.pilot;
  const own = () => {
    if (activeRun !== resources || !resources.closing || !driver.receipt || !pilot)
      fail('QUALIFICATION_CLEANUP_REFUSED', 'Cleanup resource was not registered by this run.');
    assertOwnedRuntime(resources.runtime);
  };
  const queryApps = async label => {
    own();
    return verifyInstallation(
      driver.receipt,
      await deviceCommand(
        ['device', 'info', 'apps'],
        summary.device.id,
        summary.output,
        label,
        'cleanup',
      ),
      driver.artifact,
    );
  };
  const queryProcesses = label => {
    own();
    return deviceCommand(
      ['device', 'info', 'processes'],
      summary.device.id,
      summary.output,
      label,
      'cleanup',
    );
  };
  const stop = async () => {
    own();
    if (!driver.pid && summary.driverCleanup === 'PASS') return;
    summary.driverCleanup = 'UNPROVEN';
    const url = await queryApps('cleanup-before-stop-apps');
    const data = await queryProcesses('cleanup-before-stop-processes');
    const processes = data.result?.runningProcesses ?? data.result?.processes;
    if (data.info?.outcome !== 'success' || !Array.isArray(processes))
      fail('QUALIFICATION_CLEANUP_REFUSED', 'Owned process inventory is unavailable.');
    if (driver.pid) {
      const matches = processes.filter(process => process.processIdentifier === driver.pid);
      if (
        matches.length &&
        (matches.length !== 1 ||
          matches[0].executable?.replace(/^file:\/\//, '') !==
            (url + 'NotifeeExample').replace(/^file:\/\//, ''))
      )
        fail(
          'QUALIFICATION_CLEANUP_REFUSED',
          'Registered PID no longer belongs to this installed driver.',
        );
      if (matches.length)
        await deviceCommand(
          ['device', 'process', 'terminate', '--pid', String(driver.pid)],
          summary.device.id,
          summary.output,
          'cleanup-driver-terminate',
          'cleanup',
        );
    }
    proveAppAbsent(await queryProcesses('cleanup-driver-stopped-processes'), driver.pid);
    driver.pid = null;
    summary.driverCleanup = 'PASS';
  };
  resources.actions.set('stop-owned-pid', stop);
  resources.actions.set('restore-settings', async () => {
    own();
    if (summary.standardAutoInitRestore === 'PASS') return;
    summary.standardAutoInitRestore = 'UNPROVEN';
    if (driver.replaced)
      fail('QUALIFICATION_CLEANUP_REFUSED', 'Owned diagnostic driver has already been replaced.');
    if (summary.finalGitIdentity !== 'UNCHANGED')
      fail('QUALIFICATION_CLEANUP_REFUSED', 'Settings restoration refused after candidate drift.');
    await queryApps('cleanup-before-settings-apps');
    // A revoked in-flight driver command can stop its polling loop. Restart
    // only this owned driver before asking it to perform settings cleanup.
    if (resources.interruptionError && driver.pid) await stop();
    callback.context.cleanupDriverActive = true;
    if (!driver.pid) {
      const launched = await deviceCommand(
        ['device', 'process', 'launch', '--terminate-existing', driver.artifact.bundleId],
        summary.device.id,
        summary.output,
        'cleanup-settings-launch',
        'cleanup',
      );
      driver.pid = launched.result?.process?.processIdentifier;
      if (!Number.isInteger(driver.pid) || driver.pid <= 0)
        fail('QUALIFICATION_CLEANUP_REFUSED', 'Cleanup driver launch has no owned PID.');
    }
    const settings = await driverCommand(callback.context, 'restore-settings');
    if (settings.autoInitEnabled !== (pilot.artifact.autoInitPlist !== false))
      fail('QUALIFICATION_CLEANUP_REFUSED', 'Standard fixture auto-init restoration is unproven.');
    summary.standardAutoInitRestore = 'PASS';
  });
  resources.actions.set('reinstall-pilot', async () => {
    own();
    if (summary.standardFixtureRestore === 'PASS') return;
    summary.standardFixtureRestore = 'UNPROVEN';
    if (summary.finalGitIdentity !== 'UNCHANGED')
      fail('QUALIFICATION_CLEANUP_REFUSED', 'Pilot restoration refused after candidate drift.');
    await assertCleanupIdentity(initial);
    if (artifactManifest(pilot.app) !== pilot.manifestSHA256)
      fail('QUALIFICATION_CLEANUP_REFUSED', 'Complete standard pilot archive identity changed.');
    const actual = await inspectSignedApp(pilot.app, {
      requireNse: true,
      execute: artifactExecutor,
    });
    verifyArtifactIdentity(pilot.artifact, actual);
    await queryApps('cleanup-before-restore-apps');
    // Recheck after the last asynchronous ownership query, immediately before
    // dispatch. A changed archive must never reach the installation command.
    own();
    await assertCleanupIdentity(initial);
    if (artifactManifest(pilot.app) !== pilot.manifestSHA256)
      fail('QUALIFICATION_CLEANUP_REFUSED', 'Standard pilot changed during its ownership query.');
    verifyArtifactIdentity(
      pilot.artifact,
      await inspectSignedApp(pilot.app, { requireNse: true, execute: artifactExecutor }),
    );
    own();
    if (artifactManifest(pilot.app) !== pilot.manifestSHA256)
      fail(
        'QUALIFICATION_CLEANUP_REFUSED',
        'Standard pilot changed during asynchronous signature inspection.',
      );
    summary.standardFixtureInstallation = await deviceCommand(
      ['device', 'install', 'app', pilot.app],
      summary.device.id,
      summary.output,
      'cleanup-standard-fixture-install',
      'cleanup',
    );
    driver.replaced = true;
    verifyInstallation(
      summary.standardFixtureInstallation,
      await deviceCommand(
        ['device', 'info', 'apps'],
        summary.device.id,
        summary.output,
        'cleanup-standard-fixture-apps',
        'cleanup',
      ),
      actual,
    );
    proveAppAbsent(await queryProcesses('cleanup-main-app-processes'), driver.pid);
    summary.standardFixtureRestore = 'PASS';
    summary.restoredArtifact = actual;
  });
}

async function run(options) {
  if (activeRun) fail('QUALIFICATION_TOOLING_FAILURE', 'Only one qualification run may be active.');
  const initial = inventory();
  const runId = crypto.randomUUID();
  const root = options.output
    ? path.resolve(options.output)
    : fs.mkdtempSync('/tmp/notifee-ios-fcm-qualification-');
  const outputOwner = createOwnedRoot(root, { create: true, empty: true });
  const reportDir = path.join(root, 'evidence');
  ensureOwnedDirectory(outputOwner, reportDir);
  const secret = crypto.randomBytes(32).toString('base64url');
  loggingSecrets = [secret];
  const callback = createCallback(runId, secret);
  let workspace, session, relay, currentPID, standardApp, primaryError;
  const resources = {
    runId,
    closing: false,
    interruptionError: null,
    driver: null,
    pilot: null,
    actions: new Map(),
    stopErrors: [],
    reportingErrors: [],
    processes: [],
    outputOwner,
  };
  activeRun = resources;
  const interrupted = signal => {
    if (!resources.interruptionError) {
      resources.interruptionError = new QualificationError(
        'QUALIFICATION_INTERRUPTED',
        'Qualification interrupted; downstream sends stopped.',
      );
      resources.interruption = {
        signal,
        timestamp: now(),
        ...classify(resources.interruptionError),
      };
      callback.context.error = resources.interruptionError;
      callback.context.stopped = true;
      session?.block(resources.interruptionError);
    }
    for (const owner of ownedChildren.values()) {
      if (owner.run !== resources || owner.role !== 'work') continue;
      try {
        owner.control.stop();
      } catch (error) {
        resources.stopErrors.push({ phase: 'stop-owned-child', ...classify(error) });
      }
    }
  };
  const onSIGINT = () => interrupted('SIGINT');
  const onSIGTERM = () => interrupted('SIGTERM');
  process.on('SIGINT', onSIGINT);
  process.on('SIGTERM', onSIGTERM);
  const summary = {
    runId,
    output: reportDir,
    candidate: candidateEvidence(initial),
    mode: options.mode,
    configuration: options.configuration,
    deliveryMode: 'main-terminated-installed-nse-content',
    startedAt: now(),
    runtimeStatus: 'NOT_RUN',
    processes: resources.processes,
    scenarios: options.scenarios.map(scenario => ({ scenario, status: 'NOT_RUN' })),
  };
  const summaryBytes = () =>
    JSON.stringify(
      redact({ ...summary, qualification: session?.evidence() }, [
        secret,
        session
          ? (() => {
              try {
                return session.token();
              } catch {
                return '';
              }
            })()
          : '',
      ]),
      null,
      2,
    ) + '\n';
  const save = () =>
    writeOwnedFile(resources.outputOwner, path.join(reportDir, 'report.json'), summaryBytes());
  const reportSafely = (filename, content) => {
    const bytes = () => (typeof content === 'function' ? content() : content);
    try {
      writeOwnedFile(resources.outputOwner, filename, bytes());
    } catch (error) {
      resources.reportingErrors.push(error);
      summary.runtimeStatus = 'BLOCKED';
      summary.cleanupErrors ??= [];
      summary.cleanupErrors.push({ phase: 'report-output', ...classify(error) });
      summary.fallbackReports ??= [];
      const fallback = '.qualification-report-' + crypto.randomUUID() + '.json';
      summary.fallbackReports.push({ original: path.basename(filename), fallback });
      try {
        writeOwnedFile(resources.outputOwner, path.join(root, fallback), bytes());
      } catch {
        note({ status: 'BLOCKED', phase: 'report-output', blocker: classify(error) });
      }
    }
  };
  const stopApp = async label => {
    if (currentPID) {
      await devicectl(
        ['device', 'process', 'terminate', '--pid', String(currentPID)],
        summary.device.id,
        reportDir,
        label,
      );
      currentPID = null;
    }
  };
  try {
    assertWorking();
    note({ output: root, phase: 'preparation', candidate: initial.fingerprint });
    summary.device = deviceId(options.device);
    const host = callbackHost(options.callbackHost);
    await new Promise(resolve => callback.server.listen(0, '0.0.0.0', resolve));
    const callbackURL = `http://${host}:${callback.server.address().port}`;
    assertWorking();
    resources.runtime = createOwnedRuntime(root, runId);
    workspace = resources.runtime.paths.workspace;
    summary.ownedPaths = resources.runtime.paths;
    await copyWorkspace(root, initial, runId, reportDir);
    assertWorking();
    note({ phase: 'fresh-js-core-cli-builds' });
    await commandLog(
      'bash',
      ['build_ios_core.sh'],
      workspace,
      path.join(reportDir, 'core-generation.log'),
    );
    await commandLog('yarn', ['build:rn'], workspace, path.join(reportDir, 'rn-build.log'));
    await commandLog(
      'yarn',
      ['build:rn:server'],
      workspace,
      path.join(reportDir, 'server-build.log'),
    );
    await commandLog(
      'yarn',
      ['build'],
      path.join(workspace, 'packages/cli'),
      path.join(reportDir, 'cli-build.log'),
    );
    await commandLog(
      process.execPath,
      [
        path.join(workspace, 'packages/cli/dist/cli.js'),
        'init-nse',
        '--ios-path',
        path.join(workspace, 'apps/smoke/ios'),
        '--target-name',
        'NotifyKitNSE',
        '--bundle-suffix',
        '.NotifyKitNSE',
        '--force',
      ],
      workspace,
      path.join(reportDir, 'init-nse.log'),
    );
    await commandLog(
      'pod',
      ['install'],
      path.join(workspace, 'apps/smoke/ios'),
      path.join(reportDir, 'pod-install.log'),
    );
    await bundleDriver(workspace, options.configuration, reportDir, 'pilot');
    assertIdentity(initial);
    const pilotLog = await build(
      workspace,
      reportDir,
      summary.device.id,
      options.configuration,
      'pilot',
    );
    assertWorking();
    const app = path.join(
      workspace,
      `DerivedData/Build/Products/${options.configuration}-iphoneos/NotifeeExample.app`,
    );
    summary.pilotArtifact = await inspectSignedApp(app, {
      requireNse: true,
      execute: artifactExecutor,
    });
    summary.pilotManifestSHA256 = artifactManifest(app);
    const expected = expectedEnvironment({
      'aps-environment': summary.pilotArtifact.apsEnvironment,
    });
    const compiled = await inspectCompiledRNFirebase({
      buildLog: pilotLog.compilerInvocations.join('\n'),
      workspace,
      execute: async (command, args, executeOptions) => {
        assertWorking();
        const result = await executeOwned(command, args, {
          ...executeOptions,
          timeoutMs: 120000,
          timeoutCode: 'ARTIFACT_VERIFICATION_TIMEOUT',
        });
        assertWorking();
        return result.stdout;
      },
    });
    summary.compiledRNFirebase = compiled;
    checkEnvironment({
      expected,
      automatic: compiled.automaticEnvironment,
      mode: options.mode,
      proxyEnabled: options.mode === 'default' ? summary.pilotArtifact.proxyEnabled : false,
      controlled: options.mode === 'signed-entitlement' ? expected : undefined,
    });
    // Preserve a signed, unlaunched standard fixture for closure. The pilot
    // bundle was built before any diagnostic source or plist was generated.
    standardApp = path.join(workspace, 'standard-fixture/NotifeeExample.app');
    copyOwnedTree(resources.runtime.owner, app, standardApp);
    verifyArtifactIdentity(
      summary.pilotArtifact,
      await inspectSignedApp(standardApp, { requireNse: true, execute: artifactExecutor }),
    );
    if (artifactManifest(standardApp) !== summary.pilotManifestSHA256)
      fail(
        'QUALIFICATION_CLEANUP_REFUSED',
        'Standard pilot copy differs from its complete manifest.',
      );
    resources.pilot = Object.freeze({
      app: standardApp,
      artifact: summary.pilotArtifact,
      manifestSHA256: summary.pilotManifestSHA256,
    });
    writeDriver(workspace, {
      runId,
      callbackURL,
      callbackSecret: secret,
      standardAutoInitEnabled: summary.pilotArtifact.autoInitPlist !== false,
    });
    await writeNativeDriver(workspace, {
      runId,
      callbackURL,
      callbackSecret: secret,
      mode: options.mode,
      expected,
    });
    await bundleDriver(workspace, options.configuration, reportDir, 'qualified');
    await build(workspace, reportDir, summary.device.id, options.configuration, 'qualified');
    assertWorking();
    const artifact = await inspectSignedApp(app, { requireNse: true, execute: artifactExecutor });
    if (artifact.apsEnvironment !== summary.pilotArtifact.apsEnvironment)
      fail(
        'SIGNED_ENTITLEMENT_MISMATCH',
        'Final signed artifact changed environment after driver generation.',
      );
    summary.artifact = artifact;
    const integration = {
      ...compiled,
      proxyEnabled: artifact.proxyEnabled,
      controlledEnvironment: options.mode === 'signed-entitlement' ? expected : undefined,
    };
    session = new QualificationSession({
      runId,
      deviceId: summary.device.id,
      artifact,
      integration,
      mode: options.mode,
      requireNse: true,
    });
    callback.context.session = session;
    assertIdentity(initial);
    resources.driver = { app, artifact, receipt: null, pid: null };
    registerDeviceCleanup(resources, summary, callback, initial);
    summary.installationAttempted = true;
    summary.installation = await devicectl(
      ['device', 'install', 'app', app],
      summary.device.id,
      reportDir,
      'install',
    );
    const installedURL = verifyInstallation(
      summary.installation,
      await devicectl(['device', 'info', 'apps'], summary.device.id, reportDir, 'installed-apps'),
      artifact,
    );
    const launch = async label => {
      const data = await devicectl(
        ['device', 'process', 'launch', '--terminate-existing', artifact.bundleId],
        summary.device.id,
        reportDir,
        label,
      );
      currentPID = data.result?.process?.processIdentifier;
      if (!currentPID)
        fail(
          'QUALIFICATION_DRIVER_FAILURE',
          'Installed driver launch did not identify its process.',
        );
    };
    relay = startDeviceLog(summary.device.id, reportDir, () => {
      try {
        return [secret, session.token()];
      } catch {
        return [secret];
      }
    });
    await launch('readiness-launch');
    const readiness = await driverCommand(callback.context, 'readiness');
    summary.readiness = redact(readiness);
    if (!session.evidence().apns)
      fail('APNS_TOKEN_UNAVAILABLE', 'Native APNs association readiness evidence is missing.');
    await driverCommand(callback.context, 'regenerate');
    save();
    const { sendScenario } = require(path.join(workspace, 'scripts/send-test-fcm.js'));
    let windowStart = 0;
    const send = async request => {
      assertIdentity(initial);
      if (callback.context.error) throw callback.context.error;
      windowStart = relay.lines.length;
      const stoppedPID = currentPID;
      await stopApp(request.qualification.phase + '-terminate-' + request.correlationId);
      verifyInstallation(
        summary.installation,
        await devicectl(
          ['device', 'info', 'apps'],
          summary.device.id,
          reportDir,
          request.correlationId + '-before-apps',
        ),
        artifact,
      );
      const processes = await devicectl(
        ['device', 'info', 'processes'],
        summary.device.id,
        reportDir,
        request.correlationId + '-before-processes',
      );
      proveAppAbsent(processes, stoppedPID);
      const result = await sendScenario({
        ...request,
        serviceAccountPath: path.join(REPO, 'firebase-notifykittest.json'),
        qualification: {
          ...request.qualification,
          log: value => note(value),
          authorizeSend: () => {
            assertIdentity(initial);
            if (callback.context.error) throw callback.context.error;
            request.qualification.authorizeSend();
          },
        },
      });
      writeOwnedFile(
        resources.outputOwner,
        path.join(reportDir, request.correlationId + '-sender.json'),
        JSON.stringify(redact(result, [session.token(), secret]), null, 2) + '\n',
      );
      return result;
    };
    const observe = async result => {
      await pause(8000);
      if (relay.error()) fail('NSE_EXECUTION_UNPROVEN', 'Device log relay is unavailable.');
      const processes = await devicectl(
        ['device', 'info', 'processes'],
        summary.device.id,
        reportDir,
        result.correlationId + '-nse-processes',
      );
      const nseExecutable = installedURL + artifact.nse.relativeExecutable;
      const installedNseProcesses =
        processes.result?.runningProcesses?.filter(
          process => process.executable === nseExecutable,
        ) ?? [];
      callback.context.nativeDelivery = null;
      await launch(result.correlationId + '-readback-launch');
      let readback, match, nativeReceipt;
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        readback = await driverCommand(callback.context, 'read');
        match = readback.displayed?.find(
          item =>
            item.id === result.notificationId || item.notification?.id === result.notificationId,
        );
        nativeReceipt = callback.context.nativeDelivery?.notifications.find(
          item => item.messageId === result.messageId?.split('/').pop(),
        );
        if (match && nativeReceipt) break;
        await pause(750);
      }
      const nseLines = relay.lines
        .slice(windowStart)
        .filter(
          line =>
            /NotifyKitNSE/.test(line) &&
            /launch|spawn|pid|request|extension|running-active|didReceive|contentHandler/i.test(
              line,
            ),
        );
      const installedNseLines = nseLines.filter(line =>
        line.includes(nseExecutable.replace(/^file:\/\//, '')),
      );
      if (callback.context.error) throw callback.context.error;
      if (
        nseLines.some(line =>
          /unrecognized selector|uncaught exception|NotifeeCore.*(?:fatal|exception)/i.test(line),
        )
      )
        fail(
          'CANDIDATE_LIBRARY_FAILURE',
          'Real installed NSE evidence reports a candidate runtime exception.',
        );
      writeOwnedFile(
        resources.outputOwner,
        path.join(reportDir, result.correlationId + '-readback.json'),
        JSON.stringify(redact({ ...readback, nativeReceipt }), null, 2) + '\n',
      );
      writeOwnedFile(
        resources.outputOwner,
        path.join(reportDir, result.correlationId + '-nse.log'),
        nseLines.join('\n') + '\n',
      );
      return {
        received: Boolean(match && nativeReceipt),
        remote: match?.remote,
        nseExecuted:
          nseLines.length > 0 && (installedNseProcesses.length > 0 || installedNseLines.length > 0),
        contentProcessed: nativeReceipt?.title === result.expectedTitle,
        installedNseProcesses,
        readbackFile: result.correlationId + '-readback.json',
        nseEvidenceFile: result.correlationId + '-nse.log',
      };
    };
    await runMatrix({
      session,
      send,
      observe,
      scenarios: options.scenarios,
      correlationId: options.correlationId,
    });
    summary.scenarios = session.evidence().scenarios;
    summary.runtimeStatus = 'PASS';
    note({ phase: 'delivery-complete', status: 'QUALIFIED', output: reportDir });
  } catch (error) {
    primaryError = resources.interruptionError ?? error;
    summary.primaryFailure = classify(primaryError);
    callback.context.stopped = true;
    if (session) session.block(primaryError);
    summary.blocker = classify(error);
    if (session) summary.scenarios = session.evidence().scenarios;
    summary.runtimeStatus = 'BLOCKED';
    reportSafely(
      path.join(reportDir, 'failure-redacted.json'),
      JSON.stringify(
        redact({ classification: summary.blocker, stack: error.stack }, [
          secret,
          session
            ? (() => {
                try {
                  return session.token();
                } catch {
                  return '';
                }
              })()
            : '',
        ]),
        null,
        2,
      ) + '\n',
    );
    note({ status: 'BLOCKED', blocker: summary.blocker, output: reportDir });
  } finally {
    resources.closing = true;
    callback.context.stopped = true;
    if (session && !resources.interruptionError) session.close();
    let closureError;
    summary.completedAt = now();
    try {
      await assertCleanupIdentity(initial);
      summary.finalGitIdentity = 'UNCHANGED';
    } catch (error) {
      summary.finalGitIdentity = 'DRIFT';
      summary.cleanupErrors ??= [];
      summary.cleanupErrors.push({
        phase: 'final-identity',
        ...classify(error),
        ...(error.process ? { process: error.process } : {}),
      });
      summary.blocker = classify(error);
      summary.runtimeStatus = 'BLOCKED';
      session?.block(error);
      closureError = error;
    }
    reportSafely(path.join(reportDir, 'report.json'), summaryBytes);
    summary.installation ??= resources.driver?.receipt;
    if (resources.driver?.receipt) {
      summary.standardAutoInitRestore ??= 'UNPROVEN';
      summary.standardFixtureRestore ??= 'UNPROVEN';
      summary.driverCleanup ??= 'UNPROVEN';
      for (const name of ['restore-settings', 'stop-owned-pid', 'reinstall-pilot']) {
        try {
          await resources.actions.get(name)();
        } catch (error) {
          summary.runtimeStatus = 'BLOCKED';
          summary.cleanupErrors ??= [];
          summary.cleanupErrors.push({
            phase: name,
            ...classify(error),
            ...(error.process ? { process: error.process } : {}),
          });
          closureError ??= error;
        }
      }
    } else
      summary.standardFixtureRestore = summary.installationAttempted
        ? 'UNPROVEN_INSTALLATION'
        : 'NOT_INSTALLED';
    const cleanup = await finishCleanup([
      [
        'relay',
        async () => {
          if (relay) await relay.stop();
        },
      ],
      [
        'callback',
        async () => {
          callback.server.closeAllConnections();
          await new Promise(resolve => callback.server.close(resolve));
        },
      ],
      [
        'workspace',
        async () => {
          if (workspace) {
            if (
              [...ownedChildren.values()].some(owner => owner.run === resources && owner.unproven)
            )
              fail(
                'PROCESS_SETTLEMENT_UNPROVEN',
                'Workspace retained because an owned subprocess is not proven settled.',
              );
            cleanupOwnedWorkspace(resources.runtime);
          }
        },
      ],
    ]);
    summary.workspaceCleanup = workspace ? cleanup.statuses.workspace : 'NOT_CREATED';
    if (resources.stopErrors.length) {
      summary.runtimeStatus = 'BLOCKED';
      summary.cleanupErrors ??= [];
      summary.cleanupErrors.push(...resources.stopErrors);
      closureError ??= new QualificationError(
        'QUALIFICATION_CLEANUP_REFUSED',
        'Stopping an owned child was unproven.',
      );
    }
    if (cleanup.errors.length) {
      summary.runtimeStatus = 'BLOCKED';
      summary.cleanupErrors ??= [];
      summary.cleanupErrors.push(
        ...cleanup.failures.map(({ phase, error }) => ({ phase, ...classify(error) })),
      );
      closureError ??= cleanup.errors[0];
    }
    callback.server.closeAllConnections();
    callback.server.close();
    session?.close();
    loggingSecrets = [];
    process.removeListener('SIGINT', onSIGINT);
    process.removeListener('SIGTERM', onSIGTERM);
    // No token or callback secret is written to the retained report.
    reportSafely(
      path.join(reportDir, 'cleanup.json'),
      () =>
        JSON.stringify(
          {
            status:
              summary.cleanupErrors?.length ||
              cleanup.errors.length ||
              resources.reportingErrors.length
                ? 'UNPROVEN'
                : 'PASS',
            workspaceCleanup: summary.workspaceCleanup ?? 'NOT_CREATED',
            driverCleanup: summary.driverCleanup ?? 'PASS',
            callbackStopped: cleanup.statuses.callback === 'PASS' && !callback.server.listening,
            relayStopped: relay ? cleanup.statuses.relay === 'PASS' : 'NOT_STARTED',
            tokenReferencesReleased: true,
            standardFixtureRestore: summary.standardFixtureRestore,
            standardAutoInitRestore: summary.standardAutoInitRestore ?? 'NOT_INSTALLED',
          },
          null,
          2,
        ) + '\n',
    );
    if (resources.interruptionError) {
      summary.interruption = resources.interruption;
      summary.primaryFailure ??= classify(primaryError ?? resources.interruptionError);
      summary.runtimeStatus = 'BLOCKED';
      summary.blocker = classify(primaryError ?? resources.interruptionError);
    }
    summary.completedAt = now();
    reportSafely(path.join(reportDir, 'report.json'), summaryBytes);
    closureError ??= resources.reportingErrors[0];
    activeRun = null;
    if (primaryError || resources.interruptionError || closureError)
      throw primaryError ?? resources.interruptionError ?? closureError;
    if (summary.runtimeStatus === 'PASS')
      note({ phase: 'complete', status: 'PASS', output: reportDir });
  }
}

function verifyArtifactIdentity(expected, actual) {
  for (const key of [
    'bundleId',
    'apsEnvironment',
    'teamId',
    'sha256',
    'jsBundleSHA256',
    'proxyEnabled',
    'autoInitPlist',
  ])
    if (expected[key] !== actual[key])
      fail(
        'CANDIDATE_IDENTITY_MISMATCH',
        'Standard fixture archive differs from its signed artifact proof.',
      );
  if (
    expected.nse?.sha256 !== actual.nse?.sha256 ||
    expected.nse?.bundleId !== actual.nse?.bundleId
  )
    fail('CANDIDATE_IDENTITY_MISMATCH', 'Standard fixture NSE archive identity changed.');
}

function candidateEvidence({ fingerprint, ...identity }) {
  // Public digests use explicit hash fields; arbitrary hexadecimal log text is still masked.
  return { ...identity, fingerprintSHA256: fingerprint };
}

async function finishCleanup(actions) {
  const statuses = {},
    errors = [],
    failures = [];
  for (const [name, action] of actions) {
    try {
      await action();
      statuses[name] = 'PASS';
    } catch (error) {
      statuses[name] = 'UNPROVEN';
      errors.push(error);
      failures.push({ phase: name, error });
    }
  }
  return { statuses, errors, failures };
}

if (require.main === module) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    note({ status: 'BLOCKED', blocker: classify(error) });
    process.exit(4);
  }
  if (options.help) {
    console.log(
      'Usage: node scripts/ios-fcm-qualification.js [--configuration Debug|Release] [--apns-association default|signed-entitlement] [--device UDID] [--scenario minimal|ios-attachment|kitchen-sink|emoji|marketing] [--callback-host IPv4] [--output /tmp/empty-directory]\nDefault: Release, standard RNFirebase association; one mandatory real T0 before requested scenarios. The ordinary fcm-token fixture is unchanged.',
    );
  } else {
    run(options).catch(() => {
      process.exitCode = 4;
    });
  }
}

module.exports = {
  parseArgs,
  inventory,
  assertIdentity,
  deviceId,
  callbackHost,
  createCallback,
  driverCommand,
  proveAppAbsent,
  verifyInstallation,
  commandLog,
  wireDriverResource,
  smokeSigningTeam,
  verifyArtifactIdentity,
  finishCleanup,
  candidateEvidence,
  run,
};
