/**
 * Manual FCM test helper — sends a push notification to a device using
 * the NotifyKit server SDK + Firebase Admin.
 *
 * Usage:
 *   yarn send:test:fcm <device-token> <scenario>
 *   node scripts/send-test-fcm.js <device-token> <scenario>
 *
 * Scenarios: minimal | kitchen-sink | emoji | marketing
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

const admin = loadFirebaseAdmin();
const buildNotifyKitPayload = loadBuildNotifyKitPayload();

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
        smallIcon: 'ic_notification',
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
};

async function main() {
  const [, , token, scenario] = process.argv;

  if (!token || !scenario || !SCENARIOS[scenario]) {
    console.error('Usage: yarn send:test:fcm <device-token> <scenario>');
    console.error('   or: node scripts/send-test-fcm.js <device-token> <scenario>');
    console.error('Scenarios:', Object.keys(SCENARIOS).join(', '));
    process.exit(1);
  }

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

  const payload = buildNotifyKitPayload({ ...SCENARIOS[scenario], token });

  console.log('Sending FCM message:');
  console.log('  Token:', token.substring(0, 20) + '...');
  console.log('  Scenario:', scenario);
  console.log('  Payload size:', payload.sizeBytes, 'bytes');

  try {
    const messageId = await admin.messaging().send(payload);
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
