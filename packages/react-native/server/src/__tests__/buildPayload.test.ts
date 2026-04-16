import { buildNotifyKitPayload } from '../buildPayload';
import type { NotifyKitPayloadInput } from '../types';

describe('buildNotifyKitPayload — smoke', () => {
  it('builds a valid output from minimal input', () => {
    const out = buildNotifyKitPayload({
      token: 'abc',
      notification: { title: 'Hi', body: 'There' },
    });
    expect(out.token).toBe('abc');
    expect(out.android.priority).toBe('HIGH');
    expect(out.apns.headers['apns-push-type']).toBe('alert');
    expect(out.apns.payload.aps.alert).toEqual({ title: 'Hi', body: 'There' });
  });
});

describe('buildNotifyKitPayload — routing', () => {
  it('propagates token', () => {
    const out = buildNotifyKitPayload({
      token: 'device-token',
      notification: { title: 'a', body: 'b' },
    });
    expect(out.token).toBe('device-token');
    expect(out.topic).toBeUndefined();
    expect(out.condition).toBeUndefined();
  });

  it('propagates topic', () => {
    const out = buildNotifyKitPayload({
      topic: 'news',
      notification: { title: 'a', body: 'b' },
    });
    expect(out.topic).toBe('news');
    expect(out.token).toBeUndefined();
  });

  it('propagates condition', () => {
    const out = buildNotifyKitPayload({
      condition: "'news' in topics",
      notification: { title: 'a', body: 'b' },
    });
    expect(out.condition).toBe("'news' in topics");
    expect(out.token).toBeUndefined();
  });
});

describe('buildNotifyKitPayload — android rules', () => {
  it('never includes a notification field on android (Rule 2)', () => {
    const out = buildNotifyKitPayload({
      token: 't',
      notification: {
        title: 'a',
        body: 'b',
        android: { channelId: 'orders', smallIcon: 'ic' },
      },
    });
    expect('notification' in out.android).toBe(false);
    expect(Object.keys(out.android).sort()).toEqual(['priority'].sort());
  });

  it("defaults options.androidPriority to 'high' → 'HIGH'", () => {
    const out = buildNotifyKitPayload({
      token: 't',
      notification: { title: 'a', body: 'b' },
    });
    expect(out.android.priority).toBe('HIGH');
  });

  it("honors options.androidPriority = 'normal'", () => {
    const out = buildNotifyKitPayload({
      token: 't',
      notification: { title: 'a', body: 'b' },
      options: { androidPriority: 'normal' },
    });
    expect(out.android.priority).toBe('NORMAL');
  });
});

describe('buildNotifyKitPayload — iOS rules', () => {
  it('always sets mutable-content: 1 (Rule 4)', () => {
    const out = buildNotifyKitPayload({
      token: 't',
      notification: { title: 'a', body: 'b' },
    });
    expect(out.apns.payload.aps['mutable-content']).toBe(1);
  });

  it("apns-push-type is always 'alert' (Rule 3)", () => {
    const out = buildNotifyKitPayload({
      token: 't',
      notification: { title: 'a', body: 'b' },
    });
    expect(out.apns.headers['apns-push-type']).toBe('alert');
  });

  it('propagates iosBadgeCount to aps.badge', () => {
    const out = buildNotifyKitPayload({
      token: 't',
      notification: { title: 'a', body: 'b' },
      options: { iosBadgeCount: 5 },
    });
    expect(out.apns.payload.aps.badge).toBe(5);
  });

  it('propagates iosBadgeCount: 0 to aps.badge (clears badge)', () => {
    const out = buildNotifyKitPayload({
      token: 't',
      notification: { title: 'a', body: 'b' },
      options: { iosBadgeCount: 0 },
    });
    expect(out.apns.payload.aps.badge).toBe(0);
  });
});

describe('buildNotifyKitPayload — TTL formatting (Rule 8)', () => {
  const realNow = Date.now;
  beforeEach(() => {
    Date.now = () => 1_700_000_000_000;
  });
  afterEach(() => {
    Date.now = realNow;
  });

  it("formats android.ttl as 'Ns'", () => {
    const out = buildNotifyKitPayload({
      token: 't',
      notification: { title: 'a', body: 'b' },
      options: { ttl: 3600 },
    });
    expect(out.android.ttl).toBe('3600s');
  });

  it('formats apns-expiration as unix seconds + ttl', () => {
    const out = buildNotifyKitPayload({
      token: 't',
      notification: { title: 'a', body: 'b' },
      options: { ttl: 60 },
    });
    expect(out.apns.headers['apns-expiration']).toBe('1700000060');
  });

  it('omits ttl and apns-expiration when options.ttl is absent', () => {
    const out = buildNotifyKitPayload({
      token: 't',
      notification: { title: 'a', body: 'b' },
    });
    expect(out.android.ttl).toBeUndefined();
    expect(out.apns.headers['apns-expiration']).toBeUndefined();
  });
});

describe('buildNotifyKitPayload — collapse key precedence (Rule 7)', () => {
  it('uses options.collapseKey when set', () => {
    const out = buildNotifyKitPayload({
      token: 't',
      notification: { id: 'notif-id', title: 'a', body: 'b' },
      options: { collapseKey: 'override' },
    });
    expect(out.android.collapse_key).toBe('override');
    expect(out.apns.headers['apns-collapse-id']).toBe('override');
  });

  it('falls back to notification.id when options.collapseKey is absent', () => {
    const out = buildNotifyKitPayload({
      token: 't',
      notification: { id: 'order-42', title: 'a', body: 'b' },
    });
    expect(out.android.collapse_key).toBe('order-42');
    expect(out.apns.headers['apns-collapse-id']).toBe('order-42');
  });

  it('omits collapse key entirely when neither is set', () => {
    const out = buildNotifyKitPayload({
      token: 't',
      notification: { title: 'a', body: 'b' },
    });
    expect(out.android.collapse_key).toBeUndefined();
    expect(out.apns.headers['apns-collapse-id']).toBeUndefined();
  });
});

describe('buildNotifyKitPayload — notifee_options and notifee_data', () => {
  it('always sets _v: 1 in notifee_options (Rule 1)', () => {
    const out = buildNotifyKitPayload({
      token: 't',
      notification: { title: 'a', body: 'b' },
    });
    const parsed = JSON.parse(out.data.notifee_options as string);
    expect(parsed._v).toBe(1);
    expect(out.apns.payload.notifee_options).toBe(out.data.notifee_options);
  });

  it('embeds identical bytes in data.notifee_options and apns.payload.notifee_options', () => {
    const out = buildNotifyKitPayload({
      token: 't',
      notification: {
        title: 'a',
        body: 'b',
        android: { channelId: 'x' },
        ios: { sound: 'chime' },
      },
    });
    expect(out.data.notifee_options).toBe(out.apns.payload.notifee_options);
  });

  it('populates apns.payload.notifee_data only when notification.data is non-empty', () => {
    const withData = buildNotifyKitPayload({
      token: 't',
      notification: { title: 'a', body: 'b', data: { k: 'v' } },
    });
    // Top-level Android data intentionally does NOT carry a `notifee_data` key —
    // the client can read `data.k` directly.
    expect(withData.data.notifee_data).toBeUndefined();
    expect(withData.apns.payload.notifee_data).toBe('{"k":"v"}');

    const withoutData = buildNotifyKitPayload({
      token: 't',
      notification: { title: 'a', body: 'b' },
    });
    expect(withoutData.data.notifee_data).toBeUndefined();
    expect(withoutData.apns.payload.notifee_data).toBeUndefined();
  });

  it('spreads notification.data keys at top-level data without adding notifee_data', () => {
    const out = buildNotifyKitPayload({
      token: 't',
      notification: { title: 'a', body: 'b', data: { orderId: '42' } },
    });
    expect(out.data.orderId).toBe('42');
    expect(out.data.notifee_options).toBeDefined();
    expect(out.data.notifee_data).toBeUndefined();
    expect(out.apns.payload.notifee_data).toBe('{"orderId":"42"}');
  });
});

describe('buildNotifyKitPayload — kitchen sink snapshot', () => {
  const realNow = Date.now;
  beforeAll(() => {
    Date.now = () => 1_700_000_000_000;
  });
  afterAll(() => {
    Date.now = realNow;
  });

  it('matches canonical shape', () => {
    const input: NotifyKitPayloadInput = {
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
          style: { type: 'BIG_TEXT', text: 'Order #42 has shipped from warehouse' },
        },
        ios: {
          sound: 'chime.caf',
          categoryId: 'order-updates',
          threadId: 'orders',
          interruptionLevel: 'timeSensitive',
          attachments: [{ url: 'https://cdn.example.com/map.png', identifier: 'map' }],
        },
      },
      options: {
        androidPriority: 'high',
        iosBadgeCount: 3,
        ttl: 3600,
      },
    };
    const out = buildNotifyKitPayload(input);
    expect(out).toMatchSnapshot();
  });
});

describe('buildNotifyKitPayload — payload size warning (Rule 10)', () => {
  it('does not warn on small payloads', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    buildNotifyKitPayload({
      token: 't',
      notification: { title: 'a', body: 'b' },
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('warns when serialized output exceeds ~3500 bytes', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const big = 'x'.repeat(3800);
    buildNotifyKitPayload({
      token: 't',
      notification: {
        title: 'a',
        body: 'b',
        android: { style: { type: 'BIG_TEXT', text: big } },
      },
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toMatch(
      /\[react-native-notify-kit\/server\] Payload size \d+ bytes approaches FCM 4KB limit/,
    );
    spy.mockRestore();
  });

  it('counts UTF-8 bytes, not JS code units (emoji expand to 4 bytes each)', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    // 900 copies of 🚀 = 900 * 4 = 3600 UTF-8 bytes from the emoji alone,
    // plus ~250 bytes of envelope — above the 3500-byte threshold.
    // The same string is only 1800 JS code units, which would have been UNDER
    // the old char-based threshold. This asserts the byte-length fix.
    const emojiPayload = '🚀'.repeat(900);
    buildNotifyKitPayload({
      token: 't',
      notification: {
        title: 'a',
        body: 'b',
        android: { style: { type: 'BIG_TEXT', text: emojiPayload } },
      },
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const warned = spy.mock.calls[0]?.[0] as string;
    const match = warned.match(/Payload size (\d+) bytes/);
    expect(match).not.toBeNull();
    const reportedBytes = Number(match?.[1]);
    // Sanity: reported size should reflect UTF-8 expansion, not code-unit count.
    expect(reportedBytes).toBeGreaterThan(3600);
    spy.mockRestore();
  });
});

describe('buildNotifyKitPayload — sizeBytes field', () => {
  it('includes sizeBytes as a positive integer', () => {
    const out = buildNotifyKitPayload({
      token: 't',
      notification: { title: 'a', body: 'b' },
    });
    expect(typeof out.sizeBytes).toBe('number');
    expect(out.sizeBytes).toBeGreaterThan(0);
    expect(Number.isInteger(out.sizeBytes)).toBe(true);
  });

  it('sizeBytes reflects FCM payload bytes (excludes sizeBytes itself)', () => {
    const out = buildNotifyKitPayload({
      token: 't',
      notification: { title: 'a', body: 'b' },
    });
    // Reconstruct the FCM-only payload and measure independently
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { sizeBytes: _sb, ...fcmPayload } = out;
    const expected = Buffer.byteLength(JSON.stringify(fcmPayload), 'utf8');
    expect(out.sizeBytes).toBe(expected);
  });
});

describe('buildNotifyKitPayload — empty arrays in notifee_options', () => {
  it('preserves empty android.actions array in notifee_options', () => {
    const out = buildNotifyKitPayload({
      token: 't',
      notification: {
        title: 'a',
        body: 'b',
        android: { actions: [] },
      },
    });
    const parsed = JSON.parse(out.data.notifee_options as string);
    expect(parsed.android.actions).toEqual([]);
  });

  it('preserves empty ios.attachments array in notifee_options', () => {
    const out = buildNotifyKitPayload({
      token: 't',
      notification: {
        title: 'a',
        body: 'b',
        ios: { attachments: [] },
      },
    });
    const parsed = JSON.parse(out.data.notifee_options as string);
    expect(parsed.ios.attachments).toEqual([]);
  });
});

describe('buildNotifyKitPayload — apns.payload strict key set', () => {
  it('apns.payload contains only aps + notifee_options when data is absent', () => {
    const out = buildNotifyKitPayload({
      token: 't',
      notification: { title: 'a', body: 'b' },
    });
    expect(Object.keys(out.apns.payload).sort()).toEqual(['aps', 'notifee_options']);
  });

  it('apns.payload contains only aps + notifee_data + notifee_options when data is present', () => {
    const out = buildNotifyKitPayload({
      token: 't',
      notification: { title: 'a', body: 'b', data: { k: 'v' } },
    });
    expect(Object.keys(out.apns.payload).sort()).toEqual([
      'aps',
      'notifee_data',
      'notifee_options',
    ]);
  });
});
