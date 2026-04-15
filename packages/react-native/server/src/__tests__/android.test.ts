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
  it("capitalizes priority 'high' → 'HIGH'", () => {
    const out = buildAndroidPayload(base({ options: { androidPriority: 'high' } }), {});
    expect(out.priority).toBe('HIGH');
  });

  it("capitalizes priority 'normal' → 'NORMAL'", () => {
    const out = buildAndroidPayload(base({ options: { androidPriority: 'normal' } }), {});
    expect(out.priority).toBe('NORMAL');
  });

  it("defaults priority to 'HIGH' when not specified", () => {
    const out = buildAndroidPayload(base(), {});
    expect(out.priority).toBe('HIGH');
  });

  it('copies collapse_key from context', () => {
    const out = buildAndroidPayload(base(), { collapseKey: 'order-42' });
    expect(out.collapse_key).toBe('order-42');
  });

  it('formats ttl as "Ns" string', () => {
    const out = buildAndroidPayload(base(), { ttlSeconds: 3600 });
    expect(out.ttl).toBe('3600s');
  });

  it('omits collapse_key and ttl when not provided', () => {
    const out = buildAndroidPayload(base(), {});
    expect(out.collapse_key).toBeUndefined();
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
