/**
 * Manual FCM test helper - sends a push notification to a device using
 * the NotifyKit server SDK + Firebase Admin.
 *
 * Usage:
 *   yarn send:test:fcm <device-token> <scenario>
 *   node scripts/send-test-fcm.js <device-token> <scenario>
 *   IOS_FCM_TOKEN=<device-token> node scripts/send-test-fcm.js <scenario>
 *   ANDROID_FCM_TOKEN=<device-token> node scripts/send-test-fcm.js android-expo-smoke
 *
 * Scenarios: minimal | kitchen-sink | emoji | marketing | ios-attachment | android-big-picture | android-expo-smoke
 *
 * Prerequisites:
 *   - Run `yarn install` from the repo root
 *   - Service account key at ./firebase-notifykittest.json
 *   - Server SDK built at packages/react-native/server/dist
 *
 * This file is NOT part of the automated test suite. It's a developer
 * tool for manual hardware E2E testing per docs/f4-hardware-e2e.md.
 */

const path = require('path');

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, '..', 'firebase-notifykittest.json');
const IOS_TOKEN_ENV_KEYS = ['IOS_FCM_TOKEN', 'FCM_TOKEN'];
const ANDROID_TOKEN_ENV_KEYS = ['ANDROID_FCM_TOKEN', 'FCM_TOKEN'];
const DEFAULT_TOKEN_ENV_KEYS = ['IOS_FCM_TOKEN', 'ANDROID_FCM_TOKEN', 'FCM_TOKEN'];

function loadFirebaseAdmin() {
  try {
    const { cert, getApps, initializeApp } = require('firebase-admin/app');
    const { getMessaging } = require('firebase-admin/messaging');

    return { cert, getApps, getMessaging, initializeApp };
  } catch {
    throw new Error('Missing dependency `firebase-admin`. Run `yarn install` from the repo root.');
  }
}

function loadBuildNotifyKitPayload() {
  try {
    return require('../packages/react-native/server/dist/index').buildNotifyKitPayload;
  } catch {
    throw new Error(
      'Could not load NotifyKit server SDK from packages/react-native/server/dist. Run `yarn build:rn:server`.',
    );
  }
}

const SCENARIOS = {
  minimal: {
    token: '',
    notification: { title: 'Hello from NotifyKit', body: 'Minimal test notification' },
  },
  'kitchen-sink': {
    token: '',
    notification: {
      id: 'test-order-42',
      title: 'Your order is ready',
      body: 'Tap to see details',
      data: { orderId: '42', source: 'send-test-fcm' },
      android: {
        channelId: 'default',
        smallIcon: 'ic_launcher',
        pressAction: { id: 'open-order' },
        style: { type: 'BIG_TEXT', text: 'Order #42 has shipped from warehouse A.' },
        actions: [
          { title: 'Track', pressAction: { id: 'track' } },
          { title: 'Reply', pressAction: { id: 'reply' }, input: true },
        ],
      },
      ios: {
        sound: 'default',
        categoryId: 'order-updates',
        threadId: 'orders',
        interruptionLevel: 'timeSensitive',
      },
    },
    options: {
      androidPriority: 'high',
      iosBadgeCount: 1,
      ttl: 3600,
    },
  },
  emoji: {
    token: '',
    notification: {
      title: '🚀 Launch!',
      body: '🎉 Celebration time',
      android: { channelId: 'default' },
      ios: { sound: 'default' },
    },
  },
  marketing: {
    token: '',
    notification: {
      id: 'promo-summer',
      title: 'Summer Sale!',
      body: '50% off everything - tap to shop',
      data: { deepLink: '/promo/summer', segment: 'vip' },
      android: { channelId: 'default' },
      ios: { sound: 'default', interruptionLevel: 'active' },
    },
    options: { ttl: 86400, collapseKey: 'promo-summer' },
  },
  'ios-attachment': {
    token: '',
    notification: {
      id: 'ios-attachment-test',
      title: 'Attachment Test',
      body: 'This notification should show an image attachment on iOS',
      data: { source: 'send-test-fcm', testCase: 'ios-attachment' },
      android: {
        channelId: 'default',
        smallIcon: 'ic_launcher',
      },
      ios: {
        sound: 'default',
        threadId: 'attachments',
        attachments: [
          {
            url: 'https://www.gstatic.com/webp/gallery/1.jpg',
            identifier: 'sample-image',
          },
        ],
      },
    },
    options: {
      androidPriority: 'high',
      ttl: 3600,
    },
  },
  'android-big-picture': {
    token: '',
    notification: {
      id: 'android-big-picture-test',
      title: 'Big Picture Test',
      body: 'Expand this notification to see the image',
      data: { source: 'send-test-fcm', testCase: 'android-big-picture' },
      android: {
        channelId: 'default',
        smallIcon: 'ic_launcher',
        style: {
          type: 'BIG_PICTURE',
          picture: 'https://www.gstatic.com/webp/gallery/1.jpg',
        },
      },
    },
    options: {
      androidPriority: 'high',
      ttl: 3600,
    },
  },
  'android-expo-smoke': {
    token: '',
    notification: {
      id: 'android-expo-smoke-test',
      title: 'Android Expo Smoke',
      body: 'NotifyKit Android Expo FCM data-only smoke',
      data: { source: 'send-test-fcm', scenario: 'android-expo-smoke' },
      android: {
        channelId: 'expo-smoke-default',
        pressAction: { id: 'default', launchActivity: 'default' },
      },
    },
    options: {
      androidPriority: 'high',
      ttl: 3600,
    },
  },
};

function printUsage(stream = process.stdout) {
  stream.write(
    [
      'Usage: yarn send:test:fcm <device-token> <scenario> [--correlation-id <id>]',
      '   or: node scripts/send-test-fcm.js <device-token> <scenario> [--correlation-id <id>]',
      '   or: IOS_FCM_TOKEN=<device-token> node scripts/send-test-fcm.js <scenario> [--correlation-id <id>]',
      '   or: ANDROID_FCM_TOKEN=<device-token> node scripts/send-test-fcm.js android-expo-smoke [--correlation-id <id>]',
      'Scenarios: ' + Object.keys(SCENARIOS).join(', '),
      'Token fallback env: IOS_FCM_TOKEN, ANDROID_FCM_TOKEN, FCM_TOKEN',
      'Correlation fallback env: SMOKE_CORRELATION_ID',
    ].join('\n') + '\n',
  );
}

function tokenEnvKeysForScenario(scenario) {
  if (scenario === 'android-expo-smoke' || scenario === 'android-big-picture') {
    return ANDROID_TOKEN_ENV_KEYS;
  }

  return IOS_TOKEN_ENV_KEYS;
}

function envToken(env, keys = DEFAULT_TOKEN_ENV_KEYS) {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return '';
}

function hasScenario(scenario) {
  return Object.prototype.hasOwnProperty.call(SCENARIOS, scenario);
}

function parseArgs(argv, env) {
  const parsed = {
    correlationId: '',
    error: '',
    help: false,
    scenario: '',
    token: '',
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '-h' || arg === '--help') {
      parsed.help = true;
      return parsed;
    }

    if (arg === '--correlation-id') {
      const value = argv[index + 1];
      if (typeof value !== 'string' || value.length === 0) {
        parsed.error = 'Missing value for --correlation-id.';
        return parsed;
      }
      parsed.correlationId = value;
      index += 1;
      continue;
    }

    const correlationPrefix = '--correlation-id=';
    if (arg.startsWith(correlationPrefix)) {
      const value = arg.slice(correlationPrefix.length);
      if (value.length === 0) {
        parsed.error = 'Missing value for --correlation-id.';
        return parsed;
      }
      parsed.correlationId = value;
      continue;
    }

    if (arg.startsWith('--')) {
      parsed.error = `Unknown option: ${arg}`;
      return parsed;
    }

    positional.push(arg);
  }

  if (positional.length > 2) {
    parsed.error = `Unexpected argument: ${positional[2]}`;
    return parsed;
  }

  const fallbackToken = envToken(env);
  if (positional.length === 2) {
    parsed.token = positional[0];
    parsed.scenario = positional[1];
  } else if (positional.length === 1 && hasScenario(positional[0])) {
    parsed.scenario = positional[0];
    parsed.token = envToken(env, tokenEnvKeysForScenario(parsed.scenario));
  } else if (positional.length === 1) {
    parsed.token = positional[0];
  } else {
    parsed.token = fallbackToken;
  }

  if (parsed.correlationId.length === 0 && typeof env.SMOKE_CORRELATION_ID === 'string') {
    parsed.correlationId = env.SMOKE_CORRELATION_ID;
  }

  return parsed;
}

function smokeNotificationIdFor(correlationId) {
  return correlationId.startsWith('smoke-') ? correlationId : `smoke-${correlationId}`;
}

const CORRELATABLE_SCENARIO_TEXT = {
  minimal: {
    title: correlationId => `NotifyKit Smoke minimal ${correlationId}`,
    body: correlationId => `Smoke FCM minimal ${correlationId}`,
  },
  'ios-attachment': {
    title: correlationId => `NotifyKit Smoke attachment ${correlationId}`,
    body: correlationId => `Smoke FCM iOS attachment ${correlationId}`,
  },
  'android-expo-smoke': {
    title: correlationId => `Android Expo Smoke ${correlationId}`,
    body: correlationId => `Android Expo FCM data-only ${correlationId}`,
  },
};

function scenarioConfigFor(scenario, correlationId) {
  const config = SCENARIOS[scenario];
  const text = CORRELATABLE_SCENARIO_TEXT[scenario];
  if (!text || correlationId.length === 0) {
    return config;
  }

  const smokeNotificationId = smokeNotificationIdFor(correlationId);

  return {
    ...config,
    notification: {
      ...config.notification,
      id: smokeNotificationId,
      title: text.title(correlationId),
      body: text.body(correlationId),
      data: {
        ...(config.notification.data ?? {}),
        correlationId,
        smokeNotificationId,
      },
    },
  };
}

// The ordinary CLI and the iOS qualification controller share this one pipeline.
// Qualification adds an authorization boundary, not another Firebase sender.
async function sendScenario(
  { token, scenario, correlationId = '', qualification, serviceAccountPath = SERVICE_ACCOUNT_PATH },
  dependencies = {},
) {
  if (!token || !hasScenario(scenario))
    throw new Error('A token and a supported scenario are required.');
  if (qualification && typeof qualification.authorizeSend !== 'function')
    throw new Error('Qualification requires a live sender authorization callback.');
  if (
    qualification &&
    ((qualification.phase === 'T0' &&
      (qualification.t0Probe !== true || scenario !== 'minimal' || !correlationId)) ||
      (qualification.t0Probe && qualification.phase !== 'T0'))
  )
    throw new Error('T0 may only use a correlated minimal probe.');
  if (qualification && !['T0', 'FUNCTIONAL'].includes(qualification.phase))
    throw new Error('Unsupported qualification phase.');
  const admin = dependencies.admin ?? loadFirebaseAdmin();
  const buildNotifyKitPayload = dependencies.buildNotifyKitPayload ?? loadBuildNotifyKitPayload();
  let serviceAccount;
  try {
    serviceAccount = dependencies.serviceAccount ?? require(serviceAccountPath);
  } catch {
    throw new Error('Could not load the configured Firebase service account.');
  }
  if (admin.getApps().length === 0) admin.initializeApp({ credential: admin.cert(serviceAccount) });
  let scenarioConfig = scenarioConfigFor(scenario, correlationId);
  if (qualification) {
    if (!correlationId) throw new Error('Qualification requires a unique correlation ID.');
    scenarioConfig = {
      ...scenarioConfig,
      notification: {
        ...scenarioConfig.notification,
        id: smokeNotificationIdFor(correlationId),
        data: {
          ...scenarioConfig.notification.data,
          correlationId,
          smokeNotificationId: smokeNotificationIdFor(correlationId),
        },
      },
    };
  }
  const payload = buildNotifyKitPayload({ ...scenarioConfig, token });
  if (qualification?.t0Probe) {
    // Ordinary supported title reconstruction proves the real installed NSE ran.
    // Keep payload construction in the existing SDK path; change only the probe's raw title.
    payload.apns.payload.aps.alert.title = `NotifyKit T0 RAW ${correlationId}`;
  }
  if (qualification) {
    qualification.log?.({ scenario, correlationId, payloadSizeBytes: payload.sizeBytes });
  } else {
    console.log('Sending FCM message:');
    console.log('  Token:', token.substring(0, 20) + '...');
    console.log('  Scenario:', scenario);
    if (correlationId.length > 0) console.log('  Correlation ID:', correlationId);
    console.log('  Payload size:', payload.sizeBytes, 'bytes');
  }
  // This check must remain synchronous and adjacent to the sole transport side effect.
  const authorization = qualification?.authorizeSend();
  if (authorization && typeof authorization.then === 'function')
    throw new Error('Sender authorization must be synchronous.');
  const messageId = await admin.getMessaging().send(payload);
  return {
    messageId,
    scenario,
    correlationId,
    notificationId: scenarioConfig.notification.id,
    expectedTitle: scenarioConfig.notification.title,
    rawTitle: payload.apns?.payload?.aps?.alert?.title,
    payloadSizeBytes: payload.sizeBytes,
    ...(qualification ? { payload: { ...payload, token: '<redacted-fcm-token>' } } : {}),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), process.env);

  if (args.help) {
    printUsage();
    return;
  }

  if (args.error) {
    console.error(args.error);
    printUsage(process.stderr);
    process.exit(1);
  }

  const { correlationId, scenario, token } = args;

  if (!token) {
    console.error(
      'Missing FCM device token. Provide <device-token>, IOS_FCM_TOKEN, ANDROID_FCM_TOKEN, or FCM_TOKEN.',
    );
    printUsage(process.stderr);
    process.exit(1);
  }

  if (!scenario) {
    console.error('Missing scenario.');
    printUsage(process.stderr);
    process.exit(1);
  }

  if (!hasScenario(scenario)) {
    console.error(`Unknown scenario: ${scenario}`);
    printUsage(process.stderr);
    process.exit(1);
  }

  try {
    const { messageId } = await sendScenario({ token, scenario, correlationId });
    console.log('Successfully sent. Message ID:', messageId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Send failed:', message);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(err => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Unexpected failure:', message);
    process.exit(1);
  });
}

module.exports = { sendScenario, parseArgs, scenarioConfigFor };
