/**
 * Manual FCM test helper — sends a push notification to a device using
 * the NotifyKit server SDK + Firebase Admin.
 *
 * Usage:
 *   yarn send:test:fcm <device-token> <scenario>
 *   node scripts/send-test-fcm.js <device-token> <scenario>
 *   IOS_FCM_TOKEN=<device-token> node scripts/send-test-fcm.js <scenario>
 *
 * Scenarios: minimal | kitchen-sink | emoji | marketing | ios-attachment | android-big-picture
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
const TOKEN_ENV_KEYS = ['IOS_FCM_TOKEN', 'FCM_TOKEN'];

function loadFirebaseAdmin() {
  try {
    return require('firebase-admin');
  } catch {
    console.error('Missing dependency `firebase-admin`.');
    console.error('Run `yarn install` from the repo root, then retry.');
    process.exit(1);
  }
}

function loadBuildNotifyKitPayload() {
  try {
    return require('../packages/react-native/server/dist/index').buildNotifyKitPayload;
  } catch {
    console.error('Could not load NotifyKit server SDK from packages/react-native/server/dist.');
    console.error('Run `yarn build:rn:server` from the repo root, then retry.');
    process.exit(1);
  }
}

function normalizePayloadForFirebaseAdmin(payload) {
  const normalized = { ...payload };

  if (payload.android !== undefined) {
    normalized.android = { ...payload.android };

    // The local server SDK currently emits Android TTL as an FCM wire-format
    // string (e.g. "3600s"), while firebase-admin validates input before
    // transport and expects a millisecond number here.
    if (typeof normalized.android.ttl === 'string') {
      const match = normalized.android.ttl.match(/^(\d+)s$/);
      if (match) {
        normalized.android.ttl = Number.parseInt(match[1], 10) * 1000;
      }
    }
  }

  return normalized;
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
};

function printUsage(stream = process.stdout) {
  stream.write(
    [
      'Usage: yarn send:test:fcm <device-token> <scenario> [--correlation-id <id>]',
      '   or: node scripts/send-test-fcm.js <device-token> <scenario> [--correlation-id <id>]',
      '   or: IOS_FCM_TOKEN=<device-token> node scripts/send-test-fcm.js <scenario> [--correlation-id <id>]',
      'Scenarios: ' + Object.keys(SCENARIOS).join(', '),
      'Token fallback env: IOS_FCM_TOKEN, FCM_TOKEN',
      'Correlation fallback env: SMOKE_CORRELATION_ID',
    ].join('\n') + '\n',
  );
}

function envToken(env) {
  for (const key of TOKEN_ENV_KEYS) {
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
    parsed.token = fallbackToken;
    parsed.scenario = positional[0];
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

function scenarioConfigFor(scenario, correlationId) {
  const config = SCENARIOS[scenario];
  if (scenario !== 'minimal' || correlationId.length === 0) {
    return config;
  }

  const smokeNotificationId = smokeNotificationIdFor(correlationId);

  return {
    ...config,
    notification: {
      ...config.notification,
      id: smokeNotificationId,
      title: `NotifyKit Smoke minimal ${correlationId}`,
      body: `Smoke FCM minimal ${correlationId}`,
      data: {
        ...(config.notification.data ?? {}),
        correlationId,
        smokeNotificationId,
      },
    },
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
    console.error('Missing FCM device token. Provide <device-token>, IOS_FCM_TOKEN, or FCM_TOKEN.');
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

  const admin = loadFirebaseAdmin();
  const buildNotifyKitPayload = loadBuildNotifyKitPayload();

  try {
    const serviceAccount = require(SERVICE_ACCOUNT_PATH);

    if (admin.apps.length === 0) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
  } catch {
    console.error(`Could not load service account from ${SERVICE_ACCOUNT_PATH}`);
    console.error('Download it from Firebase Console -> Project Settings -> Service Accounts.');
    console.error('Save it as firebase-notifykittest.json in the repo root.');
    process.exit(1);
  }

  const scenarioConfig = scenarioConfigFor(scenario, correlationId);
  const payload = buildNotifyKitPayload({ ...scenarioConfig, token });
  const sendPayload = normalizePayloadForFirebaseAdmin(payload);

  console.log('Sending FCM message:');
  console.log('  Token:', token.substring(0, 20) + '...');
  console.log('  Scenario:', scenario);
  if (correlationId.length > 0) {
    console.log('  Correlation ID:', correlationId);
  }
  console.log('  Payload size:', payload.sizeBytes, 'bytes');

  try {
    const messageId = await admin.messaging().send(sendPayload);
    console.log('Successfully sent. Message ID:', messageId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Send failed:', message);
    process.exit(1);
  }
}

main().catch(err => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('Unexpected failure:', message);
  process.exit(1);
});
