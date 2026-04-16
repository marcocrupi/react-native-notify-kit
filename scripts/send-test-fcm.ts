/**
 * Manual FCM test helper — sends a push notification to a device using
 * the NotifyKit server SDK + Firebase Admin.
 *
 * Usage:
 *   ts-node scripts/send-test-fcm.ts <device-token> <scenario>
 *
 * Scenarios: minimal | kitchen-sink | emoji | marketing
 *
 * Prerequisites:
 *   - Service account key at ~/.firebase-notifykittest.json
 *   - firebase-admin installed: npm install firebase-admin
 *   - ts-node installed: npm install -g ts-node
 *
 * This file is NOT part of the automated test suite. It's a developer
 * tool for manual hardware E2E testing per docs/f4-hardware-e2e.md.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const admin = require('firebase-admin');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require('os');

// Import the server SDK
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildNotifyKitPayload } = require('./packages/react-native/server/dist/index');

const SERVICE_ACCOUNT_PATH = path.join(os.homedir(), '.firebase-notifykittest.json');

const SCENARIOS: Record<string, Parameters<typeof buildNotifyKitPayload>[0]> = {
  minimal: {
    token: '', // filled from argv
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
        style: { type: 'BIG_TEXT' as const, text: 'Order #42 has shipped from warehouse A.' },
        actions: [
          { title: 'Track', pressAction: { id: 'track' } },
          { title: 'Reply', pressAction: { id: 'reply' }, input: true },
        ],
      },
      ios: {
        sound: 'default',
        categoryId: 'order-updates',
        threadId: 'orders',
        interruptionLevel: 'timeSensitive' as const,
      },
    },
    options: {
      androidPriority: 'high' as const,
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
      body: '50% off everything — tap to shop',
      data: { deepLink: '/promo/summer', segment: 'vip' },
      android: { channelId: 'default' },
      ios: { sound: 'default', interruptionLevel: 'active' as const },
    },
    options: { ttl: 86400, collapseKey: 'promo-summer' },
  },
};

async function main() {
  const [, , token, scenario] = process.argv;

  if (!token || !scenario || !SCENARIOS[scenario]) {
    console.error('Usage: ts-node scripts/send-test-fcm.ts <device-token> <scenario>');
    console.error('Scenarios:', Object.keys(SCENARIOS).join(', '));
    process.exit(1);
  }

  // Initialize Firebase Admin
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const serviceAccount = require(SERVICE_ACCOUNT_PATH);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch {
    console.error(`Could not load service account from ${SERVICE_ACCOUNT_PATH}`);
    console.error('Download from Firebase Console → Project Settings → Service Accounts');
    process.exit(1);
  }

  // Build the payload
  const input = { ...SCENARIOS[scenario], token };
  const payload = buildNotifyKitPayload(input);

  console.log('Sending FCM message:');
  console.log('  Token:', token.substring(0, 20) + '...');
  console.log('  Scenario:', scenario);
  console.log('  Payload size:', payload.sizeBytes, 'bytes');

  // Send via Firebase Admin
  try {
    const messageId = await admin.messaging().send(payload);
    console.log('✓ Sent successfully. Message ID:', messageId);
  } catch (err: unknown) {
    console.error('✗ Send failed:', (err as Error).message);
    process.exit(1);
  }
}

main();
