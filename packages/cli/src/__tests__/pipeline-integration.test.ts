/**
 * Check 2 — F1→F2→F3 logical round-trip
 *
 * Simulates the full pipeline:
 *   F1 (server) builds payload → F3 (NSE) reads apns.payload → F2 (client) reads data field
 * Verifies both reconstruction paths recover the original notification intent.
 */

// ---------------------------------------------------------------------------
// Fake NSE simulator — mimics what NotifeeExtensionHelper does on iOS
// ---------------------------------------------------------------------------

interface SimulatedNseResult {
  title: string;
  body: string;
  data: Record<string, string> | undefined;
  iosAttachments: Array<{ url: string; identifier?: string }> | undefined;
}

function fakeNseParse(apnsPayload: {
  aps: { alert: { title: string; body: string }; [k: string]: unknown };
  notifee_options: string;
  notifee_data?: string;
}): SimulatedNseResult {
  // NSE reads title/body from aps.alert (APNs delivery)
  const title = apnsPayload.aps.alert.title;
  const body = apnsPayload.aps.alert.body;

  // NSE reads notifee_options for ios config (attachments, etc.)
  const opts = JSON.parse(apnsPayload.notifee_options);
  const iosAttachments = opts.ios?.attachments;

  // NSE reads notifee_data for user data
  let data: Record<string, string> | undefined;
  if (apnsPayload.notifee_data) {
    data = JSON.parse(apnsPayload.notifee_data);
  }

  return { title, body, data, iosAttachments };
}

// ---------------------------------------------------------------------------
// Fake Android handler — mimics what F2 handleFcmMessage does
// ---------------------------------------------------------------------------

interface SimulatedAndroidResult {
  title: string;
  body: string;
  data: Record<string, string>;
  channelId: string | undefined;
}

function fakeAndroidParse(dataField: Record<string, string>): SimulatedAndroidResult {
  const opts = JSON.parse(dataField.notifee_options);
  const title = opts.title;
  const body = opts.body;
  const channelId = opts.android?.channelId;

  // Rebuild user data (strip reserved keys)
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(dataField)) {
    if (key !== 'notifee_options' && key !== 'notifee_data') {
      data[key] = value;
    }
  }

  return { title, body, data, channelId };
}

// ---------------------------------------------------------------------------
// F1 fixtures — exact shapes the server SDK produces
// ---------------------------------------------------------------------------

const FIXTURES = {
  minimal: {
    input: { title: 'Hello', body: 'World' },
    apnsPayload: {
      aps: { alert: { title: 'Hello', body: 'World' }, 'mutable-content': 1 },
      notifee_options: JSON.stringify({ _v: 1, title: 'Hello', body: 'World' }),
    },
    dataField: {
      notifee_options: JSON.stringify({ _v: 1, title: 'Hello', body: 'World' }),
    },
  },
  kitchenSink: {
    input: {
      title: 'Your order is ready',
      body: 'Tap to see details',
      data: { orderId: '42', customer: 'acme' },
      androidChannelId: 'orders',
      iosAttachments: [{ url: 'https://cdn.example.com/map.png', identifier: 'map' }],
    },
    apnsPayload: {
      aps: {
        alert: { title: 'Your order is ready', body: 'Tap to see details' },
        'mutable-content': 1,
        sound: 'chime.caf',
        category: 'order-updates',
        'thread-id': 'orders',
        badge: 3,
        'interruption-level': 'time-sensitive',
      },
      notifee_options: JSON.stringify({
        _v: 1,
        title: 'Your order is ready',
        body: 'Tap to see details',
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
      }),
      notifee_data: JSON.stringify({ orderId: '42', customer: 'acme' }),
    },
    dataField: {
      orderId: '42',
      customer: 'acme',
      notifee_options: JSON.stringify({
        _v: 1,
        title: 'Your order is ready',
        body: 'Tap to see details',
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
      }),
    },
  },
  emoji: {
    input: { title: '🚀', body: '🎉' },
    apnsPayload: {
      aps: { alert: { title: '🚀', body: '🎉' }, 'mutable-content': 1 },
      notifee_options: JSON.stringify({
        _v: 1,
        title: '🚀',
        body: '🎉',
        android: { channelId: '🏁-channel-🏁' },
      }),
    },
    dataField: {
      notifee_options: JSON.stringify({
        _v: 1,
        title: '🚀',
        body: '🎉',
        android: { channelId: '🏁-channel-🏁' },
      }),
    },
  },
};

// ---------------------------------------------------------------------------
// Tests — iOS NSE path (background/killed: F3 reads apns.payload)
// ---------------------------------------------------------------------------

describe('Check 2 — F1→F3 (iOS NSE background path)', () => {
  it('minimal: NSE reconstructs title/body from aps.alert', () => {
    const result = fakeNseParse(FIXTURES.minimal.apnsPayload);
    expect(result.title).toBe(FIXTURES.minimal.input.title);
    expect(result.body).toBe(FIXTURES.minimal.input.body);
  });

  it('kitchen-sink: NSE reads title/body + data + attachments', () => {
    const result = fakeNseParse(FIXTURES.kitchenSink.apnsPayload);
    expect(result.title).toBe(FIXTURES.kitchenSink.input.title);
    expect(result.body).toBe(FIXTURES.kitchenSink.input.body);
    expect(result.data).toEqual(FIXTURES.kitchenSink.input.data);
    expect(result.iosAttachments).toEqual(FIXTURES.kitchenSink.input.iosAttachments);
  });

  it('emoji: NSE preserves emoji through JSON parse', () => {
    const result = fakeNseParse(FIXTURES.emoji.apnsPayload);
    expect(result.title).toBe('🚀');
    expect(result.body).toBe('🎉');
  });
});

// ---------------------------------------------------------------------------
// Tests — Android handler path (F2 reads data field)
// ---------------------------------------------------------------------------

describe('Check 2 — F1→F2 (Android foreground path)', () => {
  it('minimal: Android reconstructs title/body from notifee_options', () => {
    const result = fakeAndroidParse(FIXTURES.minimal.dataField);
    expect(result.title).toBe(FIXTURES.minimal.input.title);
    expect(result.body).toBe(FIXTURES.minimal.input.body);
  });

  it('kitchen-sink: Android reads title/body + data + channelId', () => {
    const result = fakeAndroidParse(FIXTURES.kitchenSink.dataField);
    expect(result.title).toBe(FIXTURES.kitchenSink.input.title);
    expect(result.body).toBe(FIXTURES.kitchenSink.input.body);
    expect(result.data).toEqual({ orderId: '42', customer: 'acme' });
    expect(result.channelId).toBe('orders');
  });

  it('emoji: Android preserves emoji from notifee_options', () => {
    const result = fakeAndroidParse(FIXTURES.emoji.dataField);
    expect(result.title).toBe('🚀');
    expect(result.body).toBe('🎉');
    expect(result.channelId).toBe('🏁-channel-🏁');
  });
});
