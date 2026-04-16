import { buildNotifyKitPayload } from '../buildPayload';
import type { NotifyKitPayloadInput, NotifyKitPayloadOutput } from '../types';

// ---------------------------------------------------------------------------
// Fixtures (reused across Check 1 and Check 2)
// ---------------------------------------------------------------------------

const FIXTURES: Record<string, NotifyKitPayloadInput> = {
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
    options: {
      androidPriority: 'high',
      iosBadgeCount: 3,
      ttl: 3600,
    },
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

function buildAll(): Record<string, NotifyKitPayloadOutput> {
  const realNow = Date.now;
  Date.now = () => 1_700_000_000_000;
  try {
    const result: Record<string, NotifyKitPayloadOutput> = {};
    for (const [name, input] of Object.entries(FIXTURES)) {
      result[name] = buildNotifyKitPayload(input);
    }
    return result;
  } finally {
    Date.now = realNow;
  }
}

// ---------------------------------------------------------------------------
// Check 1 — Byte-exact notifee_options equality
// ---------------------------------------------------------------------------

describe('Check 1 — notifee_options byte-identical on both paths', () => {
  const outputs = buildAll();

  for (const [name, output] of Object.entries(outputs)) {
    it(`${name}: data.notifee_options === apns.payload.notifee_options (reference or string equality)`, () => {
      const android = output.data.notifee_options;
      const ios = output.apns.payload.notifee_options;
      // String equality
      expect(android).toBe(ios);
      // Byte-length parity (catches any encoding divergence)
      expect(Buffer.byteLength(android as string, 'utf8')).toBe(Buffer.byteLength(ios, 'utf8'));
    });
  }

  it('emoji-heavy payload: notifee_options identical despite multi-byte chars', () => {
    const emojiInput: NotifyKitPayloadInput = {
      token: 't',
      notification: {
        title: '🚀',
        body: '🎉',
        android: { channelId: '🏁-channel-🏁', color: '#FF0000' },
        ios: { sound: 'default', categoryId: 'café-Ω-🍕' },
      },
    };
    const out = buildNotifyKitPayload(emojiInput);
    expect(out.data.notifee_options).toBe(out.apns.payload.notifee_options);
    expect(Buffer.byteLength(out.data.notifee_options as string, 'utf8')).toBe(
      Buffer.byteLength(out.apns.payload.notifee_options, 'utf8'),
    );
  });

  it('when notifee_data is present on iOS, it matches the serialized notification.data', () => {
    const out = outputs.kitchenSink;
    // notifee_data only exists on iOS (APNs payload), not on Android data
    expect(out.apns.payload.notifee_data).toBeDefined();
    const parsed = JSON.parse(out.apns.payload.notifee_data as string);
    expect(parsed).toEqual(FIXTURES.kitchenSink.notification.data);
  });

  for (const [name, output] of Object.entries(outputs)) {
    it(`${name}: notifee_options contains title and body matching input`, () => {
      const parsed = JSON.parse(output.data.notifee_options as string);
      expect(parsed.title).toBe(FIXTURES[name]!.notification.title);
      expect(parsed.body).toBe(FIXTURES[name]!.notification.body);
    });
  }
});

// ---------------------------------------------------------------------------
// Check 2 — FCM v1 schema conformance
// ---------------------------------------------------------------------------

const VALID_INTERRUPTION_LEVELS = ['passive', 'active', 'time-sensitive', 'critical'];

function assertFcmV1Conformance(output: NotifyKitPayloadOutput, _label: string): void {
  // Routing: exactly one of token/topic/condition
  const routingKeys = ['token', 'topic', 'condition'].filter(
    k => (output as Record<string, unknown>)[k] !== undefined,
  );
  expect(routingKeys).toHaveLength(1);

  // data: Record<string, string>
  expect(typeof output.data).toBe('object');
  for (const [key, value] of Object.entries(output.data)) {
    expect(typeof value).toBe('string');
    // data keys must not be empty strings
    expect(key.length).toBeGreaterThan(0);
  }

  // android
  expect(['HIGH', 'NORMAL']).toContain(output.android.priority);
  expect('notification' in output.android).toBe(false);
  if (output.android.ttl !== undefined) {
    expect(output.android.ttl).toMatch(/^\d+s$/);
  }
  if (output.android.collapse_key !== undefined) {
    expect(typeof output.android.collapse_key).toBe('string');
  }

  // apns.headers
  expect(output.apns.headers['apns-push-type']).toBe('alert');
  expect(output.apns.headers['apns-priority']).toBe('10');
  if (output.apns.headers['apns-collapse-id'] !== undefined) {
    expect(typeof output.apns.headers['apns-collapse-id']).toBe('string');
  }
  if (output.apns.headers['apns-expiration'] !== undefined) {
    expect(output.apns.headers['apns-expiration']).toMatch(/^\d+$/);
  }

  // apns.payload.aps
  const { aps } = output.apns.payload;
  expect(aps['mutable-content']).toBe(1);
  expect(typeof aps.alert.title).toBe('string');
  expect(aps.alert.title.length).toBeGreaterThan(0);
  expect(typeof aps.alert.body).toBe('string');
  expect(aps.alert.body.length).toBeGreaterThan(0);

  if (aps.badge !== undefined) {
    expect(Number.isInteger(aps.badge)).toBe(true);
    expect(aps.badge).toBeGreaterThanOrEqual(0);
  }
  if (aps.sound !== undefined) {
    expect(typeof aps.sound).toBe('string');
  }
  if (aps['interruption-level'] !== undefined) {
    expect(VALID_INTERRUPTION_LEVELS).toContain(aps['interruption-level']);
  }
  if (aps['thread-id'] !== undefined) {
    expect(typeof aps['thread-id']).toBe('string');
  }
  if (aps.category !== undefined) {
    expect(typeof aps.category).toBe('string');
  }

  // sizeBytes is non-enumerable, so it should NOT appear in JSON
  expect(JSON.stringify(output)).not.toContain('sizeBytes');
  // But it's still readable as metadata
  expect(typeof output.sizeBytes).toBe('number');
  expect(output.sizeBytes).toBeGreaterThan(0);
}

describe('Check 2 — FCM v1 schema conformance', () => {
  const outputs = buildAll();

  for (const [name, output] of Object.entries(outputs)) {
    it(`Fixture "${name}" passes FCM v1 conformance`, () => {
      assertFcmV1Conformance(output, name);
    });
  }
});
