import { buildAndroidPayload } from '../android';
import { buildNotifyKitPayload } from '../buildPayload';
import type { NotifyKitPayloadInput } from '../types';

function base(overrides: Partial<NotifyKitPayloadInput> = {}): NotifyKitPayloadInput {
  return {
    token: 'abc',
    notification: { title: 'Hello', body: 'World' },
    ...overrides,
  };
}

describe('buildAndroidPayload', () => {
  it("preserves priority 'high'", () => {
    const out = buildAndroidPayload(base({ options: { androidPriority: 'high' } }), {});
    expect(out.priority).toBe('high');
  });

  it("preserves priority 'normal'", () => {
    const out = buildAndroidPayload(base({ options: { androidPriority: 'normal' } }), {});
    expect(out.priority).toBe('normal');
  });

  it("defaults priority to 'high' when not specified", () => {
    const out = buildAndroidPayload(base(), {});
    expect(out.priority).toBe('high');
  });

  it('copies collapseKey from context', () => {
    const out = buildAndroidPayload(base(), { collapseKey: 'order-42' });
    expect(out.collapseKey).toBe('order-42');
    expect('collapse_key' in out).toBe(false);
  });

  it('converts ttl from seconds to milliseconds', () => {
    const out = buildAndroidPayload(base(), { ttlSeconds: 3600 });
    expect(out.ttl).toBe(3_600_000);
  });

  it('omits collapseKey and ttl when not provided', () => {
    const out = buildAndroidPayload(base(), {});
    expect(out.collapseKey).toBeUndefined();
    expect(out.ttl).toBeUndefined();
  });

  it('never emits a `notification` field (Rule 2)', () => {
    const out = buildAndroidPayload(base(), { collapseKey: 'k', ttlSeconds: 1 });
    expect('notification' in out).toBe(false);
  });
});

describe('Android-specific config routed through notifee_options', () => {
  const parseNotifeeOptions = (payload: ReturnType<typeof buildNotifyKitPayload>) =>
    JSON.parse(payload.data.notifee_options as string);

  it('preserves channelId, smallIcon, largeIcon, color in notifee_options', () => {
    const payload = buildNotifyKitPayload({
      token: 't',
      notification: {
        title: 'a',
        body: 'b',
        android: {
          channelId: 'orders',
          smallIcon: 'ic_small',
          largeIcon: 'ic_large',
          color: '#FF0000',
        },
      },
    });
    const parsed = parseNotifeeOptions(payload);
    expect(parsed.android).toEqual({
      channelId: 'orders',
      smallIcon: 'ic_small',
      largeIcon: 'ic_large',
      color: '#FF0000',
    });
  });

  it('preserves actions array in notifee_options', () => {
    const payload = buildNotifyKitPayload({
      token: 't',
      notification: {
        title: 'a',
        body: 'b',
        android: {
          actions: [
            { title: 'Reply', pressAction: { id: 'reply' }, input: true },
            { title: 'Mark done', pressAction: { id: 'done' } },
          ],
        },
      },
    });
    const parsed = parseNotifeeOptions(payload);
    expect(parsed.android.actions).toHaveLength(2);
    expect(parsed.android.actions[0]).toEqual({
      title: 'Reply',
      pressAction: { id: 'reply' },
      input: true,
    });
  });

  it('serializes BIG_TEXT style', () => {
    const payload = buildNotifyKitPayload({
      token: 't',
      notification: {
        title: 'a',
        body: 'b',
        android: { style: { type: 'BIG_TEXT', text: 'long text here' } },
      },
    });
    const parsed = parseNotifeeOptions(payload);
    expect(parsed.android.style).toEqual({ type: 'BIG_TEXT', text: 'long text here' });
  });

  it('serializes BIG_PICTURE style', () => {
    const payload = buildNotifyKitPayload({
      token: 't',
      notification: {
        title: 'a',
        body: 'b',
        android: {
          style: { type: 'BIG_PICTURE', picture: 'https://cdn.example.com/x.png' },
        },
      },
    });
    const parsed = parseNotifeeOptions(payload);
    expect(parsed.android.style).toEqual({
      type: 'BIG_PICTURE',
      picture: 'https://cdn.example.com/x.png',
    });
  });
});
