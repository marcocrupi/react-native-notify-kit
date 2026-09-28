const crypto = require('node:crypto');

class QualificationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
function fail(code, message) {
  throw new QualificationError(code, message);
}
const now = () => new Date().toISOString();
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

function expectedEnvironment(entitlements) {
  switch (entitlements?.['aps-environment']) {
    case 'development':
      return 'sandbox';
    case 'production':
      return 'production';
    default:
      return fail(
        'SIGNED_ENTITLEMENT_UNREADABLE',
        'Signed aps-environment is missing, unreadable or unsupported.',
      );
  }
}

// Input is the actually preprocessed implementation, not the configuration name.
function automaticEnvironment(preprocessed) {
  const implementation = preprocessed.split('@implementation RNFBMessagingAppDelegate')[1];
  const callback = implementation
    ?.split('didRegisterForRemoteNotificationsWithDeviceToken:')[1]
    ?.split('// called when')[0];
  const types = [
    ...(callback ?? '').matchAll(
      /setAPNSToken\s*:\s*deviceToken\s+type\s*:\s*FIRMessagingAPNSTokenType(Sandbox|Prod)/g,
    ),
  ];
  if (types.length !== 1)
    fail(
      'RNFIREBASE_INTEGRATION_UNVERIFIED',
      'Cannot establish the compiled RNFirebase APNs registration callback type.',
    );
  return types[0][1] === 'Sandbox' ? 'sandbox' : 'production';
}

function checkEnvironment({ expected, automatic, mode, proxyEnabled, controlled }) {
  if (mode === 'signed-entitlement') {
    if (proxyEnabled !== false)
      fail(
        'UNSAFE_RNFIREBASE_ENVIRONMENT_INFERENCE',
        'The qualification correction requires disabled app-delegate proxy before launch.',
      );
    if (controlled !== expected)
      fail(
        'SIGNED_ENTITLEMENT_MISMATCH',
        'Controlled initial APNs type differs from the signed artifact.',
      );
  } else if (mode === 'default') {
    if (proxyEnabled !== true || !['sandbox', 'production'].includes(automatic))
      fail(
        'RNFIREBASE_INTEGRATION_UNVERIFIED',
        'Default RNFirebase registration wiring is not verifiable.',
      );
    if (automatic !== expected)
      fail(
        'UNSAFE_RNFIREBASE_ENVIRONMENT_INFERENCE',
        `Signed artifact requires ${expected}; compiled RNFirebase callback selects ${automatic}. Use the explicit smoke-only signed-entitlement lane.`,
      );
  } else {
    fail('QUALIFICATION_CONFIGURATION', 'Unknown APNs association mode.');
  }
}

function redact(value, secrets = [], key = '') {
  if (
    /^(token|fcmToken|apnsToken|deviceToken|private_key|privateKey|authorization|callbackSecret|access_token|refresh_token|password|secret)$/i.test(
      key,
    )
  )
    return '<redacted>';
  if (Array.isArray(value)) return value.map(item => redact(item, secrets));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, redact(item, secrets, name)]),
    );
  if (typeof value !== 'string') return value;
  let text = value;
  for (const secret of secrets)
    if (typeof secret === 'string' && secret.length) text = text.split(secret).join('<redacted>');
  text = text.replace(
    /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
    '<redacted-private-key>',
  );
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer <redacted>');
  text = text.replace(/[A-Za-z0-9_-]{12,}:APA91[A-Za-z0-9_-]+/g, '<redacted-fcm-token>');
  if (!/(?:sha256|hash)$/i.test(key)) text = text.replace(/\b[0-9a-f]{64}\b/gi, '<redacted-hex>');
  return text;
}

function classify(error) {
  if (error instanceof QualificationError) return { code: error.code, message: error.message };
  const code = typeof error?.code === 'string' ? error.code : '';
  const message = typeof error?.message === 'string' ? error.message : '';
  if (
    code.startsWith('messaging/') ||
    /BadDeviceToken|APNs device token|third.party.auth|SenderId mismatch/i.test(message)
  ) {
    return {
      code: 'FIREBASE_APNS_TRANSPORT_FAILURE',
      providerCode: code || 'unknown',
      message:
        'Firebase/APNs rejected the qualification push; downstream scenarios were not qualified.',
    };
  }
  return {
    code: 'QUALIFICATION_TOOLING_FAILURE',
    message: 'Qualification tooling failed; inspect the redacted diagnostic evidence.',
  };
}

class QualificationSession {
  #state = 'ARTIFACT_VERIFIED';
  #epoch = 0;
  #operation = null;
  #token = null;
  #qualified = false;
  #t0Authorized = false;
  #expiresAt;
  #report;
  constructor({
    runId,
    deviceId,
    artifact,
    integration,
    mode = 'default',
    requireNse = false,
    ttlMs = 15 * 60 * 1000,
  }) {
    this.#expiresAt = Date.now() + ttlMs;
    this.expected = expectedEnvironment({ 'aps-environment': artifact.apsEnvironment });
    checkEnvironment({
      expected: this.expected,
      automatic: integration.automaticEnvironment,
      mode,
      proxyEnabled: integration.proxyEnabled,
      controlled: integration.controlledEnvironment,
    });
    this.runId = runId;
    this.mode = mode;
    this.requireNse = requireNse;
    this.#report = {
      runId,
      deviceId,
      artifact,
      integration,
      mode,
      expectedEnvironment: this.expected,
      startedAt: now(),
      expiresAt: new Date(this.#expiresAt).toISOString(),
      apns: null,
      fcm: null,
      t0: { status: 'NOT_RUN' },
      scenarios: [],
    };
  }
  #sequence(state) {
    if (this.#state !== state)
      fail('STALE_FCM_TOKEN_ASSOCIATION', `Expected ${state}; qualification is ${this.#state}.`);
  }
  ready(proof) {
    if (this.#state === 'CLOSED') fail('T0_GATE_EXPIRED', 'Closed qualification cannot be reused.');
    if (proof.runId !== this.runId)
      fail('CANDIDATE_IDENTITY_MISMATCH', 'APNs proof belongs to a different qualification run.');
    if (
      !proof.apnsPresent ||
      !/^[a-f0-9]{64}$/.test(proof.apnsSHA256 ?? '') ||
      !(proof.apnsBytes > 0)
    )
      fail('APNS_TOKEN_UNAVAILABLE', 'A real APNs token is not ready.');
    const requiredKind = this.mode === 'default' ? 'compiled-callback' : 'controlled-initial';
    if (
      proof.environment !== this.expected ||
      proof.evidenceKind !== requiredKind ||
      (this.mode !== 'default' && proof.initialAssociation !== true)
    )
      fail(
        'UNSAFE_RNFIREBASE_ENVIRONMENT_INFERENCE',
        'Correct initial APNs association is not proven.',
      );
    if (!Number.isFinite(Date.parse(proof.timestamp)))
      fail('APNS_TOKEN_UNAVAILABLE', 'APNs readiness timestamp is unavailable.');
    if (this.#state === 'BLOCKED')
      fail('T0_GATE_REQUIRED', 'This qualification attempt has stopped.');
    // Intentional app termination/relaunch preserves the route only for identical evidence.
    if (this.#report.apns?.apnsSHA256 === proof.apnsSHA256) return;
    this.#epoch++;
    this.#operation = null;
    this.#token = null;
    this.#qualified = false;
    this.#report.apns = { ...proof, observedFirebaseEnvironment: 'UNOBSERVABLE_PUBLIC_API' };
    this.#report.fcm = null;
    this.#report.t0 = { status: 'NOT_RUN' };
    this.#state = 'APNS_READY';
  }
  beginDelete() {
    this.#sequence('APNS_READY');
    this.#state = 'DELETING_FCM';
    this.#operation = Object.freeze({
      epoch: this.#epoch,
      id: crypto.randomUUID(),
      kind: 'delete',
    });
    this.#report.deleteStartedAt = now();
    return this.#operation;
  }
  completeDelete(operation) {
    this.#sequence('DELETING_FCM');
    if (operation !== this.#operation || operation.epoch !== this.#epoch)
      fail('STALE_FCM_TOKEN_ASSOCIATION', 'Stale FCM deletion completion.');
    this.#report.deleteCompletedAt = now();
    this.#state = 'FCM_DELETED';
    this.#operation = null;
  }
  beginGeneration() {
    this.#sequence('FCM_DELETED');
    this.#state = 'GENERATING_FCM';
    this.#operation = Object.freeze({
      epoch: this.#epoch,
      id: crypto.randomUUID(),
      kind: 'generate',
    });
    this.#report.fcmRequestStartedAt = now();
    return this.#operation;
  }
  completeGeneration(operation, token) {
    this.#sequence('GENERATING_FCM');
    if (
      operation !== this.#operation ||
      operation.epoch !== this.#epoch ||
      typeof token !== 'string' ||
      !token.length
    )
      fail('STALE_FCM_TOKEN_ASSOCIATION', 'Stale or missing FCM token generation.');
    this.#token = token;
    this.#report.fcm = {
      sha256: digest(token),
      length: token.length,
      generatedAfterCorrectAssociation: true,
      generationCompletedAt: now(),
      generationTimestampMeaning: 'delete completed then fresh getToken request completed',
      epoch: this.#epoch,
    };
    this.#state = 'FCM_FRESH';
    this.#operation = null;
  }
  token() {
    if (!this.#token)
      fail('STALE_FCM_TOKEN_ASSOCIATION', 'No regenerated FCM token belongs to this attempt.');
    return this.#token;
  }
  beginT0(correlationId) {
    this.#sequence('FCM_FRESH');
    this.#state = 'T0_PENDING';
    this.#t0Authorized = false;
    this.#report.t0 = { status: 'PENDING', correlationId, startedAt: now() };
  }
  authorizeSend({ phase, token, correlationId }) {
    if (Date.now() >= this.#expiresAt || this.#state === 'CLOSED')
      fail('T0_GATE_EXPIRED', 'Qualification authorization has expired. Start a fresh attempt.');
    if (!this.#token || token !== this.#token)
      fail(
        'STALE_FCM_TOKEN_ASSOCIATION',
        'Sender token is not the regenerated token for this run.',
      );
    if (phase === 'T0') {
      if (
        this.#state !== 'T0_PENDING' ||
        this.#t0Authorized ||
        correlationId !== this.#report.t0.correlationId
      )
        fail(
          'T0_GATE_REQUIRED',
          'Only the current single T0 probe may be sent before qualification.',
        );
      this.#t0Authorized = true;
    } else if (phase !== 'FUNCTIONAL' || this.#state !== 'QUALIFIED' || !this.#qualified) {
      fail(
        'T0_GATE_REQUIRED',
        'A real successful T0 gate is required before functional scenarios.',
      );
    }
  }
  completeT0(result) {
    if (this.#state !== 'T0_PENDING' || !this.#t0Authorized)
      fail('T0_GATE_REQUIRED', 'T0 was not sent through the authorized sender.');
    if (!result.messageId)
      fail('FIREBASE_APNS_TRANSPORT_FAILURE', 'T0 did not receive an FCM message ID.');
    if (!result.received)
      fail(
        'DEVICE_DELIVERY_UNPROVEN',
        'FCM accepted T0, but matching device delivery was not proven.',
      );
    if (this.requireNse && (!result.nseExecuted || !result.contentProcessed))
      fail(
        'NSE_EXECUTION_UNPROVEN',
        'Installed NSE execution and processed content were not proven.',
      );
    this.#report.t0 = { ...this.#report.t0, ...result, status: 'PASS', completedAt: now() };
    this.#state = 'QUALIFIED';
    this.#qualified = true;
  }
  scenarios(names) {
    this.#report.scenarios = names.map(scenario => ({ scenario, status: 'NOT_RUN' }));
  }
  scenarioResult(index, result) {
    this.#sequence('QUALIFIED');
    this.#report.scenarios[index] = { ...this.#report.scenarios[index], ...result };
  }
  block(error) {
    this.#state = 'BLOCKED';
    this.#qualified = false;
    this.#report.blocker = classify(error);
    if (this.#report.t0.status === 'PENDING') this.#report.t0.status = 'BLOCKED';
  }
  evidence() {
    return redact({ ...this.#report, state: this.#state }, [this.#token]);
  }
  close() {
    this.#token = null;
    this.#qualified = false;
    this.#state = 'CLOSED';
  }
}

async function runMatrix({ session, send, observe, scenarios = [], correlationId }) {
  session.scenarios(scenarios);
  const invoke = async (scenario, phase, probeId) => {
    const token = session.token();
    const result = await send({
      scenario,
      token,
      correlationId: probeId,
      qualification: {
        phase,
        t0Probe: phase === 'T0',
        authorizeSend: () => session.authorizeSend({ phase, token, correlationId: probeId }),
      },
    });
    const observation = await observe({ ...result, scenario, phase, correlationId: probeId });
    return { ...observation, messageId: result.messageId };
  };
  try {
    const t0Id = `t0-${session.runId}`;
    session.beginT0(t0Id);
    session.completeT0(await invoke('minimal', 'T0', t0Id));
    for (let index = 0; index < scenarios.length; index++) {
      const result = await invoke(
        scenarios[index],
        'FUNCTIONAL',
        correlationId && scenarios.length === 1 ? correlationId : `f${index + 1}-${session.runId}`,
      );
      if (!result.received)
        fail(
          'DEVICE_DELIVERY_UNPROVEN',
          'Functional send accepted, but device delivery is unproven.',
        );
      if (session.requireNse && (!result.nseExecuted || !result.contentProcessed))
        fail('NSE_EXECUTION_UNPROVEN', 'Functional installed NSE delivery is unproven.');
      session.scenarioResult(index, { ...result, status: 'PASS', completedAt: now() });
    }
    return session.evidence();
  } catch (error) {
    session.block(error);
    throw error;
  }
}

function swiftString(value) {
  // Disable Swift interpolation even for caller-controlled callback configuration.
  if ([...String(value)].some(character => character.charCodeAt(0) < 32))
    fail(
      'QUALIFICATION_CONFIGURATION',
      'Control characters are not allowed in generated native configuration.',
    );
  return JSON.stringify(String(value));
}
function patchAppDelegate(source, { runId, callbackURL, callbackSecret, mode, expected }) {
  if (
    !['sandbox', 'production'].includes(expected) ||
    !['default', 'signed-entitlement'].includes(mode)
  )
    fail('QUALIFICATION_CONFIGURATION', 'Invalid generated association configuration.');
  if (
    (source.match(/FirebaseApp\.configure\(\)/g) ?? []).length !== 1 ||
    !source.includes('class AppDelegate: UIResponder, UIApplicationDelegate {')
  )
    fail(
      'QUALIFICATION_CONFIGURATION',
      'Smoke AppDelegate shape changed; refuse ambiguous driver generation.',
    );
  const manual = mode === 'signed-entitlement';
  const type = expected === 'sandbox' ? 'sandbox' : 'prod';
  const callback = `
  private var qualificationDeliveryTimer: Timer?
  private func qualificationPost(_ value: [String: Any], route: String = "/native") {
    guard let url = URL(string: ${swiftString(callbackURL)} + route) else { return }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(${swiftString('Bearer ' + callbackSecret)}, forHTTPHeaderField: "Authorization")
    request.httpBody = try? JSONSerialization.data(withJSONObject: value)
    URLSession.shared.dataTask(with: request).resume()
  }

  func applicationDidBecomeActive(_ application: UIApplication) {
    qualificationDeliveryTimer?.invalidate()
    qualificationDeliveryTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
      UNUserNotificationCenter.current().getDeliveredNotifications { notifications in
        let receipts: [[String: Any]] = notifications.compactMap { notification in
          guard let messageId = notification.request.content.userInfo["gcm.message_id"] as? String else { return nil }
          return ["messageId": messageId, "requestId": notification.request.identifier, "title": notification.request.content.title]
        }
        self?.qualificationPost(["runId": ${swiftString(runId)}, "timestamp": ISO8601DateFormatter().string(from: Date()), "notifications": receipts], route: "/delivery")
      }
    }
  }

  func applicationWillResignActive(_ application: UIApplication) {
    qualificationDeliveryTimer?.invalidate()
    qualificationDeliveryTimer = nil
  }

  func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    ${
      manual
        ? `guard Messaging.messaging().apnsToken == nil || qualificationAssociated else {
      qualificationPost(["runId": ${swiftString(runId)}, "errorCode": "INITIAL_APNS_ASSOCIATION_ALREADY_PRESENT"])
      return
    }
    if !qualificationAssociated {
      Messaging.messaging().setAPNSToken(deviceToken, type: .${type})
      qualificationAssociated = true
    } else if Messaging.messaging().apnsToken != deviceToken {
      qualificationPost(["runId": ${swiftString(runId)}, "errorCode": "APNS_IDENTITY_CHANGED"])
      return
    }`
        : '// RNFirebase interceptor performed its unchanged default association before this passive callback.'
    }
    guard Messaging.messaging().apnsToken == deviceToken else {
      qualificationPost(["runId": ${swiftString(runId)}, "errorCode": "APNS_TOKEN_UNAVAILABLE"])
      return
    }
    qualificationPost([
      "runId": ${swiftString(runId)}, "apnsPresent": true,
      "apnsBytes": deviceToken.count,
      "apnsSHA256": SHA256.hash(data: deviceToken).map { String(format: "%02x", $0) }.joined(),
      "environment": ${swiftString(expected)},
      "evidenceKind": ${swiftString(manual ? 'controlled-initial' : 'compiled-callback')},
      "initialAssociation": ${manual ? 'true' : 'false'},
      "timestamp": ISO8601DateFormatter().string(from: Date())
    ])
  }

  func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    qualificationPost(["runId": ${swiftString(runId)}, "errorCode": "APNS_TOKEN_UNAVAILABLE"])
  }
`;
  const patched = source
    .replace(
      'import FirebaseCore',
      'import FirebaseCore\nimport FirebaseMessaging\nimport CryptoKit',
    )
    .replace(
      'class AppDelegate: UIResponder, UIApplicationDelegate {',
      `class AppDelegate: UIResponder, UIApplicationDelegate {\n  private var qualificationAssociated = false\n${callback}`,
    )
    .replace(
      'FirebaseApp.configure()',
      `FirebaseApp.configure()\n    Messaging.messaging().isAutoInitEnabled = false${manual ? '\n    application.registerForRemoteNotifications()' : ''}`,
    )
    .replace(
      /#if DEBUG\s*RCTBundleURLProvider[\s\S]*?#endif/,
      '    Bundle.main.url(forResource: "main", withExtension: "jsbundle")',
    );
  return patched;
}

module.exports = {
  QualificationError,
  fail,
  now,
  digest,
  expectedEnvironment,
  automaticEnvironment,
  checkEnvironment,
  redact,
  classify,
  QualificationSession,
  runMatrix,
  patchAppDelegate,
};
