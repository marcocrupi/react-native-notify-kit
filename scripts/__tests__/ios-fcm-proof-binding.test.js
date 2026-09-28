const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { finishCleanup } = require('../ios-fcm-qualification');
const {
  createOwnedRuntime,
  cleanupOwnedWorkspace,
  removeOwnedRoot,
} = require('../lib/ios-fcm-runtime');
const { digest } = require('../lib/ios-fcm-qualification');

const entry = filename => fs.lstatSync(filename, { throwIfNoEntry: false });
const identity = filename => {
  const stat = fs.lstatSync(filename);
  return Object.fromEntries(
    ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs'].map(key => [
      key,
      stat[key],
    ]),
  );
};
async function fixture(action) {
  const root = fs.mkdtempSync('/tmp/ios-fcm-proof-binding-');
  const rootA = path.join(root, 'A');
  const rootB = path.join(root, 'B');
  const sentinel = path.join(root, 'foreign-sentinel');
  fs.mkdirSync(rootA, { mode: 0o700 });
  fs.mkdirSync(rootB, { mode: 0o700 });
  fs.writeFileSync(sentinel, 'foreign bytes must remain identical', { mode: 0o640 });
  const before = { stat: identity(sentinel), sha256: digest(fs.readFileSync(sentinel)) };
  try {
    await action({
      rootA,
      a: createOwnedRuntime(rootA, 'run-A'),
      b: createOwnedRuntime(rootB, 'run-B'),
    });
    assert.deepEqual(identity(sentinel), before.stat);
    assert.equal(digest(fs.readFileSync(sentinel)), before.sha256);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const cleanup = runtime =>
  finishCleanup([['workspace', async () => cleanupOwnedWorkspace(runtime)]]);
function unproven(result) {
  assert.equal(result.statuses.workspace, 'UNPROVEN');
  assert.equal(result.errors.length, 1);
  assert.equal(result.failures[0].phase, 'workspace');
  assert.equal(result.errors[0].code, 'PATH_CONFINEMENT_VIOLATION');
}
function pass(result) {
  assert.equal(result.statuses.workspace, 'PASS');
  assert.deepEqual(result.errors, []);
}

const replays = {
  'A cross-runtime owner transplant': ({ a, b }) => Object.freeze({ ...b, owner: a.owner }),
  'B modified runId clone': ({ a }) => Object.freeze({ ...a, runId: 'run-B' }),
  'C incomplete runtime': ({ a }) => Object.freeze({ owner: a.owner }),
  'D value-identical clone': ({ a }) => Object.freeze({ ...a }),
  'H unrelated authentic runtime with externally removed root': ({ b }) => b,
  'public proof and generation fields': ({ a, b }) =>
    Object.freeze({ ...b, owner: a.owner, removalProof: a, removalGeneration: 1 }),
};
for (const [name, replay] of Object.entries(replays)) {
  test(`R02-B proof binding: ${name} is UNPROVEN without destructive operations`, t =>
    fixture(async ({ a, b }) => {
      pass(await cleanup(a));
      fs.rmSync(b.paths.workspace, { recursive: true });
      const remove = t.mock.method(fs, 'rmSync');
      try {
        unproven(await cleanup(replay({ a, b })));
        assert.equal(remove.mock.callCount(), 0);
        assert.equal(entry(a.paths.workspace), undefined);
        assert.equal(entry(b.paths.workspace), undefined);
      } finally {
        remove.mock.restore();
      }
    }));
}

test('R02-B proof binding: E/F authentic first and second retry PASS with zero new rm', t =>
  fixture(async ({ a }) => {
    const remove = t.mock.method(fs, 'rmSync');
    try {
      pass(await cleanup(a));
      assert.equal(remove.mock.callCount(), 1);
      for (let attempt = 0; attempt < 2; attempt++) {
        pass(await cleanup(a));
        assert.equal(remove.mock.callCount(), 1);
        assert.equal(entry(a.paths.workspace), undefined);
      }
    } finally {
      remove.mock.restore();
    }
  }));

test('R02-B proof binding: G previous generation cannot prove a new runtime at the same run/root', t =>
  fixture(async ({ rootA, a }) => {
    pass(await cleanup(a));
    const next = createOwnedRuntime(rootA, a.runId);
    assert.equal(next.runId, a.runId);
    assert.equal(next.paths.workspace, a.paths.workspace);
    fs.rmSync(next.paths.workspace, { recursive: true });
    const remove = t.mock.method(fs, 'rmSync');
    try {
      unproven(await cleanup(next));
      assert.equal(remove.mock.callCount(), 0);
    } finally {
      remove.mock.restore();
    }
  }));

test('R02-B proof binding: G old authentic proof is stale after a newer same-root removal', t =>
  fixture(async ({ rootA, a }) => {
    pass(await cleanup(a));
    const next = createOwnedRuntime(rootA, a.runId);
    pass(await cleanup(next));
    const remove = t.mock.method(fs, 'rmSync');
    try {
      unproven(await cleanup(a));
      pass(await cleanup(next));
      assert.equal(remove.mock.callCount(), 0);
    } finally {
      remove.mock.restore();
    }
  }));

test('R02-B proof binding: an observed replacement invalidates the previous removal generation', t =>
  fixture(async ({ a }) => {
    pass(await cleanup(a));
    fs.mkdirSync(a.paths.workspace, { mode: 0o700 });
    unproven(await cleanup(a));
    assert.ok(entry(a.paths.workspace).isDirectory());
    fs.rmSync(a.paths.workspace, { recursive: true });
    const remove = t.mock.method(fs, 'rmSync');
    try {
      unproven(await cleanup(a));
      assert.equal(remove.mock.callCount(), 0);
    } finally {
      remove.mock.restore();
    }
  }));

test('R02-B proof binding: clone cannot mint authority while the authentic root still exists', t =>
  fixture(async ({ a }) => {
    const marker = path.join(a.paths.workspace, '.qualification-owner');
    const before = fs.readFileSync(marker);
    const remove = t.mock.method(fs, 'rmSync');
    try {
      unproven(await cleanup(Object.freeze({ ...a })));
      assert.equal(remove.mock.callCount(), 0);
      assert.deepEqual(fs.readFileSync(marker), before);
      assert.ok(entry(a.paths.workspace).isDirectory());
      pass(await cleanup(a));
      assert.equal(remove.mock.callCount(), 1);
    } finally {
      remove.mock.restore();
    }
  }));

test('R02-B proof binding: owner-level removal alone cannot mint runtime removal authority', t =>
  fixture(async ({ a }) => {
    removeOwnedRoot(a.owner);
    const remove = t.mock.method(fs, 'rmSync');
    try {
      unproven(await cleanup(a));
      assert.equal(remove.mock.callCount(), 0);
    } finally {
      remove.mock.restore();
    }
  }));
