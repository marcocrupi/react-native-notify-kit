import { AppState } from 'react-native';
import NotifeeApiModule from 'react-native-notify-kit/src/NotifeeApiModule';
import * as Notifee from 'react-native-notify-kit/src';
import { setPlatform } from './testSetup';
import { parseFcmPayload } from 'react-native-notify-kit/src/fcm/parseFcmPayload';
import { reconstructNotification } from 'react-native-notify-kit/src/fcm/reconstructNotification';
import type { FcmRemoteMessage } from 'react-native-notify-kit/src/fcm/types';

jest.mock('react-native-notify-kit/src/NotifeeNativeModule');

const apiModule = new NotifeeApiModule({
  version: Notifee.default.SDK_VERSION,
  nativeModuleName: 'NotifeeApiModule',
  nativeEvents: [],
});

// Helper: set AppState.currentState for iOS tests
function setAppState(state: 'active' | 'background' | 'inactive' | 'unknown' | null) {
  Object.defineProperty(AppState, 'currentState', {
    get: () => state,
    configurable: true,
  });
}

// Helper: mock displayNotification to return the notification ID
let displaySpy: jest.SpyInstance;
beforeEach(() => {
  displaySpy = jest
    .spyOn(apiModule, 'displayNotification')
    .mockImplementation(async notification => notification.id ?? 'auto-id');
});
afterEach(() => {
  displaySpy.mockRestore();
  setPlatform('android'); // reset to default
  setAppState('active');
});

// ---------------------------------------------------------------------------
// Minimal remote message helpers
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<FcmRemoteMessage> = {}): FcmRemoteMessage {
  return {
    messageId: 'msg-1',
    data: {
      notifee_options: JSON.stringify({
        _v: 1,
        title: 'Hello',
        body: 'World',
        android: { channelId: 'default' },
      }),
    },
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function makeFullMessage(): FcmRemoteMessage {
  return {
    messageId: 'msg-full',
    data: {
      notifee_options: JSON.stringify({
        _v: 1,
        title: 'Order shipped',
        body: 'Your order #42 is on the way',
        android: {
          channelId: 'orders',
          smallIcon: 'ic_small',
          color: '#FF0000',
          pressAction: { id: 'open', launchActivity: 'default' },
          style: { type: 'BIG_TEXT', text: 'Order #42 shipped from warehouse' },
          actions: [{ title: 'Track', pressAction: { id: 'track' } }],
        },
        ios: {
          sound: 'chime.caf',
          categoryId: 'orders',
          threadId: 'order-thread',
          interruptionLevel: 'timeSensitive',
          attachments: [{ url: 'https://cdn.example.com/map.png', identifier: 'map' }],
        },
      }),
      notifee_data: JSON.stringify({ orderId: '42', customer: 'acme' }),
      orderId: '42',
      customer: 'acme',
    },
  };
}

// ===================================================================
// 1. Platform dispatch (8 tests)
// ===================================================================

describe('handleFcmMessage — platform dispatch', () => {
  it('Android: always calls displayNotification', async () => {
    setPlatform('android');
    const result = await apiModule.handleFcmMessage(makeMessage());
    expect(displaySpy).toHaveBeenCalledTimes(1);
    expect(typeof result).toBe('string');
  });

  it('iOS active: calls displayNotification', async () => {
    setPlatform('ios');
    setAppState('active');
    const result = await apiModule.handleFcmMessage(makeMessage());
    expect(displaySpy).toHaveBeenCalledTimes(1);
    expect(typeof result).toBe('string');
  });

  it('iOS background: returns null, does not call displayNotification', async () => {
    setPlatform('ios');
    setAppState('background');
    const result = await apiModule.handleFcmMessage(makeMessage());
    expect(result).toBeNull();
    expect(displaySpy).not.toHaveBeenCalled();
  });

  it('iOS inactive: returns null, does not call displayNotification', async () => {
    setPlatform('ios');
    setAppState('inactive');
    const result = await apiModule.handleFcmMessage(makeMessage());
    expect(result).toBeNull();
    expect(displaySpy).not.toHaveBeenCalled();
  });

  it('iOS unknown state: returns null (safety — not active)', async () => {
    setPlatform('ios');
    setAppState('unknown');
    const result = await apiModule.handleFcmMessage(makeMessage());
    expect(result).toBeNull();
    expect(displaySpy).not.toHaveBeenCalled();
  });

  it('iOS active + suppressForegroundBanner: returns null', async () => {
    setPlatform('ios');
    setAppState('active');
    await apiModule.setFcmConfig({ ios: { suppressForegroundBanner: true } });
    const result = await apiModule.handleFcmMessage(makeMessage());
    expect(result).toBeNull();
    expect(displaySpy).not.toHaveBeenCalled();
    await apiModule.setFcmConfig({}); // reset
  });

  it('iOS active + suppressForegroundBanner false: displays normally', async () => {
    setPlatform('ios');
    setAppState('active');
    await apiModule.setFcmConfig({ ios: { suppressForegroundBanner: false } });
    const result = await apiModule.handleFcmMessage(makeMessage());
    expect(displaySpy).toHaveBeenCalledTimes(1);
    expect(typeof result).toBe('string');
    await apiModule.setFcmConfig({});
  });

  it('Android: ignores AppState entirely (no no-op path)', async () => {
    setPlatform('android');
    setAppState('background'); // should be irrelevant on Android
    const result = await apiModule.handleFcmMessage(makeMessage());
    expect(displaySpy).toHaveBeenCalledTimes(1);
    expect(typeof result).toBe('string');
  });
});

// ===================================================================
// 2. Payload parsing (8 tests)
// ===================================================================

describe('handleFcmMessage — payload parsing', () => {
  it('valid notifee_options: parses correctly', () => {
    const result = parseFcmPayload({
      notifee_options: JSON.stringify({ _v: 1, title: 'Hi', body: 'There' }),
    });
    expect(result).toEqual({ _v: 1, title: 'Hi', body: 'There' });
  });

  it('invalid JSON: returns null + warns', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = parseFcmPayload({ notifee_options: '{broken' });
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[react-native-notify-kit] Failed to parse notifee_options'),
    );
    warn.mockRestore();
  });

  it('missing notifee_options key: returns null', () => {
    expect(parseFcmPayload({ other: 'value' })).toBeNull();
  });

  it('undefined data: returns null', () => {
    expect(parseFcmPayload(undefined)).toBeNull();
  });

  it('_v: 2 warns but proceeds', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = parseFcmPayload({
      notifee_options: JSON.stringify({ _v: 2, title: 'x', body: 'y' }),
    });
    expect(result).not.toBeNull();
    expect(result?._v).toBe(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('version 2 is newer than supported version 1'),
    );
    warn.mockRestore();
  });

  it('_v as string "2" also triggers version warn (M2 fix)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = parseFcmPayload({
      notifee_options: JSON.stringify({ _v: '2', title: 'x', body: 'y' }),
    });
    expect(result).not.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('version 2 is newer than supported version 1'),
    );
    warn.mockRestore();
  });

  it('_v missing: proceeds as legacy', () => {
    const result = parseFcmPayload({
      notifee_options: JSON.stringify({ title: 'x', body: 'y' }),
    });
    expect(result).not.toBeNull();
    expect(result?.title).toBe('x');
  });

  it('empty object blob: proceeds with empty payload', () => {
    const result = parseFcmPayload({
      notifee_options: '{}',
    });
    expect(result).toEqual({});
  });

  it('unicode/emoji in blob: preserved end-to-end', () => {
    const result = parseFcmPayload({
      notifee_options: JSON.stringify({ _v: 1, title: '🚀 Launch!', body: 'café-Ω' }),
    });
    expect(result?.title).toBe('🚀 Launch!');
    expect(result?.body).toBe('café-Ω');
  });
});

// ===================================================================
// 3. Data reconstruction (8 tests)
// ===================================================================

describe('reconstructNotification — data handling', () => {
  it('merges notifee_data into data (Rule C7)', () => {
    const n = reconstructNotification(
      { _v: 1, title: 'a', body: 'b' },
      { data: { notifee_data: '{"k":"v"}', notifee_options: '{}', other: 'x' } },
      {},
    );
    expect(n.data).toEqual({ other: 'x', k: 'v' });
  });

  it('notifee_data overrides top-level on conflict', () => {
    const n = reconstructNotification(
      { _v: 1, title: 'a', body: 'b' },
      { data: { key: 'top', notifee_data: '{"key":"blob"}', notifee_options: '{}' } },
      {},
    );
    expect(n.data?.key).toBe('blob');
  });

  it('reserved keys stripped from final data', () => {
    const n = reconstructNotification(
      { _v: 1, title: 'a', body: 'b' },
      { data: { notifee_options: '{}', notifee_data: '{}', safe: 'yes' } },
      {},
    );
    expect(n.data).toEqual({ safe: 'yes' });
  });

  it('reserved keys stripped even if injected via notifee_data blob (M1 fix)', () => {
    const n = reconstructNotification(
      { _v: 1, title: 'a', body: 'b' },
      {
        data: {
          notifee_options: '{}',
          notifee_data: JSON.stringify({ notifee_options: 'leaked', safe: 'yes' }),
          safe: 'top',
        },
      },
      {},
    );
    expect(n.data).toEqual({ safe: 'yes' }); // notifee_data wins on 'safe', 'notifee_options' stripped
    expect(n.data?.notifee_options).toBeUndefined();
    expect(n.data?.notifee_data).toBeUndefined();
  });

  it('title/body precedence: notifee_options > notification > data', () => {
    const n = reconstructNotification(
      { _v: 1, title: 'from-blob', body: 'from-blob' },
      {
        notification: { title: 'from-notif', body: 'from-notif' },
        data: { title: 'from-data', body: 'from-data', notifee_options: '{}' },
      },
      {},
    );
    expect(n.title).toBe('from-blob');
    expect(n.body).toBe('from-blob');
  });

  it('title/body fallback to notification when blob is null', () => {
    const n = reconstructNotification(
      null,
      { notification: { title: 'notif-title', body: 'notif-body' } },
      {},
    );
    expect(n.title).toBe('notif-title');
    expect(n.body).toBe('notif-body');
  });

  it('title/body fallback to data keys when all else missing', () => {
    const n = reconstructNotification(
      null,
      { data: { title: 'data-title', body: 'data-body', notifee_options: '{}' } },
      {},
    );
    expect(n.title).toBe('data-title');
    expect(n.body).toBe('data-body');
  });

  it('id precedence: notifee_options.id > messageId', () => {
    const n = reconstructNotification(
      { _v: 1, id: 'blob-id', title: 'a', body: 'b' } as Record<string, unknown>,
      { messageId: 'msg-id' },
      {},
    );
    expect(n.id).toBe('blob-id');
  });

  it('data absent entirely: notification has no data field', () => {
    const n = reconstructNotification({ _v: 1, title: 'a', body: 'b' }, {}, {});
    expect(n.data).toBeUndefined();
  });
});

// ===================================================================
// 4. Fallback behavior (6 tests)
// ===================================================================

describe('handleFcmMessage — fallback behavior', () => {
  it('default (display): shows notification from remoteMessage.notification', async () => {
    setPlatform('android');
    await apiModule.setFcmConfig({ defaultChannelId: 'fallback-ch' });
    await apiModule.handleFcmMessage({
      messageId: 'fb-1',
      notification: { title: 'FCM title', body: 'FCM body' },
    });
    expect(displaySpy).toHaveBeenCalledTimes(1);
    const passedNotification = displaySpy.mock.calls[0][0];
    expect(passedNotification.title).toBe('FCM title');
    expect(passedNotification.body).toBe('FCM body');
    await apiModule.setFcmConfig({});
  });

  it('ignore mode: returns null when notifee_options absent', async () => {
    setPlatform('android');
    await apiModule.setFcmConfig({ fallbackBehavior: 'ignore' });
    const result = await apiModule.handleFcmMessage({
      messageId: 'fb-2',
      notification: { title: 'ignored', body: 'ignored' },
    });
    expect(result).toBeNull();
    expect(displaySpy).not.toHaveBeenCalled();
    await apiModule.setFcmConfig({});
  });

  it('defaultChannelId applied when payload omits it', async () => {
    setPlatform('android');
    await apiModule.setFcmConfig({ defaultChannelId: 'my-channel' });
    await apiModule.handleFcmMessage(
      makeMessage({
        data: {
          notifee_options: JSON.stringify({ _v: 1, title: 'a', body: 'b', android: {} }),
        },
      }),
    );
    const passedNotification = displaySpy.mock.calls[0][0];
    expect(passedNotification.android.channelId).toBe('my-channel');
    await apiModule.setFcmConfig({});
  });

  it('defaultPressAction applied when payload omits it', async () => {
    setPlatform('android');
    await apiModule.setFcmConfig({
      defaultChannelId: 'ch',
      defaultPressAction: { id: 'default', launchActivity: 'default' },
    });
    await apiModule.handleFcmMessage(
      makeMessage({
        data: {
          notifee_options: JSON.stringify({ _v: 1, title: 'a', body: 'b', android: {} }),
        },
      }),
    );
    const passedNotification = displaySpy.mock.calls[0][0];
    expect(passedNotification.android.pressAction).toEqual({
      id: 'default',
      launchActivity: 'default',
    });
    await apiModule.setFcmConfig({});
  });

  it('title from notification when data.title absent in fallback', async () => {
    setPlatform('android');
    await apiModule.setFcmConfig({ defaultChannelId: 'ch' });
    await apiModule.handleFcmMessage({
      notification: { title: 'FCM Title' },
    });
    const passedNotification = displaySpy.mock.calls[0][0];
    expect(passedNotification.title).toBe('FCM Title');
    expect(passedNotification.body).toBe('');
    await apiModule.setFcmConfig({});
  });

  it('notifee_data parse failure: warns and uses top-level data', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const n = reconstructNotification(
      { _v: 1, title: 'a', body: 'b' },
      { data: { notifee_data: '{broken', notifee_options: '{}', safe: 'yes' } },
      {},
    );
    expect(n.data).toEqual({ safe: 'yes' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Failed to parse notifee_data'));
    warn.mockRestore();
  });
});

// ===================================================================
// 5. setFcmConfig (6 tests)
// ===================================================================

describe('setFcmConfig', () => {
  afterEach(async () => {
    await apiModule.setFcmConfig({});
  });

  it('returns a Promise', () => {
    const result = apiModule.setFcmConfig({});
    expect(result).toBeInstanceOf(Promise);
  });

  it('replaces config entirely (no deep merge)', async () => {
    await apiModule.setFcmConfig({ defaultChannelId: 'a', fallbackBehavior: 'ignore' });
    await apiModule.setFcmConfig({ defaultChannelId: 'b' });
    // fallbackBehavior should be back to default (undefined)
    setPlatform('android');
    await apiModule.handleFcmMessage({
      notification: { title: 'x', body: 'y' },
    });
    // If fallbackBehavior were still 'ignore', this would return null
    expect(displaySpy).toHaveBeenCalledTimes(1);
  });

  it('calling with {} resets to defaults', async () => {
    await apiModule.setFcmConfig({ fallbackBehavior: 'ignore' });
    await apiModule.setFcmConfig({});
    setPlatform('android');
    await apiModule.handleFcmMessage({
      notification: { title: 'x', body: 'y' },
    });
    expect(displaySpy).toHaveBeenCalledTimes(1);
  });

  it('multiple calls: last wins', async () => {
    await apiModule.setFcmConfig({ defaultChannelId: 'first' });
    await apiModule.setFcmConfig({ defaultChannelId: 'second' });
    setPlatform('android');
    await apiModule.handleFcmMessage(
      makeMessage({
        data: { notifee_options: JSON.stringify({ _v: 1, title: 'a', body: 'b', android: {} }) },
      }),
    );
    expect(displaySpy.mock.calls[0][0].android.channelId).toBe('second');
  });

  it('config persists across handleFcmMessage calls', async () => {
    await apiModule.setFcmConfig({ defaultChannelId: 'persist' });
    setPlatform('android');
    await apiModule.handleFcmMessage(
      makeMessage({
        data: { notifee_options: JSON.stringify({ _v: 1, title: 'a', body: 'b', android: {} }) },
      }),
    );
    await apiModule.handleFcmMessage(
      makeMessage({
        data: { notifee_options: JSON.stringify({ _v: 1, title: 'c', body: 'd', android: {} }) },
      }),
    );
    expect(displaySpy.mock.calls[0][0].android.channelId).toBe('persist');
    expect(displaySpy.mock.calls[1][0].android.channelId).toBe('persist');
  });

  it('config snapshot at entry: mid-flight change does not affect current call', async () => {
    await apiModule.setFcmConfig({ defaultChannelId: 'before' });
    setPlatform('android');

    // Override displayNotification to change config mid-flight
    displaySpy.mockImplementation(async notification => {
      // Simulate: someone calls setFcmConfig during this await
      await apiModule.setFcmConfig({ defaultChannelId: 'after' });
      return notification.id ?? 'id';
    });

    await apiModule.handleFcmMessage(
      makeMessage({
        data: { notifee_options: JSON.stringify({ _v: 1, title: 'a', body: 'b', android: {} }) },
      }),
    );
    // The notification was built with 'before', not 'after'
    expect(displaySpy.mock.calls[0][0].android.channelId).toBe('before');
  });
});

// ===================================================================
// 6. Error resilience (4 tests)
// ===================================================================

describe('handleFcmMessage — error resilience', () => {
  it('null remoteMessage: throws', async () => {
    await expect(apiModule.handleFcmMessage(null as any)).rejects.toThrow(
      "notifee.handleFcmMessage(*) 'remoteMessage' expected an object.",
    );
  });

  it('undefined remoteMessage.data: treats as fallback path', async () => {
    setPlatform('android');
    await apiModule.setFcmConfig({ defaultChannelId: 'ch' });
    await apiModule.handleFcmMessage({
      messageId: 'msg',
      notification: { title: 'fallback', body: 'path' },
    });
    expect(displaySpy).toHaveBeenCalledTimes(1);
    await apiModule.setFcmConfig({});
  });

  it('displayNotification throws: error propagates', async () => {
    setPlatform('android');
    displaySpy.mockRejectedValue(new Error('channel not found'));
    await expect(apiModule.handleFcmMessage(makeMessage())).rejects.toThrow('channel not found');
  });

  it('malformed _v (string): treated as missing, proceeds', () => {
    const result = parseFcmPayload({
      notifee_options: JSON.stringify({ _v: 'one', title: 'a', body: 'b' }),
    });
    expect(result).not.toBeNull();
    expect(result?.title).toBe('a');
  });
});

// ===================================================================
// 7. Defense-in-depth: style + interruptionLevel mapping (4 tests)
// ===================================================================

describe('reconstructNotification — defense-in-depth', () => {
  it('unknown android.style.type: warns and omits style', () => {
    setPlatform('android');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const n = reconstructNotification(
      { _v: 1, title: 'a', body: 'b', android: { style: { type: 'INBOX', text: '...' } } },
      {},
      {},
    );
    expect(n.android?.style).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Unknown android.style.type 'INBOX'. Style ignored."),
    );
    warn.mockRestore();
  });

  it('BIG_TEXT with missing text field: style omitted (no crash)', () => {
    setPlatform('android');
    const n = reconstructNotification(
      { _v: 1, title: 'a', body: 'b', android: { style: { type: 'BIG_TEXT' } } },
      {},
      {},
    );
    expect(n.android?.style).toBeUndefined();
  });

  it('unknown ios.interruptionLevel: warns and omits', () => {
    setPlatform('ios');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const n = reconstructNotification(
      { _v: 1, title: 'a', body: 'b', ios: { interruptionLevel: 'urgent' } },
      {},
      {},
    );
    expect(n.ios?.interruptionLevel).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Unknown ios.interruptionLevel 'urgent'. Ignored."),
    );
    warn.mockRestore();
  });

  it('ios attachments: identifier → id rename', () => {
    setPlatform('ios');
    const n = reconstructNotification(
      {
        _v: 1,
        title: 'a',
        body: 'b',
        ios: { attachments: [{ url: 'https://x.com/a.png', identifier: 'att-1' }] },
      },
      {},
      {},
    );
    expect(n.ios?.attachments?.[0]).toEqual({ url: 'https://x.com/a.png', id: 'att-1' });
  });

  it('C1: null element in ios.attachments is filtered out (no crash)', () => {
    setPlatform('ios');
    const n = reconstructNotification(
      {
        _v: 1,
        title: 'a',
        body: 'b',
        ios: { attachments: [null, { url: 'https://x.com/a.png' }, 42] },
      },
      {},
      {},
    );
    // null and 42 filtered, only the valid object survives
    expect(n.ios?.attachments).toHaveLength(1);
    expect(n.ios?.attachments?.[0]).toEqual({ url: 'https://x.com/a.png' });
  });
});

// ===================================================================
// 8. Adversarial round 2 fixes (5 tests)
// ===================================================================

describe('F2 R2 adversarial fixes', () => {
  it('C2: JSON array notifee_options returns null + warns', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = parseFcmPayload({ notifee_options: '[]' });
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('parsed to a non-object value'));
    warn.mockRestore();
  });

  it('H1: setFcmConfig throws on null', () => {
    expect(() => apiModule.setFcmConfig(null as any)).toThrow(
      'config must be a plain object. Got: null',
    );
  });

  it('M1: warns when both title and body are empty', async () => {
    setPlatform('android');
    await apiModule.setFcmConfig({ defaultChannelId: 'ch' });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await apiModule.handleFcmMessage({ messageId: 'x' });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('displaying notification with empty title and body'),
    );
    warn.mockRestore();
    await apiModule.setFcmConfig({});
  });

  it('M2: warns when Android has no channelId in fallback', async () => {
    setPlatform('android');
    await apiModule.setFcmConfig({}); // no defaultChannelId
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await apiModule.handleFcmMessage({
      notification: { title: 'x', body: 'y' },
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Android fallback path has no channelId'),
    );
    warn.mockRestore();
  });
});

// ===================================================================
// 9. Full-context bug hunt fixes (7 tests)
// ===================================================================

describe('Full-context bug hunt fixes', () => {
  // H1: attachment with missing/empty url is filtered out (not passed to displayNotification)
  it('H1: ios attachment with missing url is filtered out + warns', () => {
    setPlatform('ios');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const n = reconstructNotification(
      {
        _v: 1,
        title: 'a',
        body: 'b',
        ios: {
          attachments: [{ identifier: 'no-url' }, { url: 'https://x.com/a.png', identifier: 'ok' }],
        },
      },
      {},
      {},
    );
    // Only the valid attachment survives
    expect(n.ios?.attachments).toHaveLength(1);
    expect(n.ios?.attachments?.[0]).toEqual({ url: 'https://x.com/a.png', id: 'ok' });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('ios.attachments entry has missing or empty url'),
    );
    warn.mockRestore();
  });

  it('H1: ios attachment with empty string url is filtered out', () => {
    setPlatform('ios');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const n = reconstructNotification(
      {
        _v: 1,
        title: 'a',
        body: 'b',
        ios: { attachments: [{ url: '', identifier: 'empty' }] },
      },
      {},
      {},
    );
    expect(n.ios?.attachments).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('ios.attachments entry has missing or empty url'),
    );
    warn.mockRestore();
  });

  // M1: BIG_TEXT without text field warns
  it('M1: BIG_TEXT with missing text warns and omits style', () => {
    setPlatform('android');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const n = reconstructNotification(
      { _v: 1, title: 'a', body: 'b', android: { style: { type: 'BIG_TEXT' } } },
      {},
      {},
    );
    expect(n.android?.style).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("'text' field missing or not a string"),
    );
    warn.mockRestore();
  });

  it('M1: BIG_PICTURE with missing picture warns and omits style', () => {
    setPlatform('android');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const n = reconstructNotification(
      { _v: 1, title: 'a', body: 'b', android: { style: { type: 'BIG_PICTURE' } } },
      {},
      {},
    );
    expect(n.android?.style).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("'picture' field missing or not a string"),
    );
    warn.mockRestore();
  });

  // M4: setFcmConfig deep-copies nested ios object
  it('M4: caller mutation of ios sub-object after setFcmConfig does not leak', async () => {
    setPlatform('ios');
    setAppState('active');
    const cfg = { ios: { suppressForegroundBanner: false } };
    await apiModule.setFcmConfig(cfg);
    // Mutate the original object after setFcmConfig
    cfg.ios.suppressForegroundBanner = true;
    // handleFcmMessage should use the stored snapshot, not the mutated reference
    const result = await apiModule.handleFcmMessage(makeMessage());
    expect(displaySpy).toHaveBeenCalledTimes(1);
    expect(typeof result).toBe('string');
    await apiModule.setFcmConfig({});
  });
});
