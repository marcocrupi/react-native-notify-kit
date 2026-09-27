import { buildNotifyKitPayload } from '../buildPayload';
import type { NotifyKitPayloadInput } from '../types';
import { parseAndroidPayload } from './helpers/fakeAndroidHandler';

// Freeze Date.now for deterministic TTL/expiration
const realNow = Date.now;
beforeAll(() => {
  Date.now = () => 1_700_000_000_000;
});
afterAll(() => {
  Date.now = realNow;
});

// ---------------------------------------------------------------------------
// Fixtures (same 5 as invariants.test.ts)
// ---------------------------------------------------------------------------

const fixtures: Record<string, NotifyKitPayloadInput> = {
  minimal: {
    token: 'device-token-abc',
    notification: { title: 'Hello', body: 'World' },
  },
  marketing: {
    topic: 'promo-summer',
    notification: {
      id: 'campaign-42',
      title: 'Summer Sale!',
      body: '50% off everything',
      data: { deepLink: '/promo/42', segment: 'vip' },
    },
    options: { ttl: 86400, collapseKey: 'promo' },
  },
  transactional: {
    token: 'device-token-xyz',
    notification: {
      id: 'order-99',
      title: 'Order shipped',
      body: 'Your order #99 is on the way',
      data: { orderId: '99' },
      android: {
        channelId: 'orders',
        smallIcon: 'ic_notification',
        color: '#0066FF',
        pressAction: { id: 'open-order', launchActivity: 'default' },
        actions: [
          { title: 'Track', pressAction: { id: 'track' } },
          { title: 'Reply', pressAction: { id: 'reply' }, input: true },
        ],
        style: { type: 'BIG_TEXT' as const, text: 'Order #99 shipped from warehouse A' },
      },
      ios: {
        sound: 'chime.caf',
        categoryId: 'order-updates',
        threadId: 'orders',
        interruptionLevel: 'timeSensitive' as const,
        attachments: [{ url: 'https://cdn.example.com/map.png', identifier: 'map' }],
      },
    },
    options: { androidPriority: 'high', iosBadgeCount: 3, ttl: 3600 },
  },
  tinyPayload: {
    token: 'tok',
    notification: { title: 'x', body: 'y' },
  },
  kitchenSink: {
    token: 'device-token',
    notification: {
      id: 'order-42',
      title: 'Your order is ready',
      body: 'Tap to see details',
      data: { orderId: '42', customer: 'acme' },
      android: {
        channelId: 'orders',
        smallIcon: 'ic_notification',
        largeIcon: 'https://cdn.example.com/logo.png',
        color: '#FF0000',
        pressAction: { id: 'open-order', launchActivity: 'default' },
        actions: [
          { title: 'Reply', pressAction: { id: 'reply' }, input: true },
          { title: 'Mark done', pressAction: { id: 'done' } },
        ],
        style: { type: 'BIG_TEXT' as const, text: 'Order #42 has shipped from warehouse' },
      },
      ios: {
        sound: 'chime.caf',
        categoryId: 'order-updates',
        threadId: 'orders',
        interruptionLevel: 'timeSensitive' as const,
        attachments: [{ url: 'https://cdn.example.com/map.png', identifier: 'map' }],
      },
    },
    options: {
      androidPriority: 'high',
      iosBadgeCount: 3,
      ttl: 3600,
      collapseKey: 'order-42-override',
    },
  },
};

// ---------------------------------------------------------------------------
// Check 3 — iOS APNs wire fields. The native helper harness consumes
// Server SDK-checked APNs fixtures to verify delivered NSE content.
// ---------------------------------------------------------------------------

describe('Check 3 — iOS APNs wire fields', () => {
  for (const [name, input] of Object.entries(fixtures)) {
    it(`Fixture "${name}": APNs carries title, body, and optional data`, () => {
      const output = buildNotifyKitPayload(input);
      const apnsPayload = output.apns.payload;

      expect(apnsPayload.aps.alert.title).toBe(input.notification.title);
      expect(apnsPayload.aps.alert.body).toBe(input.notification.body);

      if (input.notification.data) {
        expect(JSON.parse(apnsPayload.notifee_data as string)).toEqual(input.notification.data);
      } else {
        expect(apnsPayload.notifee_data).toBeUndefined();
      }
    });

    if (input.notification.ios) {
      it(`Fixture "${name}": APNs and notifee_options carry iOS config`, () => {
        const output = buildNotifyKitPayload(input);
        const apnsPayload = output.apns.payload;
        const serializedOptions = JSON.parse(apnsPayload.notifee_options);
        const iosInput = input.notification.ios!;

        expect(serializedOptions.ios).toEqual(iosInput);
        if (iosInput.sound) expect(apnsPayload.aps.sound).toBe(iosInput.sound);
        if (iosInput.categoryId) expect(apnsPayload.aps.category).toBe(iosInput.categoryId);
        if (iosInput.threadId) expect(apnsPayload.aps['thread-id']).toBe(iosInput.threadId);
        if (iosInput.attachments)
          expect(serializedOptions.ios.attachments).toEqual(iosInput.attachments);
      });
    }

    if (input.options?.iosBadgeCount !== undefined) {
      it(`Fixture "${name}": APNs carries badge count`, () => {
        const output = buildNotifyKitPayload(input);
        expect(output.apns.payload.aps.badge).toBe(input.options!.iosBadgeCount);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Check 3 — Android handler round-trip
// ---------------------------------------------------------------------------

describe('Check 3 — Android handler round-trip', () => {
  for (const [name, input] of Object.entries(fixtures)) {
    it(`Fixture "${name}": Android reconstructs notification.data correctly`, () => {
      const output = buildNotifyKitPayload(input);
      const reconstructed = parseAndroidPayload(output);

      // User data keys should be recoverable from top-level data
      if (input.notification.data) {
        expect(reconstructed.data).toEqual(input.notification.data);
      } else {
        expect(reconstructed.data).toEqual({});
      }
    });

    if (input.notification.android) {
      it(`Fixture "${name}": Android reconstructs android config from notifee_options`, () => {
        const output = buildNotifyKitPayload(input);
        const reconstructed = parseAndroidPayload(output);
        expect(reconstructed.android).toEqual(input.notification.android);
      });
    }

    it(`Fixture "${name}": Android reconstructs title/body from notifee_options`, () => {
      const output = buildNotifyKitPayload(input);
      const reconstructed = parseAndroidPayload(output);

      expect(reconstructed.title).toBe(input.notification.title);
      expect(reconstructed.body).toBe(input.notification.body);
    });
  }
});
