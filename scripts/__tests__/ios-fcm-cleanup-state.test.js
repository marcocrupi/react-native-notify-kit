const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { finishCleanup } = require('../ios-fcm-qualification');
const { createOwnedRuntime, cleanupOwnedWorkspace } = require('../lib/ios-fcm-runtime');
const { cleanupWorkspace } = require('../lib/ios-fcm-artifact');
const { digest } = require('../lib/ios-fcm-qualification');
const { lifecycle } = require('./helpers/ios-fcm-lifecycle');

const violation = error => error.code === 'PATH_CONFINEMENT_VIOLATION';
const entry = filename => fs.lstatSync(filename, { throwIfNoEntry: false });
const marker = runtime => path.join(runtime.paths.workspace, '.qualification-owner');
function parked(runtime) {
  const original = runtime.paths.workspace + '-parked';
  fs.renameSync(runtime.paths.workspace, original);
  return original;
}
async function fixture(action) {
  const root = fs.mkdtempSync('/tmp/ios-fcm-cleanup-state-');
  const foreign = fs.mkdtempSync('/tmp/ios-fcm-cleanup-foreign-');
  fs.writeFileSync(path.join(foreign, 'sentinel'), 'foreign bytes must remain identical');
  try {
    await action({ root, foreign, runtime: createOwnedRuntime(root, 'synthetic-owner') });
  } finally {
    // Test-owned fixtures are released after preservation assertions.
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(foreign, { recursive: true, force: true });
  }
}

test('R02-B: dangling workspace symlink is a violation, never absent', () =>
  fixture(({ root, runtime }) => {
    const original = parked(runtime);
    fs.symlinkSync(path.join(root, 'missing-target'), runtime.paths.workspace);
    assert.equal(fs.existsSync(runtime.paths.workspace), false);
    assert.throws(() => cleanupOwnedWorkspace(runtime), violation);
    assert.equal(entry(runtime.paths.workspace).isSymbolicLink(), true);
    assert.equal(
      fs.readFileSync(path.join(original, '.qualification-owner'), 'utf8'),
      runtime.runId,
    );
  }));

test('R02-B: direct finishCleanup on dangling root preserves independent PASS actions', () =>
  fixture(async ({ root, runtime }) => {
    parked(runtime);
    fs.symlinkSync(path.join(root, 'missing-target'), runtime.paths.workspace);
    const calls = [];
    const result = await finishCleanup([
      ['relay', async () => calls.push('relay')],
      ['workspace', async () => cleanupOwnedWorkspace(runtime)],
      ['callback', async () => calls.push('callback')],
    ]);
    assert.deepEqual(result.statuses, { relay: 'PASS', workspace: 'UNPROVEN', callback: 'PASS' });
    assert.deepEqual(calls, ['relay', 'callback']);
    assert.equal(result.errors.length, 1);
    assert.equal(result.failures[0].phase, 'workspace');
    assert.equal(result.failures[0].error.code, 'PATH_CONFINEMENT_VIOLATION');
  }));

test('R02-B: foreign directory with matching marker bytes is preserved', () =>
  fixture(({ runtime }) => {
    const original = parked(runtime);
    fs.mkdirSync(runtime.paths.workspace, { mode: 0o700 });
    fs.writeFileSync(marker(runtime), runtime.runId);
    const sentinel = path.join(runtime.paths.workspace, 'sentinel');
    fs.writeFileSync(sentinel, 'foreign replacement');
    const before = digest(fs.readFileSync(sentinel));
    assert.throws(() => cleanupOwnedWorkspace(runtime), violation);
    assert.equal(digest(fs.readFileSync(sentinel)), before);
    assert.ok(entry(original).isDirectory());
  }));

test('R02-B: externally removed root has no successful-removal provenance', () =>
  fixture(({ runtime }) => {
    fs.rmSync(runtime.paths.workspace, { recursive: true });
    assert.throws(() => cleanupOwnedWorkspace(runtime), violation);
    assert.equal(entry(runtime.paths.workspace), undefined);
  }));

test('R02-B: missing marker imposes a confinement violation and retains root', () =>
  fixture(({ runtime }) => {
    fs.unlinkSync(marker(runtime));
    assert.throws(() => cleanupOwnedWorkspace(runtime), violation);
    assert.ok(entry(runtime.paths.workspace).isDirectory());
  }));

test('R02-B: replaced marker with identical bytes imposes HOLD', () =>
  fixture(({ runtime }) => {
    fs.renameSync(marker(runtime), marker(runtime) + '-parked');
    fs.writeFileSync(marker(runtime), runtime.runId);
    assert.throws(() => cleanupOwnedWorkspace(runtime), violation);
    assert.equal(fs.readFileSync(marker(runtime), 'utf8'), runtime.runId);
    assert.ok(entry(runtime.paths.workspace).isDirectory());
  }));

test('R02-B: verified removal by this controller produces workspace PASS', () =>
  fixture(async ({ runtime }) => {
    const result = await finishCleanup([['workspace', async () => cleanupOwnedWorkspace(runtime)]]);
    assert.equal(result.statuses.workspace, 'PASS');
    assert.deepEqual(result.errors, []);
    assert.equal(entry(runtime.paths.workspace), undefined);
  }));

test('R02-B: repeated cleanup after proven removal is idempotent PASS', () =>
  fixture(async ({ runtime }) => {
    cleanupOwnedWorkspace(runtime);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await finishCleanup([
        ['workspace', async () => cleanupOwnedWorkspace(runtime)],
      ]);
      assert.equal(result.statuses.workspace, 'PASS');
      assert.deepEqual(result.errors, []);
      assert.equal(entry(runtime.paths.workspace), undefined);
    }
  }));

test('R02-B: dangling link into foreign directory never touches its sentinel or target', () =>
  fixture(({ foreign, runtime }) => {
    const original = parked(runtime);
    const sentinel = path.join(foreign, 'sentinel');
    const target = path.join(foreign, 'missing-target');
    const before = digest(fs.readFileSync(sentinel));
    const entriesBefore = fs.readdirSync(foreign);
    fs.symlinkSync(target, runtime.paths.workspace);
    assert.throws(() => cleanupOwnedWorkspace(runtime), violation);
    assert.equal(digest(fs.readFileSync(sentinel)), before);
    assert.deepEqual(fs.readdirSync(foreign), entriesBefore);
    assert.equal(entry(target), undefined);
    assert.equal(fs.readlinkSync(runtime.paths.workspace), target);
    assert.ok(entry(original).isDirectory());
  }));

test('R02-B: a live foreign root symlink is preserved without recursive target deletion', () =>
  fixture(({ foreign, runtime }) => {
    parked(runtime);
    const sentinel = path.join(foreign, 'sentinel');
    const before = digest(fs.readFileSync(sentinel));
    fs.symlinkSync(foreign, runtime.paths.workspace);
    assert.throws(() => cleanupOwnedWorkspace(runtime), violation);
    assert.equal(digest(fs.readFileSync(sentinel)), before);
    assert.equal(fs.readlinkSync(runtime.paths.workspace), foreign);
  }));

test('R02-B: proven removal cannot authorize a subsequent dangling replacement', () =>
  fixture(({ foreign, runtime }) => {
    cleanupOwnedWorkspace(runtime);
    fs.symlinkSync(path.join(foreign, 'missing-target'), runtime.paths.workspace);
    assert.throws(() => cleanupOwnedWorkspace(runtime), violation);
    assert.ok(entry(runtime.paths.workspace).isSymbolicLink());
  }));

test('R02-B: proven removal cannot authorize a subsequent directory replacement', () =>
  fixture(({ runtime }) => {
    cleanupOwnedWorkspace(runtime);
    fs.mkdirSync(runtime.paths.workspace, { mode: 0o700 });
    fs.writeFileSync(marker(runtime), runtime.runId);
    assert.throws(() => cleanupOwnedWorkspace(runtime), violation);
    assert.ok(entry(runtime.paths.workspace).isDirectory());
  }));

test('R02-B: legacy cleanup refuses absence without its own removal provenance', () =>
  fixture(({ runtime }) => {
    fs.rmSync(runtime.paths.workspace, { recursive: true });
    assert.throws(() => cleanupWorkspace(runtime.paths.workspace, runtime.runId), violation);
  }));

test('R02-B: legacy cleanup distinguishes dangling roots from its successful removal', () =>
  fixture(({ foreign, runtime }) => {
    cleanupWorkspace(runtime.paths.workspace, runtime.runId);
    assert.doesNotThrow(() => cleanupWorkspace(runtime.paths.workspace, runtime.runId));
    fs.symlinkSync(path.join(foreign, 'missing-target'), runtime.paths.workspace);
    assert.throws(() => cleanupWorkspace(runtime.paths.workspace, runtime.runId), violation);
    assert.ok(entry(runtime.paths.workspace).isSymbolicLink());
  }));

test('R02-B: legacy successful removal does not prove cleanup by another run', () =>
  fixture(({ runtime }) => {
    cleanupWorkspace(runtime.paths.workspace, runtime.runId);
    assert.throws(() => cleanupWorkspace(runtime.paths.workspace, 'another-run'));
  }));

test('R02-B audit: unsuccessful removal cannot mint an absence proof', t =>
  fixture(({ runtime }) => {
    const remove = t.mock.method(fs, 'rmSync', () => {});
    try {
      assert.throws(() => cleanupOwnedWorkspace(runtime), violation);
      assert.ok(entry(runtime.paths.workspace).isDirectory());
    } finally {
      remove.mock.restore();
    }
    fs.rmSync(runtime.paths.workspace, { recursive: true });
    assert.throws(() => cleanupOwnedWorkspace(runtime), violation);
  }));

test('R02-B audit: a removal error after deletion leaves cleanup UNPROVEN on retry', t =>
  fixture(async ({ runtime }) => {
    const realRemove = fs.rmSync;
    const remove = t.mock.method(fs, 'rmSync', (...args) => {
      realRemove(...args);
      const error = new Error('removal completion not proven');
      error.code = 'EIO';
      throw error;
    });
    try {
      const result = await finishCleanup([
        ['workspace', async () => cleanupOwnedWorkspace(runtime)],
      ]);
      assert.equal(result.statuses.workspace, 'UNPROVEN');
      assert.equal(result.errors[0].code, 'EIO');
      assert.equal(entry(runtime.paths.workspace), undefined);
    } finally {
      remove.mock.restore();
    }
    assert.throws(() => cleanupOwnedWorkspace(runtime), violation);
  }));

test('R02-B audit: unreadable root metadata yields UNPROVEN without deletion', t =>
  fixture(async ({ runtime }) => {
    const realStat = fs.lstatSync;
    const stat = t.mock.method(fs, 'lstatSync', (filename, ...args) => {
      if (filename === runtime.owner.root) {
        const error = new Error('root inspection denied');
        error.code = 'EACCES';
        throw error;
      }
      return realStat(filename, ...args);
    });
    try {
      const result = await finishCleanup([
        ['workspace', async () => cleanupOwnedWorkspace(runtime)],
      ]);
      assert.equal(result.statuses.workspace, 'UNPROVEN');
      assert.equal(result.errors[0].code, 'EACCES');
    } finally {
      stat.mock.restore();
    }
    assert.ok(entry(runtime.paths.workspace).isDirectory());
    assert.equal(fs.readFileSync(marker(runtime), 'utf8'), runtime.runId);
  }));

test('R02-B audit: foreign marker symlink cannot authorize deletion even with matching bytes', () =>
  fixture(({ runtime, foreign }) => {
    const foreignMarker = path.join(foreign, 'marker');
    fs.writeFileSync(foreignMarker, runtime.runId);
    const before = digest(fs.readFileSync(foreignMarker));
    fs.unlinkSync(marker(runtime));
    fs.symlinkSync(foreignMarker, marker(runtime));
    assert.throws(() => cleanupOwnedWorkspace(runtime), violation);
    assert.equal(digest(fs.readFileSync(foreignMarker)), before);
    assert.ok(entry(marker(runtime)).isSymbolicLink());
  }));

test('R02-B audit: removal proof does not survive replacement of an owned ancestor', () =>
  fixture(({ root }) => {
    const parent = path.join(root, 'controller-parent');
    fs.mkdirSync(parent, { mode: 0o700 });
    const runtime = createOwnedRuntime(parent, 'ancestor-owner');
    cleanupOwnedWorkspace(runtime);
    fs.renameSync(parent, parent + '-parked');
    fs.mkdirSync(parent, { mode: 0o700 });
    assert.throws(() => cleanupOwnedWorkspace(runtime), violation);
    assert.equal(entry(runtime.paths.workspace), undefined);
    assert.ok(entry(parent + '-parked').isDirectory());
  }));

const replacements = {
  dangling: runtime => {
    parked(runtime);
    fs.symlinkSync(runtime.paths.workspace + '-missing', runtime.paths.workspace);
  },
  foreign: runtime => {
    parked(runtime);
    fs.mkdirSync(runtime.paths.workspace, { mode: 0o700 });
    fs.writeFileSync(marker(runtime), runtime.runId);
  },
  absent: runtime => fs.rmSync(runtime.paths.workspace, { recursive: true }),
  'marker-missing': runtime => fs.unlinkSync(marker(runtime)),
  'marker-replaced': runtime => {
    fs.renameSync(marker(runtime), marker(runtime) + '-parked');
    fs.writeFileSync(marker(runtime), runtime.runId);
  },
};
for (const [name, replace] of Object.entries(replacements)) {
  test(`R02-B: controller ${name} root blocks aggregate cleanup and runtime PASS`, async () => {
    const result = await lifecycle({ beforeWorkspaceCleanup: replace, retain: true });
    try {
      assert.equal(result.rejected, 'PATH_CONFINEMENT_VIOLATION');
      assert.equal(result.cleanup.workspaceCleanup, 'UNPROVEN');
      assert.equal(result.cleanup.status, 'UNPROVEN');
      assert.equal(result.report.runtimeStatus, 'BLOCKED');
      assert.equal(result.report.workspaceCleanup, 'UNPROVEN');
      assert.ok(
        result.report.cleanupErrors.some(
          error => error.phase === 'workspace' && error.code === 'PATH_CONFINEMENT_VIOLATION',
        ),
      );
      assert.equal(result.cleanup.callbackStopped, true);
      assert.equal(result.cleanup.driverCleanup, 'PASS');
      assert.equal(result.cleanup.standardFixtureRestore, 'PASS');
      assert.equal(result.cleanup.standardAutoInitRestore, 'PASS');
      assert.equal(result.state.forbiddenSyncCalls, 0);
      if (name === 'dangling') {
        assert.ok(entry(path.join(result.root, 'workspace')).isSymbolicLink());
        assert.ok(entry(path.join(result.root, 'workspace-parked/.qualification-owner')));
      }
    } finally {
      fs.rmSync(result.root, { recursive: true, force: true });
    }
  });
}
