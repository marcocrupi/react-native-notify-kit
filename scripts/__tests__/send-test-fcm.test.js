const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');
const { sendScenario, parseArgs } = require('../send-test-fcm');

function dependencies(send) {
  return {
    admin: { getApps: () => [{}], getMessaging: () => ({ send }) },
    serviceAccount: {},
    buildNotifyKitPayload: input => ({
      token: input.token,
      sizeBytes: 80,
      apns: {
        payload: {
          aps: { alert: { title: input.notification.title } },
          notifee_options: JSON.stringify(input.notification),
        },
      },
    }),
  };
}

test('existing sender can be imported without launching its CLI or sending', () => {
  const filename = path.join(__dirname, '../send-test-fcm.js');
  const child = spawnSync(
    process.execPath,
    [
      '-e',
      'const sender = require(process.argv[1]); if (typeof sender.sendScenario !== "function") process.exit(9);',
      filename,
    ],
    { env: { PATH: process.env.PATH }, encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.equal(child.stdout, '');
});

test('qualification authorization executes immediately before the existing transport', async () => {
  const calls = [];
  const result = await sendScenario(
    {
      token: 'private-token',
      scenario: 'minimal',
      correlationId: 'test',
      qualification: {
        phase: 'T0',
        t0Probe: true,
        authorizeSend: () => calls.push('authorize'),
        log: value => calls.push(value.scenario),
      },
    },
    dependencies(async payload => {
      calls.push('send');
      assert.equal(payload.token, 'private-token');
      return 'message-1';
    }),
  );
  assert.deepEqual(calls, ['minimal', 'authorize', 'send']);
  assert.equal(result.messageId, 'message-1');
  assert.match(result.rawTitle, /T0 RAW/);
  assert.notEqual(result.rawTitle, result.expectedTitle);
  assert.ok(!JSON.stringify(result).includes('private-token'));
});
test('rejected qualification authorization never dispatches Firebase', async () => {
  let calls = 0;
  await assert.rejects(
    sendScenario(
      {
        token: 'private-token',
        scenario: 'minimal',
        correlationId: 'test',
        qualification: {
          phase: 'FUNCTIONAL',
          authorizeSend: () => {
            throw new Error('T0_GATE_REQUIRED');
          },
        },
      },
      dependencies(async () => {
        calls++;
      }),
    ),
    /T0_GATE_REQUIRED/,
  );
  assert.equal(calls, 0);
});
test('missing or asynchronous qualification authorization fails closed', async () => {
  let calls = 0;
  for (const qualification of [{}, { phase: 'FUNCTIONAL', authorizeSend: async () => {} }]) {
    await assert.rejects(
      sendScenario(
        { token: 'private-token', scenario: 'minimal', correlationId: 'test', qualification },
        dependencies(async () => {
          calls++;
        }),
      ),
    );
  }
  assert.equal(calls, 0);
});
test('T0 cannot bypass the gate for a functional payload', async () => {
  let calls = 0;
  await assert.rejects(
    sendScenario(
      {
        token: 'private-token',
        scenario: 'ios-attachment',
        correlationId: 'id',
        qualification: { phase: 'T0', t0Probe: true, authorizeSend: () => {} },
      },
      dependencies(async () => {
        calls++;
      }),
    ),
  );
  assert.equal(calls, 0);
});
test('forged T0 flag cannot turn its authorization into a functional send', async () => {
  let sends = 0;
  for (const qualification of [
    { phase: 'T0', t0Probe: false, authorizeSend: () => {} },
    { phase: 'T0', authorizeSend: () => {} },
    { phase: 'FUNCTIONAL', t0Probe: true, authorizeSend: () => {} },
  ]) {
    await assert.rejects(
      sendScenario(
        { token: 'synthetic', scenario: 'emoji', correlationId: 'forged', qualification },
        dependencies(async () => {
          sends++;
          return 'accepted';
        }),
      ),
    );
  }
  assert.equal(sends, 0);
});
test('ordinary token and Android parsing retain existing compatibility', () => {
  assert.equal(parseArgs(['minimal'], { IOS_FCM_TOKEN: 'ios' }).token, 'ios');
  assert.equal(
    parseArgs(['android-expo-smoke'], { IOS_FCM_TOKEN: 'ios', ANDROID_FCM_TOKEN: 'android' }).token,
    'android',
  );
  assert.equal(parseArgs(['positional', 'emoji'], {}).token, 'positional');
});
