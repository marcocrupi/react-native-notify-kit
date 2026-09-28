const fs = require('node:fs');
const path = require('node:path');
const { runBounded } = require('./ios-fcm-process');
const { createOwnedRoot, assertOwnedPath, removeOwnedRoot } = require('./ios-fcm-filesystem');
const {
  fail,
  digest,
  expectedEnvironment,
  automaticEnvironment,
} = require('./ios-fcm-qualification');

const executeBounded = async (command, args, options) =>
  (
    await runBounded(command, args, {
      ...options,
      timeoutCode: 'ARTIFACT_VERIFICATION_TIMEOUT',
    })
  ).stdout;

async function plist(filename, execute = executeBounded) {
  return JSON.parse(
    await execute('plutil', ['-convert', 'json', '-o', '-', filename], { encoding: 'utf8' }),
  );
}

async function inspectSignedApp(app, { execute = executeBounded, requireNse = false } = {}) {
  let info, entitlements;
  try {
    await execute('codesign', ['--verify', '--strict', app], { stdio: 'pipe' });
    info = await plist(path.join(app, 'Info.plist'), execute);
    const xml = await execute('codesign', ['--display', '--entitlements', '-', '--xml', app], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    entitlements = JSON.parse(
      await execute('plutil', ['-convert', 'json', '-o', '-', '-'], {
        input: xml,
        encoding: 'utf8',
      }),
    );
  } catch (error) {
    if (
      [
        'ARTIFACT_VERIFICATION_TIMEOUT',
        'PROCESS_SETTLEMENT_UNPROVEN',
        'PATH_CONFINEMENT_VIOLATION',
      ].includes(error.code)
    )
      throw error;
    fail(
      'SIGNED_ENTITLEMENT_UNREADABLE',
      'Cannot verify/read signed app entitlements. Source entitlements and build configuration are not substitutes.',
    );
  }
  expectedEnvironment(entitlements);
  const binary = path.join(app, info.CFBundleExecutable);
  const plugins = path.join(app, 'PlugIns');
  const extensions = [];
  if (fs.existsSync(plugins))
    for (const extensionName of fs.readdirSync(plugins).filter(name => name.endsWith('.appex'))) {
      const filename = path.join(plugins, extensionName);
      if (
        (await plist(path.join(filename, 'Info.plist'), execute)).NSExtension
          ?.NSExtensionPointIdentifier === 'com.apple.usernotifications.service'
      )
        extensions.push(filename);
    }
  if (extensions.length > 1 || (requireNse && extensions.length !== 1))
    fail(
      'NSE_INSTALLATION_UNVERIFIED',
      'Exactly one signed embedded notification service extension is required for NSE qualification.',
    );
  let nse = null;
  if (extensions.length) {
    await execute('codesign', ['--verify', '--strict', extensions[0]], { stdio: 'pipe' });
    const extensionInfo = await plist(path.join(extensions[0], 'Info.plist'), execute);
    nse = {
      bundleId: extensionInfo.CFBundleIdentifier,
      relativeExecutable: path.relative(
        app,
        path.join(extensions[0], extensionInfo.CFBundleExecutable),
      ),
      sha256: digest(fs.readFileSync(path.join(extensions[0], extensionInfo.CFBundleExecutable))),
    };
  }
  const firebaseProxy = info.FirebaseAppDelegateProxyEnabled;
  const googleProxy = info.GoogleUtilitiesAppDelegateProxyEnabled;
  return {
    path: app,
    bundleId: info.CFBundleIdentifier,
    version: info.CFBundleShortVersionString,
    build: info.CFBundleVersion,
    sha256: digest(fs.readFileSync(binary)),
    jsBundleSHA256: fs.existsSync(path.join(app, 'main.jsbundle'))
      ? digest(fs.readFileSync(path.join(app, 'main.jsbundle')))
      : null,
    apsEnvironment: entitlements['aps-environment'],
    teamId: entitlements['com.apple.developer.team-identifier'],
    proxyEnabled: firebaseProxy !== false && googleProxy !== false,
    autoInitPlist: info.FirebaseMessagingAutoInitEnabled ?? 'ABSENT',
    nse,
  };
}

function shellWords(text) {
  const output = [];
  let word = '',
    quoted = null,
    started = false;
  for (let index = 0; index < text.length; index++) {
    const c = text[index];
    if (c === '\\' && quoted !== "'") {
      if (index + 1 >= text.length)
        fail('RNFIREBASE_INTEGRATION_UNVERIFIED', 'Malformed compiler arguments.');
      word += text[++index];
      started = true;
    } else if (c === quoted) quoted = null;
    else if (!quoted && (c === '"' || c === "'")) {
      quoted = c;
      started = true;
    } else if (!quoted && /\s/.test(c)) {
      if (started) output.push(word);
      word = '';
      started = false;
    } else {
      word += c;
      started = true;
    }
  }
  if (quoted) fail('RNFIREBASE_INTEGRATION_UNVERIFIED', 'Unterminated compiler argument.');
  if (started) output.push(word);
  return output;
}

function expandResponseFiles(
  args,
  read = filename => fs.readFileSync(filename, 'utf8'),
  depth = 0,
) {
  if (depth > 5) fail('RNFIREBASE_INTEGRATION_UNVERIFIED', 'Recursive compiler response files.');
  return args.flatMap(arg =>
    arg.startsWith('@')
      ? expandResponseFiles(shellWords(read(arg.slice(1))), read, depth + 1)
      : [arg],
  );
}

async function inspectCompiledRNFirebase({
  buildLog,
  workspace,
  execute = async (command, args, options) =>
    (
      await runBounded(command, args, {
        ...options,
        timeoutMs: 120000,
        timeoutCode: 'ARTIFACT_VERIFICATION_TIMEOUT',
      })
    ).stdout,
}) {
  const lines = buildLog
    .split('\n')
    .filter(
      line =>
        /^\s*\/.*\/clang\s/.test(line) &&
        line.includes('RNFBMessaging+AppDelegate.m') &&
        /\s-c\s/.test(line),
    );
  if (!lines.length)
    fail(
      'RNFIREBASE_INTEGRATION_UNVERIFIED',
      'Fresh RNFirebase compile invocation is missing. Rebuild the tested artifact; configuration labels do not establish token type.',
    );
  const [compiler, ...originalArgs] = shellWords(lines[lines.length - 1]);
  const args = expandResponseFiles(originalArgs);
  const source = args.find(arg => arg.endsWith('/RNFBMessaging+AppDelegate.m'));
  if (!source || !fs.realpathSync(source).startsWith(fs.realpathSync(workspace) + path.sep))
    fail(
      'CANDIDATE_IDENTITY_MISMATCH',
      'RNFirebase compile source escapes the isolated workspace.',
    );
  const outputArgs = [];
  const pairFlags = new Set([
    '-o',
    '-MF',
    '-MT',
    '-MQ',
    '-serialize-diagnostics',
    '-index-store-path',
  ]);
  for (let index = 0; index < args.length; index++) {
    if (pairFlags.has(args[index])) {
      index++;
      continue;
    }
    if (['-c', '-MMD', '-MD', '-MP'].includes(args[index])) continue;
    outputArgs.push(args[index]);
  }
  let preprocessed;
  try {
    preprocessed = await execute(compiler, [...outputArgs, '-E', '-P'], {
      encoding: 'utf8',
      cwd: workspace,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (['ARTIFACT_VERIFICATION_TIMEOUT', 'PROCESS_SETTLEMENT_UNPROVEN'].includes(error.code))
      throw error;
    fail(
      'RNFIREBASE_INTEGRATION_UNVERIFIED',
      'Cannot preprocess the actual RNFirebase compilation command.',
    );
  }
  return {
    automaticEnvironment: automaticEnvironment(preprocessed),
    sourceSHA256: digest(fs.readFileSync(source)),
    compileArgumentsSHA256: digest(JSON.stringify(args)),
    preprocessedSHA256: digest(preprocessed),
    debugMacroEvidence: args.filter(arg => /^-[DU]DEBUG(?:=|$)/.test(arg)),
    evidenceKind: 'actual-compiler-preprocessing',
  };
}

const removedWorkspaces = new Map();
function cleanupWorkspace(workspace, runId) {
  const key = path.resolve(workspace);
  const previous = removedWorkspaces.get(key);
  if (previous) {
    if (previous.runId !== runId)
      fail('QUALIFICATION_CLEANUP_REFUSED', 'Workspace removal belongs to another run.');
    removeOwnedRoot(previous.owner);
    return;
  }
  const owner = createOwnedRoot(workspace, { requirePrivate: false });
  assertOwnedPath(owner, path.join(workspace, '.qualification-owner'));
  const real = fs.realpathSync(workspace);
  const tmp = fs.realpathSync('/tmp');
  if (
    !real.startsWith(tmp + path.sep) ||
    path.basename(real) !== 'workspace' ||
    fs.readFileSync(path.join(real, '.qualification-owner'), 'utf8') !== runId
  )
    fail(
      'QUALIFICATION_CLEANUP_REFUSED',
      'Refusing cleanup of an unowned/non-temporary workspace.',
    );
  removeOwnedRoot(owner);
  removedWorkspaces.set(key, { owner, runId });
}

module.exports = {
  plist,
  inspectSignedApp,
  shellWords,
  expandResponseFiles,
  inspectCompiledRNFirebase,
  cleanupWorkspace,
};
