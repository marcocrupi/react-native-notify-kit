const fs = require('node:fs');
const { Buffer } = require('node:buffer');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createRequire } = require('node:module');

const controllerPath = path.resolve(__dirname, '../../ios-fcm-qualification.js');
const nativeRequire = createRequire(controllerPath);
const real = nativeRequire(controllerPath);
const lib = nativeRequire('./lib/ios-fcm-qualification');

async function lifecycle(options = {}) {
  const root = fs.mkdtempSync('/tmp/ios-fcm-lifecycle-');
  if (options.supervisorRoot)
    fs.writeFileSync(path.join(options.supervisorRoot, 'workspace-root'), root);
  const identity = real.inventory();
  const state = {
    installed: 'NONE',
    running: false,
    autoInit: options.autoInit !== false,
    calls: [],
    kills: [],
    sends: [],
    tokens: 0,
    signalCount: 0,
    settings: 0,
    afterSignalSends: 0,
    afterSignalTokens: 0,
    forbiddenSyncCalls: 0,
    forbiddenSenderCalls: 0,
    synchronousWorkCalls: 0,
    inspectorProcesses: [],
  };
  const children = new Map();
  let nextPID = 10000;
  let session, config, callbackContext;
  const proc = Object.assign(new EventEmitter(), {
    env: { ...process.env },
    execPath: process.execPath,
    kill(pid, signal) {
      if (signal === 0) {
        const child = children.get(-pid);
        if (child?.finish) {
          if (child.done) {
            const error = new Error('absent');
            error.code = 'ESRCH';
            throw error;
          }
          return;
        }
        return process.kill(pid, signal);
      }
      state.kills.push({ pid, signal });
      const child = children.get(-pid);
      if (child?.finish) {
        if (!(options.ignoreTerm && signal === 'SIGTERM')) child.finish(null, signal);
      } else if (child) process.kill(pid, signal);
    },
  });
  const trigger = phase => {
    if (phase !== options.phase || state.signalCount) return;
    state.signalCount++;
    proc.emit(options.signal || 'SIGINT');
    if (options.doubleSignal) {
      state.signalCount++;
      proc.emit(options.signal === 'SIGTERM' ? 'SIGINT' : 'SIGTERM');
    }
    if (options.onSignal) {
      try {
        options.onSignal(session);
      } catch (error) {
        state.signalProbeError = error.message;
      }
    }
  };
  const artifact = app => ({
    path: app,
    bundleId: 'fixture',
    apsEnvironment: 'development',
    teamId: 'TEAM',
    sha256: lib.digest(fs.readFileSync(path.join(app, 'Fixture'))),
    jsBundleSHA256: lib.digest(fs.readFileSync(path.join(app, 'main.jsbundle'))),
    proxyEnabled: true,
    autoInitPlist: options.autoInit === false ? false : 'ABSENT',
    nse: {
      bundleId: 'fixture.nse',
      relativeExecutable: 'PlugIns/NotifyKitNSE.appex/NotifyKitNSE',
      sha256: lib.digest('nse'),
    },
  });
  const fakeSpawn = (command, args, spawnOptions = {}) => {
    if (command === 'git' && options.realIdentity && !options.actualInspection) {
      const child = require('node:child_process').spawn(command, args, spawnOptions);
      children.set(child.pid, child);
      return child;
    }
    if (command === 'plutil' && options.actualNative && !options.actualInspection) {
      const child = require('node:child_process').spawn(command, args, spawnOptions);
      children.set(child.pid, child);
      return child;
    }
    if (['codesign', 'plutil', 'git'].includes(command) && options.actualInspection) {
      const child = require('node:child_process').spawn(command, args, {
        ...spawnOptions,
        env: { ...spawnOptions.env, PATH: options.inspectorPath + ':' + process.env.PATH },
      });
      children.set(child.pid, child);
      state.inspectorProcesses.push({ command, pid: child.pid });
      return child;
    }
    if (options.realMetro && command === process.execPath && args.includes('bundle')) {
      const child = require('node:child_process').spawn(command, args, spawnOptions);
      children.set(child.pid, child);
      child.stdout.on('data', chunk => {
        if (config && chunk.toString().includes('Writing bundle output')) {
          if (options.recordCache) {
            state.cacheBefore = scanMarkers(root, config);
            state.cacheFiles = cacheFiles(root);
            state.sharedCacheBefore = scanMarkers(process.env.TMPDIR, config);
          }
          trigger('qualified-metro');
        }
      });
      return child;
    }
    const child = new EventEmitter();
    child.pid = ++nextPID;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.signalCode = null;
    child.finish = (code, signal = null) => {
      if (child.done) return;
      if (
        options.hostileDelegated &&
        ((options.hostileDelegated.phase === 'init-nse' && args.includes('init-nse')) ||
          (options.hostileDelegated.phase === 'pod' && command === 'pod'))
      )
        fs.writeFileSync(
          path.join(root, 'workspace', options.hostileDelegated.file),
          'synthetic delegated config',
        );
      child.done = true;
      child.exitCode = code;
      child.signalCode = signal;
      child.stdout.end();
      child.stderr.end();
      child.emit('exit', code, signal);
      child.emit('close', code, signal);
    };
    children.set(child.pid, child);
    const label =
      args.find(
        value =>
          typeof value === 'string' &&
          /(?:cleanup|install|readiness-launch).*\.(?:json|log)$/.test(value),
      ) || '';
    state.calls.push({
      command,
      args,
      env: spawnOptions.env,
      afterSignal: state.signalCount > 0,
      label,
    });
    if (command === 'idevicesyslog') return child;
    queueMicrotask(() => {
      if (child.done) return;
      if (command === 'bash' && options.hostileCoreParent)
        fs.writeFileSync(
          path.join(root, 'workspace/packages/react-native/ios/NotifeeCore/target'),
          'synthetic-generated-config',
        );
      if (command === 'yarn' && args.includes('build:rn') && options.hostileVersion)
        fs.writeFileSync(
          path.join(root, 'workspace/packages/react-native/src/version.ts'),
          'synthetic-generated-config',
        );
      if (command === 'bash' && options.phase === 'work-hang') {
        trigger('work-hang');
        return;
      }
      if (command === 'xcrun') {
        const output = args[args.indexOf('--json-output') + 1];
        let result = {};
        if (
          options.corruptPilotPhase === 'after-verify' &&
          label.includes('cleanup-before-restore-apps')
        )
          fs.writeFileSync(
            path.join(root, 'workspace/standard-fixture/NotifeeExample.app/extra-resource'),
            'changed between awaits',
          );
        if (options.cleanupFailure && label.includes(options.cleanupFailure)) {
          child.finish(3);
          return;
        }
        if (args.includes('install')) {
          state.installed = args.at(-1).includes('standard-fixture') ? 'STANDARD' : 'DRIVER';
          result = {
            installedApplications: [
              { bundleID: 'fixture', installationURL: 'file:///fixture.app/' },
            ],
          };
        } else if (args.includes('apps'))
          result = {
            apps: [
              {
                bundleIdentifier: 'fixture',
                url: options.foreignInstallation ? 'file:///foreign.app/' : 'file:///fixture.app/',
              },
            ],
          };
        else if (args.includes('launch')) {
          state.running = true;
          state.autoInit = false;
          result = { process: { processIdentifier: 4242 } };
        } else if (args.includes('terminate')) state.running = false;
        else if (args.includes('processes'))
          result = {
            runningProcesses: state.running
              ? [
                  {
                    processIdentifier: options.foreignPID ? 9999 : 4242,
                    executable: 'file:///fixture.app/NotifeeExample',
                  },
                ]
              : [],
          };
        fs.writeFileSync(output, JSON.stringify({ info: { outcome: 'success' }, result }));
        if (args.includes('install') && state.installed === 'DRIVER') trigger('install-settlement');
        if (args.includes('launch') && !label.includes('cleanup')) trigger('launch-settlement');
        if (label.includes('cleanup')) trigger('cleanup');
      }
      child.finish(0);
    });
    return child;
  };
  function req(name) {
    if (name === './lib/ios-fcm-process') {
      const backend = nativeRequire(name);
      return {
        ...backend,
        runBounded: (command, args, input) => {
          if (options.unprovenInspection && context.controllerClosing() && command === 'codesign') {
            const child = new EventEmitter();
            Object.assign(child, {
              pid: ++nextPID,
              stdin: new PassThrough(),
              stdout: new PassThrough(),
              stderr: new PassThrough(),
            });
            return backend.runBounded(command, args, {
              ...input,
              spawnImpl: () => child,
              killImpl: () => {},
              timeoutMs: 10,
              graceMs: 10,
              settleMs: 20,
            });
          }
          return backend.runBounded(command, args, {
            ...input,
            spawnImpl: fakeSpawn,
            killImpl: proc.kill,
            ...(options.actualInspection
              ? { timeoutMs: input.timeoutMs === 0 ? 0 : 1500, graceMs: 150, settleMs: 500 }
              : {}),
          });
        },
      };
    }
    if (name === 'node:crypto')
      return { ...require('node:crypto'), randomBytes: size => Buffer.alloc(size, 11) };
    if (name === 'node:child_process')
      return {
        spawn: fakeSpawn,
        execFileSync: (command, args, input) => {
          if (context.controllerClosing?.()) state.forbiddenSyncCalls++;
          else state.synchronousWorkCalls++;
          if (command === 'git' && options.realIdentity)
            return require('node:child_process').execFileSync(command, args, input);
          if (options.actualInspection && ['codesign', 'plutil'].includes(command))
            return require('node:child_process').execFileSync(command, args, {
              ...input,
              env: { ...input.env, PATH: options.inspectorPath + ':' + process.env.PATH },
            });
          throw new Error('Unexpected synchronous native command');
        },
        spawnSync: () => {
          state.forbiddenSyncCalls++;
          throw new Error('Forbidden spawnSync');
        },
        execSync: () => {
          state.forbiddenSyncCalls++;
          throw new Error('Forbidden execSync');
        },
      };
    if (name === './lib/ios-fcm-artifact')
      return {
        ...nativeRequire(name),
        inspectSignedApp: (app, input) => {
          if (app.includes('standard-fixture') && context.controllerClosing()) {
            state.cleanupInspections = (state.cleanupInspections || 0) + 1;
            if (options.corruptPilotAfterInspection && state.cleanupInspections === 2)
              fs.writeFileSync(path.join(app, 'changed-after-inspection'), 'synthetic mutation');
          }
          if (
            (options.actualInspection || options.unprovenInspection) &&
            app.includes('standard-fixture') &&
            context.controllerClosing()
          )
            return nativeRequire(name).inspectSignedApp(app, input);
          return artifact(app);
        },
        inspectCompiledRNFirebase: () => ({ automaticEnvironment: 'sandbox' }),
      };
    if (name === './lib/ios-fcm-qualification')
      return {
        ...lib,
        runMatrix: async input =>
          lib.runMatrix({
            ...input,
            observe: async () => {
              trigger('observation');
              return { received: true, nseExecuted: true, contentProcessed: true };
            },
          }),
      };
    if (name.endsWith('/scripts/send-test-fcm.js'))
      return {
        sendScenario: async request => {
          if (context.controllerClosing()) state.forbiddenSenderCalls++;
          trigger(request.qualification.phase === 'T0' ? 't0-send' : 'functional-send');
          if (options.realSender)
            return nativeRequire(
              path.join(path.dirname(controllerPath), 'send-test-fcm.js'),
            ).sendScenario(request, {
              serviceAccount: {},
              admin: {
                getApps: () => [{}],
                getMessaging: () => ({
                  send: async () => {
                    state.sends.push(request.qualification.phase);
                    if (state.signalCount) state.afterSignalSends++;
                    return 'projects/fixture/messages/witness';
                  },
                }),
              },
            });
          request.qualification.authorizeSend();
          state.sends.push(request.qualification.phase);
          if (state.signalCount) state.afterSignalSends++;
          return {
            messageId: 'projects/fixture/messages/witness',
            notificationId: 'witness',
            correlationId: request.correlationId,
          };
        },
      };
    return nativeRequire(name);
  }
  req.main = {};
  const post = async (route, body) => {
    const response = await fetch(callbackContext.url + route, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + config.callbackSecret },
      body: JSON.stringify({ ...body, runId: config.runId }),
    });
    if (!response.ok)
      throw new lib.QualificationError(
        (await response.json()).error,
        'Host driver callback rejected',
      );
    return response.json();
  };
  const pump = async (context, action) => {
    session = context.session;
    if (action === 'regenerate' && options.recordCache) {
      state.cacheBefore = scanMarkers(root, config);
      state.cacheFiles = cacheFiles(root);
      state.sharedCacheBefore = scanMarkers(process.env.TMPDIR, config);
    }
    const command = context.pending.command;
    const selected = await post('/next', {});
    if (!selected || selected.id !== command.id) return;
    if (action === 'restore-settings') {
      if (options.settingsFailure) {
        await post('/result', {
          commandId: command.id,
          status: 'ERROR',
          errorCode: 'QUALIFICATION_DRIVER_FAILURE',
        });
        return;
      }
      state.settings++;
      state.autoInit = options.autoInit !== false;
      await post('/result', {
        commandId: command.id,
        status: 'OK',
        result: { autoInitEnabled: state.autoInit },
      });
      return;
    }
    if (action === 'readiness') {
      trigger('readiness');
      await post('/native', {
        apnsPresent: true,
        apnsSHA256: 'd'.repeat(64),
        apnsBytes: 32,
        environment: 'sandbox',
        evidenceKind: 'compiled-callback',
        timestamp: new Date().toISOString(),
      });
    } else if (action === 'regenerate') {
      if (options.corruptPilot)
        fs.writeFileSync(
          path.join(root, 'workspace/standard-fixture/NotifeeExample.app/extra-resource'),
          'changed',
        );
      if (options.ordinaryError || options.corruptPilot) {
        await post('/result', {
          commandId: command.id,
          status: 'ERROR',
          errorCode: 'QUALIFICATION_DRIVER_FAILURE',
        });
        return;
      }
      trigger('delete');
      await post('/event', { commandId: command.id, kind: 'delete-started' });
      await post('/event', { commandId: command.id, kind: 'delete-completed' });
      trigger('generation');
      await post('/event', { commandId: command.id, kind: 'generation-started' });
      state.tokens++;
      if (state.signalCount) state.afterSignalTokens++;
      await post('/token', { commandId: command.id, token: 'synthetic-fcm-token' });
    }
    await post('/result', { commandId: command.id, status: 'OK', result: { apnsPresent: true } });
  };
  const context = {
    require: req,
    module: { exports: {} },
    __dirname: path.dirname(controllerPath),
    process: proc,
    console: { log() {} },
    setTimeout: options.fastTimeout ? (fn, ms) => setTimeout(fn, ms >= 3000 ? 50 : ms) : setTimeout,
    clearTimeout,
    Buffer,
    queueMicrotask,
    identity,
    forbiddenSync: () => {
      state.forbiddenSyncCalls++;
    },
    trigger,
    pump,
    prepareFixture,
    prepareOutputs: workspace => {
      if (options.hostileDelegated) {
        const file = path.join(workspace, options.hostileDelegated.file);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.rmSync(file, { force: true });
        fs.symlinkSync(path.join(options.foreign, 'target'), file);
      }
      if (options.hostileCoreParent) {
        const directory = path.join(workspace, 'packages/react-native/ios');
        fs.mkdirSync(path.dirname(directory), { recursive: true });
        fs.symlinkSync(options.foreign, directory);
        fs.mkdirSync(path.join(workspace, 'ios/NotifeeCore'), { recursive: true });
      }
      if (options.hostileVersion) {
        const file = path.join(workspace, 'packages/react-native/src/version.ts');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.symlinkSync(path.join(options.foreign, 'target'), file);
      }
    },
    captureConfig: value => {
      config = value;
      if (options.hostileOutput) {
        const file = path.join(root, 'workspace', options.hostileOutput);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.rmSync(file, { force: true });
        fs.symlinkSync(path.join(options.foreign, 'target'), file);
      }
      if (options.hostileEvidence) {
        const file = path.join(root, 'evidence', options.hostileEvidence);
        fs.rmSync(file, { force: true });
        fs.symlinkSync(path.join(options.foreign, 'target'), file);
      }
    },
    captureCallback: value => {
      callbackContext = value;
    },
    beforeWorkspaceCleanup: runtime => options.beforeWorkspaceCleanup(runtime),
  };
  vm.createContext(context);
  let controllerSource = fs
    .readFileSync(controllerPath, 'utf8')
    .replace(
      '    const cleanup = await finishCleanup([',
      options.repeatCleanup
        ? "    for (const name of ['restore-settings','stop-owned-pid','reinstall-pilot']) await resources.actions.get(name)();\n    const cleanup = await finishCleanup(["
        : '    const cleanup = await finishCleanup([',
    );
  if (options.mutateCleanupIdentity)
    controllerSource = controllerSource.replaceAll(
      'await assertCleanupIdentity(initial)',
      'assertIdentity(initial)',
    );
  if (options.beforeWorkspaceCleanup)
    controllerSource = controllerSource.replace(
      '    const cleanup = await finishCleanup([',
      '    beforeWorkspaceCleanup(resources.runtime);\n    const cleanup = await finishCleanup([',
    );
  if (options.mutateCleanupPrimitive)
    controllerSource = controllerSource.replace(
      '    const cleanup = await finishCleanup([',
      `    try { require('node:child_process')[${JSON.stringify(options.mutateCleanupPrimitive)}]('git', ['status', '--porcelain=v1'], {cwd: REPO, timeout: 1000}); } catch {}
    const cleanup = await finishCleanup([`,
    );
  if (options.mutateCleanupSender)
    controllerSource = controllerSource.replace(
      '    const cleanup = await finishCleanup([',
      `    try { await require(path.join(workspace,'scripts/send-test-fcm.js')).sendScenario({token:'synthetic',scenario:'minimal',correlationId:'mutant',qualification:{phase:'T0',t0Probe:true,authorizeSend:()=>assertIdentity(initial)}}); } catch {}
    const cleanup = await finishCleanup([`,
    );
  vm.runInContext(
    controllerSource +
      `
    ${options.realIdentity ? '' : 'inventory = () => identity;'}
    if (typeof inventoryAsync === 'function' && !${!!options.realIdentity}) inventoryAsync = async () => identity;
    const identityOriginal = assertIdentity;
    assertIdentity = (...args) => { if(activeRun?.closing) forbiddenSync(); return identityOriginal(...args); };
    deviceId = () => ({id:'HOST-NATIVE-ADAPTER'});
    callbackHost = () => '127.0.0.1';
    const callbackOriginal = createCallback;
    createCallback = (...args) => {
      const value = callbackOriginal(...args);
      value.server.on('listening', () => captureCallback({url:'http://127.0.0.1:'+value.server.address().port}));
      return value;
    };
    copyWorkspace = async (root, initial, runId) => {
      const workspace = path.join(root,'workspace');
      fs.mkdirSync(workspace,{recursive:true});fs.writeFileSync(path.join(workspace,'.qualification-owner'),runId);
      fs.mkdirSync(path.join(workspace,'apps/smoke/ios/NotifeeExample'),{recursive:true});
      prepareFixture(workspace);prepareOutputs(workspace);trigger('preparation');return workspace;
    };
    ${options.realMetro ? '' : "bundleDriver = async (workspace, configuration, output, phase) => { trigger(phase+'-bundle'); };"}
    const originalWriteDriver = writeDriver;
    writeDriver = (workspace, config) => {captureConfig(config);originalWriteDriver(workspace,config);};
    ${options.actualNative ? '' : "writeNativeDriver = (workspace, config) => { fs.writeFileSync(path.join(workspace,'apps/smoke/ios/NotifeeExample/AppDelegate.swift'),JSON.stringify(config)); };"}
    build = async (workspace, output, device, configuration, phase) => {
      const app=path.join(workspace,'DerivedData/Build/Products/'+configuration+'-iphoneos/NotifeeExample.app');
      fs.mkdirSync(path.join(app,'PlugIns/NotifyKitNSE.appex'),{recursive:true});
      fs.writeFileSync(path.join(app,'Fixture'),'synthetic signed executable');
      fs.writeFileSync(path.join(app,'main.jsbundle'),phase);
      fs.writeFileSync(path.join(app,'PlugIns/NotifyKitNSE.appex/NotifyKitNSE'),'nse');
      trigger(phase+'-build');return {compilerInvocations:[]};
    };
    const originalDriverCommand = driverCommand;
    driverCommand = (context, action, timeout) => {
      const pending = originalDriverCommand(context, action, timeout || 2000);
      if(context.pending) pump(context,action).catch(() => {});
      return pending;
    };
    globalThis.controllerClosing = () => activeRun?.closing;
    globalThis.witnessRun = run;
  `,
    context,
    { filename: controllerPath },
  );
  let rejected;
  try {
    await context.witnessRun({
      configuration: 'Debug',
      mode: 'default',
      device: 'host',
      callbackHost: '127.0.0.1',
      scenarios: ['minimal'],
      output: root,
    });
  } catch (error) {
    rejected = error.code || error.message;
  }
  const readReport = name => {
    const file = path.join(root, 'evidence', name);
    if (fs.existsSync(file) && !fs.lstatSync(file).isSymbolicLink())
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    const matching = fs
      .readdirSync(root)
      .filter(value => value.startsWith('.qualification-report-'))
      .map(value => JSON.parse(fs.readFileSync(path.join(root, value), 'utf8')))
      .filter(value => (name === 'report.json' ? !!value.runtimeStatus : !!value.workspaceCleanup));
    return matching
      .sort((a, b) => (a.fallbackReports?.length ?? 0) - (b.fallbackReports?.length ?? 0))
      .at(-1);
  };
  const report = readReport('report.json');
  const cleanup = readReport('cleanup.json');
  const result = {
    rejected,
    report,
    cleanup,
    state,
    session,
    syntheticSecret: config?.callbackSecret,
    workspaceExists: fs.existsSync(path.join(root, 'workspace')),
  };
  if (options.retain) result.root = root;
  else fs.rmSync(root, { recursive: true });
  return result;
}

function scanMarkers(root, config, secretOnly = false) {
  const matches = [];
  if (!root || !fs.existsSync(root)) return matches;
  function walk(directory) {
    for (const name of fs.readdirSync(directory)) {
      const filename = path.join(directory, name);
      const stat = fs.lstatSync(filename);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(filename);
      else if (stat.isFile()) {
        const bytes = fs.readFileSync(filename);
        if (
          (!secretOnly && bytes.includes(Buffer.from(config.runId))) ||
          bytes.includes(Buffer.from(config.callbackSecret))
        )
          matches.push(filename);
      }
    }
  }
  walk(root);
  return matches;
}

function cacheFiles(root) {
  const runtime = path.join(root, 'workspace/.qualification-runtime');
  const output = {};
  for (const name of ['metro-transform', 'metro-file-map']) {
    const directory = path.join(runtime, name);
    output[name] = fs.existsSync(directory)
      ? fs.readdirSync(directory, { recursive: true }).length
      : 0;
  }
  return output;
}

function prepareFixture(workspace) {
  const app = path.join(workspace, 'apps/smoke');
  const repo = path.resolve(__dirname, '../../..');
  const smokeRequire = createRequire(path.join(repo, 'apps/smoke/package.json'));
  fs.writeFileSync(
    path.join(app, 'package.json'),
    JSON.stringify({
      name: 'host-cache-witness',
      version: '1.0.0',
      private: true,
      dependencies: { 'react-native': '0.85.3' },
    }),
  );
  fs.symlinkSync(path.join(repo, 'apps/smoke/node_modules'), path.join(app, 'node_modules'));
  fs.writeFileSync(path.join(app, 'App.tsx'), 'export default function App() { return null; }');
  fs.writeFileSync(
    path.join(app, 'index.js'),
    "import App from './App'; globalThis.witness = App;\n",
  );
  fs.writeFileSync(path.join(app, 'app.json'), JSON.stringify({ name: 'HostCacheWitness' }));
  fs.writeFileSync(path.join(app, 'stub.js'), 'module.exports = {};');
  fs.writeFileSync(
    path.join(app, 'babel.config.js'),
    'module.exports = {presets:[' +
      JSON.stringify(smokeRequire.resolve('@react-native/babel-preset')) +
      ']};',
  );
  fs.writeFileSync(
    path.join(app, 'metro.config.js'),
    `
const {getDefaultConfig,mergeConfig}=require(${JSON.stringify(smokeRequire.resolve('@react-native/metro-config'))});
module.exports=mergeConfig(getDefaultConfig(__dirname), {
maxWorkers:2, watchFolders:[${JSON.stringify(repo)}],
resolver:{useWatchman:false,nodeModulesPaths:[${JSON.stringify(path.join(repo, 'apps/smoke/node_modules'))}],
resolveRequest:(context,name,platform)=> ['react','react-native','react-native-notify-kit','@react-native-firebase/app','@react-native-firebase/messaging','@react-native-firebase/messaging/lib/modular'].includes(name)
? {type:'sourceFile',filePath:require('path').join(__dirname,'stub.js')} : context.resolveRequest(context,name,platform)}
});`,
  );
  fs.mkdirSync(path.join(workspace, 'packages/cli'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'packages/cli/package.json'), '{}');
  fs.symlinkSync(
    path.join(repo, 'packages/cli/node_modules'),
    path.join(workspace, 'packages/cli/node_modules'),
  );
  fs.mkdirSync(path.join(app, 'ios/NotifeeExample.xcodeproj'), { recursive: true });
  fs.copyFileSync(
    path.join(repo, 'apps/smoke/ios/NotifeeExample.xcodeproj/project.pbxproj'),
    path.join(app, 'ios/NotifeeExample.xcodeproj/project.pbxproj'),
  );
  fs.copyFileSync(
    path.join(repo, 'apps/smoke/ios/NotifeeExample/Info.plist'),
    path.join(app, 'ios/NotifeeExample/Info.plist'),
  );
}

module.exports = { lifecycle, scanMarkers };
