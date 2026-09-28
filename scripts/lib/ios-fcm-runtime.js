const fs = require('node:fs');
const path = require('node:path');
const { fail, digest } = require('./ios-fcm-qualification');
const filesystem = require('./ios-fcm-filesystem');
const {
  createOwnedRoot,
  ensureOwnedDirectory,
  assertOwnedPath,
  writeOwnedFile,
  isOwnedRootRemoved,
  removeOwnedRoot,
} = filesystem;

// Only the exact factory-issued object can carry workspace removal authority.
const ownedRuntimeStates = new WeakMap();
// Paths identify freshness only; they cannot recover a runtime or its proof.
const workspaceGenerations = new Map();

function createOwnedRuntime(root, runId) {
  const workspace = path.join(root, 'workspace');
  const outputOwner = createOwnedRoot(root);
  ensureOwnedDirectory(outputOwner, workspace);
  const owner = createOwnedRoot(workspace);
  const marker = path.join(workspace, '.qualification-owner');
  writeOwnedFile(owner, marker, runId, {
    mode: 0o600,
    flag: 'wx',
  });
  const markerStat = fs.lstatSync(marker);
  const markerIdentity = Object.freeze({
    dev: markerStat.dev,
    ino: markerStat.ino,
    uid: markerStat.uid,
  });
  const runtime = path.join(workspace, '.qualification-runtime');
  const paths = Object.freeze({
    workspace,
    runtime,
    temp: path.join(runtime, 'tmp'),
    transformCache: path.join(runtime, 'metro-transform'),
    fileMapCache: path.join(runtime, 'metro-file-map'),
    auxiliaryCache: path.join(runtime, 'auxiliary-cache'),
  });
  for (const directory of Object.values(paths)) ensureOwnedDirectory(owner, directory);
  const ownedRuntime = Object.freeze({
    runId,
    owner,
    markerIdentity,
    paths,
    env: Object.freeze({
      ...process.env,
      IOS_FCM_TOKEN: '',
      FCM_TOKEN: '',
      ANDROID_FCM_TOKEN: '',
      TMPDIR: paths.temp,
      TMP: paths.temp,
      TEMP: paths.temp,
      XDG_CACHE_HOME: paths.auxiliaryCache,
      BABEL_CACHE_PATH: path.join(paths.auxiliaryCache, 'babel.json'),
    }),
  });
  const rootStat = fs.lstatSync(owner.root);
  const workspaceGeneration = Symbol('workspace-generation');
  workspaceGenerations.set(owner.root, workspaceGeneration);
  ownedRuntimeStates.set(ownedRuntime, {
    provenance: Object.freeze({
      runId,
      owner,
      root: owner.root,
      rootIdentity: Object.freeze({ dev: rootStat.dev, ino: rootStat.ino, uid: rootStat.uid }),
      paths,
      workspace,
      marker,
      markerIdentity,
      workspaceGeneration,
    }),
    generation: 0,
    removalProof: undefined,
  });
  return ownedRuntime;
}

function assertOwnedRuntime(runtime, { allowMissing = false } = {}) {
  const workspace = runtime.paths.workspace;
  assertWorkspaceOwnership(runtime);
  const tmp = fs.realpathSync('/tmp');
  if (
    fs.lstatSync(workspace).isSymbolicLink() ||
    !fs.realpathSync(workspace).startsWith(tmp + path.sep) ||
    fs.readFileSync(path.join(workspace, '.qualification-owner'), 'utf8') !== runtime.runId
  )
    fail('QUALIFICATION_CLEANUP_REFUSED', 'Temporary runtime ownership is unproven.');
  for (const directory of Object.values(runtime.paths)) {
    if (allowMissing && !fs.lstatSync(directory, { throwIfNoEntry: false })) continue;
    const real = fs.realpathSync(directory);
    if (
      fs.lstatSync(directory).isSymbolicLink() ||
      (real !== fs.realpathSync(workspace) &&
        !real.startsWith(fs.realpathSync(workspace) + path.sep))
    )
      fail('QUALIFICATION_CLEANUP_REFUSED', 'Temporary runtime path escapes its owned workspace.');
    assertOwnedPath(runtime.owner, directory, { directory: true });
  }
}

function assertWorkspaceOwnership(runtime) {
  assertOwnedPath(runtime.owner, runtime.paths.workspace, { directory: true });
  const marker = path.join(runtime.paths.workspace, '.qualification-owner');
  assertOwnedPath(runtime.owner, marker);
  const stat = fs.lstatSync(marker, { throwIfNoEntry: false });
  if (!stat || ['dev', 'ino', 'uid'].some(key => stat[key] !== runtime.markerIdentity[key]))
    fail('PATH_CONFINEMENT_VIOLATION', 'Temporary runtime marker identity is missing or replaced.');
  if (fs.readFileSync(marker, 'utf8') !== runtime.runId)
    fail('QUALIFICATION_CLEANUP_REFUSED', 'Temporary runtime ownership is unproven.');
}

function cleanupOwnedWorkspace(runtime) {
  // Check private provenance before reading public fields or owner-level proof.
  const state = ownedRuntimeStates.get(runtime);
  if (!state) fail('PATH_CONFINEMENT_VIOLATION', 'Temporary runtime provenance is unproven.');
  const expected = state.provenance;
  if (
    runtime.runId !== expected.runId ||
    runtime.owner !== expected.owner ||
    runtime.owner.root !== expected.root ||
    runtime.paths !== expected.paths ||
    runtime.paths.workspace !== expected.workspace ||
    runtime.markerIdentity !== expected.markerIdentity ||
    workspaceGenerations.get(expected.root) !== expected.workspaceGeneration
  )
    fail('PATH_CONFINEMENT_VIOLATION', 'Temporary runtime provenance has changed.');
  if (state.removalProof) {
    try {
      if (
        state.removalProof.provenance !== expected ||
        state.removalProof.generation !== state.generation ||
        !isOwnedRootRemoved(expected.owner)
      )
        fail('PATH_CONFINEMENT_VIOLATION', 'Temporary runtime removal proof is unproven.');
    } catch (error) {
      // An observed replacement/unknown state cannot later replay the old proof.
      state.removalProof = undefined;
      state.generation++;
      throw error;
    }
    return;
  }
  assertWorkspaceOwnership(runtime);
  state.generation++;
  removeOwnedRoot(runtime.owner);
  // removeOwnedRoot returns only after successful removal and verified absence.
  state.removalProof = Object.freeze({ provenance: expected, generation: state.generation });
}

function writeMetroConfig(runtime) {
  assertOwnedRuntime(runtime);
  const filename = path.join(runtime.paths.workspace, 'apps/smoke/metro.qualification.cjs');
  // Metro 0.84.4 consumes cacheStores in Transformer and fileMapCacheDirectory
  // in DiskCacheManager. The deprecated hasteMap alias is deliberately omitted.
  writeOwnedFile(
    runtime.owner,
    filename,
    `const { mergeConfig } = require('@react-native/metro-config');
const { FileStore } = require('metro-cache');
module.exports = mergeConfig(require('./metro.config.js'), {
  cacheStores: [new FileStore({ root: ${JSON.stringify(runtime.paths.transformCache)} })],
  fileMapCacheDirectory: ${JSON.stringify(runtime.paths.fileMapCache)},
  resolver: { useWatchman: false },
});
`,
    { mode: 0o600 },
  );
  return filename;
}

function artifactManifest(app) {
  const base = fs.realpathSync(app);
  if (fs.lstatSync(app).isSymbolicLink())
    fail('QUALIFICATION_CLEANUP_REFUSED', 'Pilot archive cannot be a symlink.');
  const files = [];
  const visit = directory => {
    for (const name of fs.readdirSync(directory).sort()) {
      const filename = path.join(directory, name);
      const stat = fs.lstatSync(filename);
      const entry = { path: path.relative(base, filename), mode: stat.mode % 0o1000 };
      if (stat.isSymbolicLink()) {
        if (!fs.realpathSync(filename).startsWith(base + path.sep))
          fail('QUALIFICATION_CLEANUP_REFUSED', 'Pilot archive link escapes its verified bytes.');
        files.push({ ...entry, type: 'link', sha256: digest(fs.readlinkSync(filename)) });
      } else if (stat.isDirectory()) {
        files.push({ ...entry, type: 'directory' });
        visit(filename);
      } else if (stat.isFile())
        files.push({ ...entry, type: 'file', sha256: digest(fs.readFileSync(filename)) });
      else fail('QUALIFICATION_CLEANUP_REFUSED', 'Unsupported pilot archive entry.');
    }
  };
  visit(base);
  return digest(JSON.stringify({ mode: fs.statSync(base).mode % 0o1000, files }));
}

module.exports = {
  ...filesystem,
  createOwnedRuntime,
  assertOwnedRuntime,
  assertWorkspaceOwnership,
  cleanupOwnedWorkspace,
  writeMetroConfig,
  artifactManifest,
};
