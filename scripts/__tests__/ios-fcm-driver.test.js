const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function driver(overrides = {}) {
  const calls = [];
  const template = fs.readFileSync(
    path.join(__dirname, '../fixtures/ios-fcm-qualification/App.tsx.template'),
    'utf8',
  );
  const source = template
    .slice(0, template.indexOf('export default function App'))
    .replace(/^import[\s\S]*?;\n/gm, '')
    .replace(
      '__QUALIFICATION_CONFIG__',
      JSON.stringify({
        runId: 'test',
        callbackURL: 'http://private.test',
        callbackSecret: 'synthetic-secret',
        standardAutoInitEnabled: true,
      }),
    );
  const context = {
    setTimeout,
    getMessaging: () => ({}),
    getAPNSToken: async () => 'a'.repeat(64),
    deleteToken: async () => calls.push('deleteToken'),
    getToken: async () => {
      calls.push('getToken');
      return 'synthetic-full-fcm';
    },
    fetch: async (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer synthetic-secret');
      calls.push({ route: url.split('/').pop(), body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ ok: true }) };
    },
    ...overrides,
  };
  vm.runInNewContext(source + '\nglobalThis.execute = execute;', context);
  return { calls, execute: context.execute };
}

test('actual generated driver awaits delete completion before fresh token request', async () => {
  const d = driver();
  await d.execute({ id: 'command', action: 'regenerate' });
  assert.deepEqual(
    d.calls.map(value => (typeof value === 'string' ? value : value.body.kind || value.route)),
    [
      'delete-started',
      'deleteToken',
      'delete-completed',
      'generation-started',
      'getToken',
      'token',
      'result',
    ],
  );
});
test('actual driver deletion failure blocks generation and reports stale association', async () => {
  const d = driver({
    deleteToken: async () => {
      throw new Error('private exception');
    },
    getToken: async () => assert.fail('token must not be requested'),
  });
  await d.execute({ id: 'command', action: 'regenerate' });
  const result = d.calls.at(-1).body;
  assert.equal(result.errorCode, 'STALE_FCM_TOKEN_ASSOCIATION');
  assert.equal(result.status, 'ERROR');
  assert.ok(!JSON.stringify(d.calls).includes('private exception'));
});
test('actual driver APNs absence prevents token deletion and generation', async () => {
  const d = driver({
    getAPNSToken: async () => null,
    deleteToken: async () => assert.fail('APNs must be ready'),
    getToken: async () => assert.fail('APNs must be ready'),
  });
  await d.execute({ id: 'command', action: 'regenerate' });
  assert.equal(d.calls.at(-1).body.errorCode, 'APNS_TOKEN_UNAVAILABLE');
});

test('actual driver restores the standard fixture auto-init setting without requesting a token', async () => {
  const messaging = { isAutoInitEnabled: false };
  const d = driver({
    getMessaging: () => messaging,
    setAutoInitEnabled: async (instance, enabled) => {
      instance.isAutoInitEnabled = enabled;
    },
    getToken: async () => assert.fail('cleanup must not request a token'),
  });
  await d.execute({ id: 'cleanup', action: 'restore-settings' });
  assert.equal(d.calls.at(-1).body.status, 'OK');
  assert.equal(d.calls.at(-1).body.result.autoInitEnabled, true);
});
