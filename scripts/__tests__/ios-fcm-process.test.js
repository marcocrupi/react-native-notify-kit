const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { test } = require('node:test');
const { finishCleanup } = require('../ios-fcm-qualification');

function backend() {
  return require('../lib/ios-fcm-process');
}
for (const name of ['codesign', 'plutil', 'artifact verification', 'reinstall verification']) {
  test(`${name}: real subprocess ignoring SIGTERM escalates and settles`, async () => {
    const { runBounded } = backend();
    let child;
    const started = Date.now();
    await assert.rejects(
      runBounded(
        process.execPath,
        [
          '-e',
          'process.on("SIGTERM",()=>{});process.stdout.write("ready");setInterval(()=>{},1000)',
        ],
        {
          timeoutMs: 1000,
          graceMs: 80,
          settleMs: 300,
          timeoutCode: 'ARTIFACT_VERIFICATION_TIMEOUT',
          onSpawn: value => {
            child = value;
          },
        },
      ),
      error => {
        assert.equal(error.code, 'ARTIFACT_VERIFICATION_TIMEOUT');
        assert.deepEqual(error.process.signals, ['SIGTERM', 'SIGKILL']);
        assert.equal(error.process.settled, true);
        assert.equal(error.process.exitSignal, 'SIGKILL');
        return true;
      },
    );
    assert.ok(Date.now() - started < 2000);
    assert.throws(
      () => process.kill(child.pid, 0),
      error => error.code === 'ESRCH',
    );
  });
}

test('unobservable settlement is finite and never cleanup PASS; independent actions continue', async () => {
  const { runBounded } = backend();
  const child = new EventEmitter();
  Object.assign(child, {
    pid: 987654,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
  });
  const calls = [];
  const result = await finishCleanup([
    [
      'inspector',
      () =>
        runBounded('synthetic', [], {
          timeoutMs: 10,
          graceMs: 10,
          settleMs: 20,
          spawnImpl: () => child,
          killImpl: (_, signal) => {
            calls.push(signal);
          },
        }),
    ],
    [
      'independent',
      async () => {
        calls.push('independent');
      },
    ],
  ]);
  assert.equal(result.statuses.inspector, 'UNPROVEN');
  assert.equal(result.errors[0].code, 'PROCESS_SETTLEMENT_UNPROVEN');
  assert.equal(result.statuses.independent, 'PASS');
  assert.deepEqual(calls, ['SIGTERM', 'SIGKILL', 'independent']);
});

test('bounded executor collects stdin/output and closes the process on spawn error', async () => {
  const { runBounded } = backend();
  const result = await runBounded(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], {
    input: 'synthetic plist',
    timeoutMs: 2000,
  });
  assert.equal(result.stdout, 'synthetic plist');
  assert.equal(result.process.settled, true);
  await assert.rejects(
    runBounded('/missing-ios-fcm-tool', [], { timeoutMs: 100 }),
    error => error.code === 'ENOENT',
  );
});

test('escaped descendant retaining pipes yields finite UNPROVEN instead of hanging collection', async () => {
  const { runBounded } = backend();
  let escaped;
  const code = `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{detached:true,stdio:['ignore','inherit','inherit']}); process.stdout.write(String(child.pid)); setTimeout(()=>process.exit(0),100);`;
  const start = Date.now();
  try {
    await assert.rejects(
      runBounded(process.execPath, ['-e', code], {
        timeoutMs: 2000,
        graceMs: 80,
        settleMs: 150,
        onStdout: chunk => {
          escaped = Number(chunk.toString());
        },
      }),
      error => error.code === 'PROCESS_SETTLEMENT_UNPROVEN' && error.process.settled === false,
    );
    assert.ok(Date.now() - start < 2000);
    assert.ok(Number.isInteger(escaped) && escaped > 0);
  } finally {
    if (escaped)
      try {
        process.kill(-escaped, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
  }
});
