const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {
  expectedEnvironment,
  automaticEnvironment,
  checkEnvironment,
  QualificationSession,
  runMatrix,
  redact,
  patchAppDelegate,
} = require('../lib/ios-fcm-qualification');

const callback = type => `@implementation RNFBMessagingAppDelegate
- (void)application:(UIApplication *)application
    didRegisterForRemoteNotificationsWithDeviceToken:(NSData *)deviceToken {
  [[FIRMessaging messaging] setAPNSToken:deviceToken type:FIRMessagingAPNSTokenType${type}];
}
@end`;
const apnsHash = 'a'.repeat(64);
const token = 'synthetic-recipient:APA91' + 'x'.repeat(120);
function session(options = {}) {
  return new QualificationSession({
    runId: 'run-1',
    deviceId: 'physical-1',
    artifact: { sha256: 'b'.repeat(64), apsEnvironment: 'development', bundleId: 'fixture' },
    integration: { automaticEnvironment: 'sandbox', proxyEnabled: true },
    ...options,
  });
}
function readiness(s) {
  s.ready({
    runId: 'run-1',
    apnsPresent: true,
    apnsSHA256: apnsHash,
    apnsBytes: 32,
    environment: 'sandbox',
    evidenceKind: 'compiled-callback',
    timestamp: new Date().toISOString(),
  });
}
function fresh(s) {
  readiness(s);
  const deletion = s.beginDelete();
  s.completeDelete(deletion);
  const generation = s.beginGeneration();
  s.completeGeneration(generation, token);
}
function rejected(fn, code) {
  assert.throws(fn, error => error.code === code);
}

test('Debug + signed development expects sandbox, safe automatic callback', () => {
  const expected = expectedEnvironment({ 'aps-environment': 'development' });
  assert.equal(expected, 'sandbox');
  assert.equal(automaticEnvironment(callback('Sandbox')), 'sandbox');
  assert.doesNotThrow(() =>
    checkEnvironment({ expected, automatic: 'sandbox', mode: 'default', proxyEnabled: true }),
  );
});
test('Release + signed development rejects default Prod typing', () => {
  rejected(
    () =>
      checkEnvironment({
        expected: expectedEnvironment({ 'aps-environment': 'development' }),
        automatic: automaticEnvironment(callback('Prod')),
        mode: 'default',
        proxyEnabled: true,
      }),
    'UNSAFE_RNFIREBASE_ENVIRONMENT_INFERENCE',
  );
});
test('Release + signed production expects production', () => {
  assert.equal(expectedEnvironment({ 'aps-environment': 'production' }), 'production');
  assert.doesNotThrow(() =>
    checkEnvironment({
      expected: 'production',
      automatic: 'production',
      mode: 'default',
      proxyEnabled: true,
    }),
  );
});
test('missing or unsupported signed aps-environment fails fast', () => {
  for (const fixture of [{}, { 'aps-environment': '' }, { 'aps-environment': 'Debug' }]) {
    rejected(() => expectedEnvironment(fixture), 'SIGNED_ENTITLEMENT_UNREADABLE');
  }
});
test('FCM generation before APNs association is rejected', () => {
  const s = session();
  rejected(() => s.beginGeneration(), 'STALE_FCM_TOKEN_ASSOCIATION');
  rejected(() => s.completeGeneration({ epoch: 0 }, token), 'STALE_FCM_TOKEN_ASSOCIATION');
});
test('T0 rejection prevents every functional send', async () => {
  const s = session();
  fresh(s);
  const sends = [];
  await assert.rejects(
    runMatrix({
      session: s,
      scenarios: ['ios-attachment'],
      send: async options => {
        options.qualification.authorizeSend();
        sends.push(options);
        throw Object.assign(new Error('BadDeviceToken'), { code: 'messaging/invalid-argument' });
      },
      observe: async () => assert.fail('must not observe a rejected send'),
    }),
  );
  assert.equal(sends.length, 1);
  assert.equal(sends[0].qualification.phase, 'T0');
  assert.equal(s.evidence().scenarios[0].status, 'NOT_RUN');
  assert.equal(s.evidence().blocker.code, 'FIREBASE_APNS_TRANSPORT_FAILURE');
});
test('T0 accepted without device receipt still prevents functional sends', async () => {
  const s = session();
  fresh(s);
  let count = 0;
  await assert.rejects(
    runMatrix({
      session: s,
      scenarios: ['minimal'],
      send: async options => {
        options.qualification.authorizeSend();
        count++;
        return { messageId: 'projects/fixture/messages/t0' };
      },
      observe: async () => ({ received: false }),
    }),
  );
  assert.equal(count, 1);
  assert.equal(s.evidence().scenarios[0].status, 'NOT_RUN');
});
test('T0 delivery success unlocks downstream scenarios', async () => {
  const s = session();
  fresh(s);
  const phases = [];
  await runMatrix({
    session: s,
    scenarios: ['minimal'],
    send: async options => {
      options.qualification.authorizeSend();
      phases.push(options.qualification.phase);
      return { messageId: 'projects/fixture/messages/' + phases.length };
    },
    observe: async () => ({ received: true, nseExecuted: true, contentProcessed: true }),
  });
  assert.deepEqual(phases, ['T0', 'FUNCTIONAL']);
  assert.equal(s.evidence().t0.status, 'PASS');
  assert.equal(s.evidence().scenarios[0].status, 'PASS');
});
test('NSE expected: message ID and receipt without NSE proof cannot qualify', async () => {
  const s = session({ requireNse: true });
  fresh(s);
  let count = 0;
  await assert.rejects(
    runMatrix({
      session: s,
      scenarios: ['minimal'],
      send: async options => {
        options.qualification.authorizeSend();
        count++;
        return { messageId: 'projects/fixture/messages/t0' };
      },
      observe: async () => ({ received: true, nseExecuted: false, contentProcessed: false }),
    }),
  );
  assert.equal(count, 1);
  assert.equal(s.evidence().blocker.code, 'NSE_EXECUTION_UNPROVEN');
});
test('token/report redaction includes nested errors, APNs, FCM, keys and OAuth', () => {
  const apns = '0123456789abcdef'.repeat(4);
  const key = '-----BEGIN PRIVATE KEY-----\nsecret-key-material\n-----END PRIVATE KEY-----';
  const input = {
    token,
    apnsToken: apns,
    private_key: key,
    authorization: 'Bearer oauth-secret',
    error: { message: `recipient ${token} apns=${apns} Bearer oauth-secret ${key}` },
    sha256: apnsHash,
  };
  const output = JSON.stringify(redact(input));
  for (const secret of [token, apns, 'secret-key-material', 'oauth-secret'])
    assert.ok(!output.includes(secret));
  assert.equal(redact(input).sha256, apnsHash);
  const s = session();
  fresh(s);
  assert.ok(!JSON.stringify(s.evidence()).includes(token));
});
test('Debug with signed production fails despite build label', () => {
  rejected(
    () =>
      checkEnvironment({
        expected: 'production',
        automatic: 'sandbox',
        mode: 'default',
        proxyEnabled: true,
      }),
    'UNSAFE_RNFIREBASE_ENVIRONMENT_INFERENCE',
  );
});
test('unverifiable RNFirebase callback is a STOP', () => {
  rejected(
    () => automaticEnvironment('unknown implementation'),
    'RNFIREBASE_INTEGRATION_UNVERIFIED',
  );
});
test('manual correction requires disabled proxy and matching controlled environment', () => {
  rejected(
    () =>
      checkEnvironment({
        expected: 'sandbox',
        automatic: 'production',
        mode: 'signed-entitlement',
        proxyEnabled: true,
        controlled: 'sandbox',
      }),
    'UNSAFE_RNFIREBASE_ENVIRONMENT_INFERENCE',
  );
  rejected(
    () =>
      checkEnvironment({
        expected: 'sandbox',
        automatic: 'production',
        mode: 'signed-entitlement',
        proxyEnabled: false,
        controlled: 'production',
      }),
    'SIGNED_ENTITLEMENT_MISMATCH',
  );
});
test('stale generation completion cannot publish after APNs identity changes', () => {
  const s = session();
  readiness(s);
  const deletion = s.beginDelete();
  s.completeDelete(deletion);
  const generation = s.beginGeneration();
  s.ready({
    runId: 'run-1',
    apnsPresent: true,
    apnsSHA256: 'c'.repeat(64),
    apnsBytes: 32,
    environment: 'sandbox',
    evidenceKind: 'compiled-callback',
    timestamp: new Date().toISOString(),
  });
  rejected(() => s.completeGeneration(generation, token), 'STALE_FCM_TOKEN_ASSOCIATION');
});
test('APNs identity change during the last functional observation invalidates qualification', async () => {
  const s = session();
  fresh(s);
  await assert.rejects(
    runMatrix({
      session: s,
      scenarios: ['minimal'],
      send: async options => {
        options.qualification.authorizeSend();
        return { messageId: 'accepted' };
      },
      observe: async result => {
        if (result.phase === 'FUNCTIONAL')
          s.ready({
            runId: 'run-1',
            apnsPresent: true,
            apnsSHA256: 'c'.repeat(64),
            apnsBytes: 32,
            environment: 'sandbox',
            evidenceKind: 'compiled-callback',
            timestamp: new Date().toISOString(),
          });
        return { received: true };
      },
    }),
    error => error.code === 'STALE_FCM_TOKEN_ASSOCIATION',
  );
  assert.equal(s.evidence().scenarios[0].status, 'NOT_RUN');
});
test('failed deletion and stale deletion receipts cannot enable generation', () => {
  const s = session();
  readiness(s);
  rejected(() => s.completeDelete({ epoch: -1 }), 'STALE_FCM_TOKEN_ASSOCIATION');
  rejected(() => s.beginGeneration(), 'STALE_FCM_TOKEN_ASSOCIATION');
});
test('foreign APNs readiness and missing APNs fail closed', () => {
  const s = session();
  rejected(() => s.ready({ runId: 'foreign', apnsPresent: true }), 'CANDIDATE_IDENTITY_MISMATCH');
  rejected(() => s.ready({ runId: 'run-1', apnsPresent: false }), 'APNS_TOKEN_UNAVAILABLE');
});
test('initial manual association must be explicitly proven', () => {
  const s = session({
    mode: 'signed-entitlement',
    integration: { proxyEnabled: false, controlledEnvironment: 'sandbox' },
  });
  rejected(() => readiness(s), 'UNSAFE_RNFIREBASE_ENVIRONMENT_INFERENCE');
});
test('saved PASS evidence cannot authorize sends and token mismatch is rejected', () => {
  const s = session();
  fresh(s);
  s.t0 = { status: 'PASS' };
  rejected(() => s.authorizeSend({ phase: 'FUNCTIONAL', token }), 'T0_GATE_REQUIRED');
  rejected(() => s.authorizeSend({ phase: 'T0', token: 'foreign' }), 'STALE_FCM_TOKEN_ASSOCIATION');
});
test('expired and closed qualification cannot authorize or reopen', () => {
  const expired = session({ ttlMs: 0 });
  fresh(expired);
  expired.beginT0('t0');
  rejected(
    () => expired.authorizeSend({ phase: 'T0', token, correlationId: 't0' }),
    'T0_GATE_EXPIRED',
  );
  const closed = session();
  fresh(closed);
  closed.close();
  rejected(() => closed.authorizeSend({ phase: 'FUNCTIONAL', token }), 'T0_GATE_EXPIRED');
  rejected(() => readiness(closed), 'T0_GATE_EXPIRED');
});
test('ordinary fixture and fcm-token route remain standard RNFirebase', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../apps/smoke/App.tsx'), 'utf8');
  const normalFlow = app.slice(
    app.indexOf('const runSmokeFcmToken'),
    app.indexOf('const setRemoteOff'),
  );
  assert.match(normalFlow, /getToken\(messaging\)/);
  assert.doesNotMatch(normalFlow, /deleteToken|qualification|setAPNSToken/);
  const wrapper = fs.readFileSync(path.join(__dirname, '../smoke-ios-device-e2e.sh'), 'utf8');
  assert.match(wrapper, /fcm-token\)\s+launch_smoke_run "fcm-token"/);
});
test('generated correction is isolated, public, initial, and leaves original source intact', () => {
  const original = fs.readFileSync(
    path.join(__dirname, '../../apps/smoke/ios/NotifeeExample/AppDelegate.swift'),
    'utf8',
  );
  const generated = patchAppDelegate(original, {
    runId: 'run-1',
    callbackURL: 'http://192.0.2.1:49152',
    callbackSecret: 'ephemeral',
    mode: 'signed-entitlement',
    expected: 'sandbox',
  });
  assert.match(generated, /setAPNSToken\(deviceToken, type: \.sandbox\)/);
  assert.match(generated, /apnsToken == nil/);
  assert.ok(
    generated.indexOf('INITIAL_APNS_ASSOCIATION_ALREADY_PRESENT') <
      generated.indexOf('setAPNSToken(deviceToken'),
  );
  assert.match(generated, /getDeliveredNotifications/);
  assert.match(generated, /notification.request.content.title/);
  assert.doesNotMatch(generated, /currentAPNSInfo|value\(forKey|NSSelectorFromString|SecTask/);
  assert.equal(
    fs.readFileSync(
      path.join(__dirname, '../../apps/smoke/ios/NotifeeExample/AppDelegate.swift'),
      'utf8',
    ),
    original,
  );
});
