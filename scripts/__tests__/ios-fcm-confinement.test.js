const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const runtimeLib = require('../lib/ios-fcm-runtime');
const { cleanupWorkspace } = require('../lib/ios-fcm-artifact');

const secret = 'synthetic-confinement-secret';
function fixture(action) {
  const root = fs.mkdtempSync('/tmp/ios-fcm-confined-');
  const foreign = fs.mkdtempSync('/tmp/ios-fcm-foreign-fixture-');
  fs.writeFileSync(path.join(foreign, 'sentinel'), 'foreign sentinel');
  fs.writeFileSync(path.join(foreign, 'target'), 'existing foreign target');
  const before = snapshot(foreign);
  try {
    const runtime = runtimeLib.createOwnedRuntime(root, 'synthetic-owner');
    const app = path.join(runtime.paths.workspace, 'apps/smoke');
    fs.mkdirSync(app, { recursive: true });
    action({ root, foreign, before, runtime, app });
    assert.deepEqual(snapshot(foreign), before, 'foreign writes and deletes are both forbidden');
    assert.ok(!JSON.stringify(snapshot(foreign)).includes(secret));
    assert.ok(!JSON.stringify(snapshot(foreign)).includes('synthetic-owner'));
  } finally {
    // These are directly created test fixtures, never cleanup authority of the controller.
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(foreign, { recursive: true, force: true });
  }
}
function snapshot(root) {
  const files = {};
  const walk = directory => {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) walk(file);
      else
        files[path.relative(root, file)] = {
          mode: stat.mode,
          bytes: fs.readFileSync(file).toString('base64'),
        };
    }
  };
  walk(root);
  return files;
}
const violation = error => error.code === 'PATH_CONFINEMENT_VIOLATION';

test('pilot directory modes are copied through descriptors without a path-following chmod', () =>
  fixture(({ runtime, app }) => {
    const source = path.join(app, 'pilot');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'binary'), 'signed bytes');
    const chmod = fs.chmodSync;
    fs.chmodSync = () => assert.fail('path-following chmod is forbidden');
    try {
      runtimeLib.copyOwnedTree(runtime.owner, source, path.join(app, 'copy'));
    } finally {
      fs.chmodSync = chmod;
    }
    assert.equal(
      runtimeLib.artifactManifest(source),
      runtimeLib.artifactManifest(path.join(app, 'copy')),
    );
    runtimeLib.cleanupOwnedWorkspace(runtime);
  }));

test('actual Metro config refuses a foreign final-file symlink', () =>
  fixture(({ runtime, app, foreign }) => {
    fs.symlinkSync(path.join(foreign, 'target'), path.join(app, 'metro.qualification.cjs'));
    assert.throws(() => runtimeLib.writeMetroConfig(runtime), violation);
    cleanupWorkspace(runtime.paths.workspace, runtime.runId);
    assert.equal(fs.existsSync(runtime.paths.workspace), false);
  }));

for (const output of [
  'apps/smoke/App.tsx',
  'apps/smoke/index.js',
  'apps/smoke/metro.qualification.cjs',
  'apps/smoke/ios/NotifeeExample/AppDelegate.swift',
  'apps/smoke/ios/NotifeeExample/Info.plist',
  'apps/smoke/ios/NotifeeExample/main.jsbundle',
  'apps/smoke/ios/NotifeeExample.xcodeproj/project.pbxproj',
  '.qualification-runtime/callback.json',
  '.qualification-runtime/auxiliary-cache/babel.json',
]) {
  test(`${output}: existing final symlink cannot receive synthetic authorization`, () =>
    fixture(({ runtime, foreign }) => {
      const file = path.join(runtime.paths.workspace, output);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.symlinkSync(path.join(foreign, 'target'), file);
      assert.throws(() => runtimeLib.writeOwnedFile(runtime.owner, file, secret), violation);
      runtimeLib.cleanupOwnedWorkspace(runtime);
      assert.equal(fs.existsSync(runtime.paths.workspace), false);
    }));
}

for (const parent of [
  'apps',
  'apps/smoke',
  'apps/smoke/ios',
  'apps/smoke/ios/NotifeeExample',
  'apps/smoke/ios/NotifeeExample.xcodeproj',
  '.qualification-runtime',
  '.qualification-runtime/tmp',
  '.qualification-runtime/metro-transform',
  '.qualification-runtime/metro-file-map',
  '.qualification-runtime/auxiliary-cache',
  'standard-fixture',
  'packages',
  'packages/react-native',
  'packages/react-native/ios',
]) {
  test(`foreign parent symlink at ${parent} is rejected and only the link is removed`, () =>
    fixture(({ runtime, foreign }) => {
      const directory = path.join(runtime.paths.workspace, parent);
      fs.rmSync(directory, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(directory), { recursive: true });
      fs.symlinkSync(foreign, directory);
      const file = path.join(directory, 'target');
      assert.throws(() => runtimeLib.writeOwnedFile(runtime.owner, file, secret), violation);
      runtimeLib.cleanupOwnedWorkspace(runtime);
      assert.equal(fs.existsSync(runtime.paths.workspace), false);
    }));
}

test('dangling final symlink is rejected without creating a foreign target', () =>
  fixture(({ runtime, app, foreign }) => {
    const file = path.join(app, 'App.tsx');
    fs.symlinkSync(path.join(foreign, 'absent'), file);
    assert.throws(() => runtimeLib.writeOwnedFile(runtime.owner, file, secret), violation);
    runtimeLib.cleanupOwnedWorkspace(runtime);
  }));

test('parent substitution after temporary write blocks publication', () =>
  fixture(({ runtime, app, foreign }) => {
    const original = fs.writeFileSync;
    let replaced = false;
    fs.writeFileSync = (file, ...args) => {
      const result = original(file, ...args);
      if (typeof file === 'number' && !replaced) {
        replaced = true;
        fs.renameSync(app, app + '-parked');
        fs.symlinkSync(foreign, app);
      }
      return result;
    };
    try {
      assert.throws(
        () => runtimeLib.writeOwnedFile(runtime.owner, path.join(app, 'target'), secret),
        violation,
      );
    } finally {
      fs.writeFileSync = original;
    }
    assert.equal(replaced, true);
    runtimeLib.cleanupOwnedWorkspace(runtime);
    assert.equal(fs.existsSync(runtime.paths.workspace), false);
  }));

test('atomic temporary and rename stay in the destination parent/filesystem', () =>
  fixture(({ runtime, app }) => {
    const original = fs.renameSync;
    let renamed = false;
    fs.renameSync = (from, to) => {
      assert.equal(path.dirname(from), path.dirname(to));
      assert.equal(fs.lstatSync(from).dev, fs.lstatSync(path.dirname(to)).dev);
      assert.ok(path.basename(from).includes('.qualification-'));
      renamed = true;
      return original(from, to);
    };
    try {
      runtimeLib.writeOwnedFile(runtime.owner, path.join(app, 'App.tsx'), secret);
    } finally {
      fs.renameSync = original;
    }
    assert.equal(renamed, true);
    assert.equal(fs.readFileSync(path.join(app, 'App.tsx'), 'utf8'), secret);
    assert.ok(!fs.readdirSync(app).some(name => name.includes('.qualification-')));
    runtimeLib.cleanupOwnedWorkspace(runtime);
  }));

test('EXDEV never invokes a copy/unlink publication fallback', () =>
  fixture(({ runtime, app }) => {
    const rename = fs.renameSync,
      copy = fs.copyFileSync;
    let copies = 0;
    fs.renameSync = () => {
      const error = new Error('cross-device');
      error.code = 'EXDEV';
      throw error;
    };
    fs.copyFileSync = () => {
      copies++;
    };
    try {
      assert.throws(
        () => runtimeLib.writeOwnedFile(runtime.owner, path.join(app, 'App.tsx'), secret),
        error => error.code === 'EXDEV',
      );
    } finally {
      fs.renameSync = rename;
      fs.copyFileSync = copy;
    }
    assert.equal(copies, 0);
    assert.equal(fs.existsSync(path.join(app, 'App.tsx')), false);
    runtimeLib.cleanupOwnedWorkspace(runtime);
  }));

test('normal generation remains writable and root replacement imposes HOLD', () =>
  fixture(({ runtime, app }) => {
    runtimeLib.writeOwnedFile(runtime.owner, path.join(app, 'App.tsx'), secret);
    runtimeLib.writeMetroConfig(runtime);
    const workspace = runtime.paths.workspace;
    fs.renameSync(workspace, workspace + '-parked');
    fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(workspace, '.qualification-owner'), runtime.runId);
    assert.throws(() => runtimeLib.cleanupOwnedWorkspace(runtime), violation);
    assert.equal(fs.existsSync(workspace + '-parked'), true);
  }));

test('root substitution during atomic write blocks publication and retains the original root', () =>
  fixture(({ runtime, app }) => {
    const original = fs.writeFileSync;
    const workspace = runtime.paths.workspace;
    fs.writeFileSync = (file, ...args) => {
      const result = original(file, ...args);
      if (typeof file === 'number') {
        fs.renameSync(workspace, workspace + '-parked');
        fs.mkdirSync(workspace, { mode: 0o700 });
      }
      return result;
    };
    try {
      assert.throws(
        () => runtimeLib.writeOwnedFile(runtime.owner, path.join(app, 'App.tsx'), secret),
        violation,
      );
    } finally {
      fs.writeFileSync = original;
    }
    assert.equal(fs.existsSync(path.join(app, 'App.tsx')), false);
    assert.throws(() => runtimeLib.cleanupOwnedWorkspace(runtime), violation);
    assert.equal(fs.existsSync(workspace + '-parked'), true);
  }));

test('replacing the run marker with identical bytes still imposes HOLD', () =>
  fixture(({ runtime }) => {
    const marker = path.join(runtime.paths.workspace, '.qualification-owner');
    fs.renameSync(marker, marker + '-parked');
    fs.writeFileSync(marker, runtime.runId);
    assert.throws(() => runtimeLib.cleanupOwnedWorkspace(runtime), violation);
    assert.equal(fs.existsSync(runtime.paths.workspace), true);
  }));
