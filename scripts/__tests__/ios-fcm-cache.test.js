const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Buffer } = require('node:buffer');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const { digest } = require('../lib/ios-fcm-qualification');

const repo = path.resolve(__dirname, '../..');
const smokeRequire = createRequire(path.join(repo, 'apps/smoke/package.json'));
const wiring = [
  'App.tsx',
  'index.js',
  'metro.config.js',
  'ios/NotifeeExample/AppDelegate.swift',
  'ios/NotifeeExample/Info.plist',
  'ios/NotifeeExample.xcodeproj/project.pbxproj',
];

function normalSmoke() {
  const config = smokeRequire('./metro.config.js');
  return {
    env: Object.fromEntries(
      ['TMPDIR', 'TMP', 'TEMP', 'XDG_CACHE_HOME', 'BABEL_CACHE_PATH'].map(key => [
        key,
        process.env[key],
      ]),
    ),
    temp: os.tmpdir(),
    fileMap: config.fileMapCacheDirectory,
    watcher: config.resolver.useWatchman,
    wiring: wiring.map(file => [
      file,
      digest(fs.readFileSync(path.join(repo, 'apps/smoke', file))),
    ]),
  };
}

const witnessCode = `
const fs=require('node:fs');
const {lifecycle,scanMarkers}=require(${JSON.stringify(path.join(__dirname, 'helpers/ios-fcm-lifecycle.js'))});
(async()=>{
 const r=await lifecycle({...JSON.parse(process.env.HOST_WITNESS_OPTIONS),realMetro:true,recordCache:true,retain:true});
 const secretAfter=scanMarkers(r.root,{runId:r.report.runId,callbackSecret:r.syntheticSecret},true);
 const after=scanMarkers(r.root,{runId:r.report.runId,callbackSecret:r.syntheticSecret});
 console.log(JSON.stringify({root:r.root,rejected:r.rejected,runId:r.report.runId,syntheticSecret:r.syntheticSecret,workspaceExists:r.workspaceExists,cacheBefore:r.state.cacheBefore,cacheFiles:r.state.cacheFiles,secretAfter,sharedCacheBefore:r.state.sharedCacheBefore,after,cleanup:r.cleanup,report:r.report}));
 fs.rmSync(r.root,{recursive:true});
})().catch(error=>{console.error(error);process.exitCode=1;});`;

for (const [name, options] of [
  ['success', {}],
  ['ordinary failure', { ordinaryError: true }],
  ['SIGINT', { phase: 'generation', signal: 'SIGINT' }],
  ['SIGTERM', { phase: 'generation', signal: 'SIGTERM' }],
  ['SIGINT during Metro', { phase: 'qualified-metro', signal: 'SIGINT' }],
  ['SIGTERM during Metro', { phase: 'qualified-metro', signal: 'SIGTERM' }],
]) {
  test(
    `real Metro confines generated driver and synthetic secret on ${name}`,
    { timeout: 90000 },
    () => {
      const before = normalSmoke();
      const shared = fs.mkdtempSync('/tmp/ios-fcm-simulated-shared-cache-');
      const sentinel = path.join(shared, 'metro-cache/00/unowned-sentinel');
      fs.mkdirSync(path.dirname(sentinel), { recursive: true });
      fs.writeFileSync(sentinel, 'shared cache must survive qualification reset');
      const sentinelDigest = digest(fs.readFileSync(sentinel));
      try {
        const child = spawnSync(process.execPath, ['-e', witnessCode], {
          cwd: repo,
          encoding: 'utf8',
          timeout: 85000,
          maxBuffer: 8 * 1024 * 1024,
          env: {
            ...process.env,
            TMPDIR: shared,
            TMP: shared,
            TEMP: shared,
            HOST_WITNESS_OPTIONS: JSON.stringify(options),
          },
        });
        assert.equal(child.status, 0, child.stderr);
        const result = JSON.parse(child.stdout);
        assert.equal(
          result.rejected,
          name === 'success'
            ? undefined
            : name === 'ordinary failure'
              ? 'QUALIFICATION_DRIVER_FAILURE'
              : 'QUALIFICATION_INTERRUPTED',
        );
        assert.ok(
          result.cacheBefore.some(file => file.includes('metro-transform')),
          'real generated driver must be present in owned Metro transform cache before closure',
        );
        assert.ok(result.cacheFiles['metro-transform'] > 0);
        if (!name.includes('during Metro'))
          assert.ok(
            result.cacheFiles['metro-file-map'] > 0,
            'real file-map artifacts must use the owned root',
          );
        assert.deepEqual(result.secretAfter, [], 'no synthetic secret may remain even in evidence');
        assert.deepEqual(
          result.sharedCacheBefore,
          [],
          'no run material may reach inherited shared temp/cache',
        );
        assert.equal(result.workspaceExists, false);
        assert.ok(
          result.after.every(file => file.startsWith(path.join(result.root, 'evidence'))),
          'retained evidence may contain public run ID; sensitive workspace/cache must be absent',
        );
        assert.equal(digest(fs.readFileSync(sentinel)), sentinelDigest);
        const roots = new Set([os.tmpdir(), '/tmp', '/private/tmp']);
        for (const root of roots) {
          for (const cacheName of fs.readdirSync(root).filter(item => /^metro(?:-|$)/.test(item))) {
            const cachePath = path.join(root, cacheName);
            const scan = spawnSync(
              'rg',
              ['-a', '-l', '-F', '-e', result.runId, '-e', result.syntheticSecret, '--', cachePath],
              { encoding: 'utf8', maxBuffer: 1024 * 1024 },
            );
            assert.equal(
              scan.status,
              1,
              'read-only global scan found witness material or could not complete: ' + cachePath,
            );
          }
        }
        assert.deepEqual(
          normalSmoke(),
          before,
          'ordinary smoke must inherit no qualification env/cache/wiring overrides',
        );
      } finally {
        fs.rmSync(shared, { recursive: true });
      }
    },
  );
}

test('installed Metro consumes canonical transform and file-map cache options', () => {
  const metroDir = path.dirname(smokeRequire.resolve('metro/package.json'));
  const configDir = path.dirname(smokeRequire.resolve('metro-config/package.json'));
  const types = fs.readFileSync(path.join(configDir, 'src/types.d.ts'), 'utf8');
  assert.match(types, /fileMapCacheDirectory\?: string/);
  assert.match(types, /cacheStores:/);
  assert.match(
    fs.readFileSync(path.join(metroDir, 'src/DeltaBundler/Transformer.js'), 'utf8'),
    /new _metroCache\.Cache\(config\.cacheStores\)/,
  );
  assert.match(
    fs.readFileSync(path.join(metroDir, 'src/node-haste/DependencyGraph/createFileMap.js'), 'utf8'),
    /config\.fileMapCacheDirectory \?\? config\.hasteMapCacheDirectory/,
  );
});

test('ordinary apps/smoke keeps its real cache path, environment and wiring after qualification', async () => {
  const { lifecycle } = require('./helpers/ios-fcm-lifecycle');
  const before = normalSmoke();
  async function cacheReadPath() {
    const filename = smokeRequire.resolve('./metro.config.js');
    delete require.cache[filename];
    const config = smokeRequire('./metro.config.js');
    const read = fs.promises.readFile;
    const paths = [];
    fs.promises.readFile = async (file, ...args) => {
      paths.push(file);
      return read(file, ...args);
    };
    try {
      await config.cacheStores[0].get(Buffer.alloc(32, 211));
    } finally {
      fs.promises.readFile = read;
    }
    assert.equal(paths.length, 1);
    return paths[0];
  }
  const cacheBefore = await cacheReadPath();
  assert.ok(cacheBefore.startsWith(path.join(os.tmpdir(), 'metro-cache') + path.sep));
  await lifecycle({ phase: 'generation' });
  assert.deepEqual(normalSmoke(), before);
  assert.equal(await cacheReadPath(), cacheBefore);
  assert.ok(!cacheBefore.includes('.qualification-runtime'));
});
