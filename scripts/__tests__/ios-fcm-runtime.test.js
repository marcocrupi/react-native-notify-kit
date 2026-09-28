const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {
  createOwnedRuntime,
  assertOwnedRuntime,
  artifactManifest,
} = require('../lib/ios-fcm-runtime');
const { cleanupWorkspace } = require('../lib/ios-fcm-artifact');

test('owned runtime confines child temp/cache paths without mutating parent environment', () => {
  const root = fs.mkdtempSync('/tmp/ios-fcm-runtime-test-');
  const before = { ...process.env };
  try {
    const runtime = createOwnedRuntime(root, 'owner');
    assertOwnedRuntime(runtime);
    for (const key of ['TMPDIR', 'TMP', 'TEMP', 'XDG_CACHE_HOME', 'BABEL_CACHE_PATH'])
      assert.ok(runtime.env[key].startsWith(runtime.paths.workspace + path.sep));
    assert.equal(runtime.env.HOME, before.HOME);
    assert.deepEqual({ ...process.env }, before);
    cleanupWorkspace(runtime.paths.workspace, 'owner');
    assert.equal(fs.existsSync(runtime.paths.workspace), false);
    assert.doesNotThrow(() => cleanupWorkspace(runtime.paths.workspace, 'owner'));
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test('foreign ownership and escaped cache directories fail closed without removing them', () => {
  const root = fs.mkdtempSync('/tmp/ios-fcm-runtime-test-');
  const foreign = fs.mkdtempSync('/tmp/ios-fcm-foreign-cache-');
  try {
    const runtime = createOwnedRuntime(root, 'owner');
    fs.writeFileSync(path.join(foreign, 'sentinel'), 'preserve');
    fs.rmSync(runtime.paths.transformCache, { recursive: true });
    fs.symlinkSync(foreign, runtime.paths.transformCache);
    assert.throws(
      () => assertOwnedRuntime(runtime),
      error => error.code === 'QUALIFICATION_CLEANUP_REFUSED',
    );
    assert.equal(fs.readFileSync(path.join(foreign, 'sentinel'), 'utf8'), 'preserve');
    fs.writeFileSync(path.join(runtime.paths.workspace, '.qualification-owner'), 'different-run');
    assert.throws(
      () => cleanupWorkspace(runtime.paths.workspace, 'owner'),
      error => error.code === 'QUALIFICATION_CLEANUP_REFUSED',
    );
    assert.equal(fs.existsSync(runtime.paths.workspace), true);
  } finally {
    fs.rmSync(root, { recursive: true });
    fs.rmSync(foreign, { recursive: true });
  }
});

test('full pilot manifest detects resource, mode, deletion and archive replacement', () => {
  const root = fs.mkdtempSync('/tmp/ios-fcm-pilot-manifest-');
  try {
    const pilot = path.join(root, 'standard.app');
    fs.mkdirSync(pilot);
    fs.writeFileSync(path.join(pilot, 'main'), 'verified');
    fs.writeFileSync(path.join(pilot, 'resource'), 'verified resource');
    const expected = artifactManifest(pilot);
    const copy = path.join(root, 'copy.app');
    fs.cpSync(pilot, copy, { recursive: true });
    assert.equal(artifactManifest(copy), expected);
    fs.writeFileSync(path.join(copy, 'resource'), 'changed');
    assert.notEqual(artifactManifest(copy), expected);
    fs.copyFileSync(path.join(pilot, 'resource'), path.join(copy, 'resource'));
    fs.chmodSync(path.join(copy, 'resource'), 0o700);
    assert.notEqual(artifactManifest(copy), expected);
    fs.rmSync(path.join(copy, 'resource'));
    assert.notEqual(artifactManifest(copy), expected);
    fs.symlinkSync(pilot, path.join(root, 'substituted.app'));
    assert.throws(
      () => artifactManifest(path.join(root, 'substituted.app')),
      error => error.code === 'QUALIFICATION_CLEANUP_REFUSED',
    );
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});
