import { buildNotifyKitPayload } from '../buildPayload';
import { buildAndroidPayload } from '../android';

const notification = { id: 'logical-42', title: 'Title', body: 'Body' };

describe('FCM notification identity and transport collapse', () => {
  it('serializes N and defaults C to N on both transports', () => {
    const out = buildNotifyKitPayload({ token: 'token', notification });
    expect(JSON.parse(out.data.notifee_options)).toMatchObject({ _v: 1, id: 'logical-42' });
    expect(out.apns.payload.notifee_options).toBe(out.data.notifee_options);
    expect(out.android.collapseKey).toBe('logical-42');
    expect(out.apns.headers['apns-collapse-id']).toBe('logical-42');
  });

  it('keeps explicit C separate from serialized N', () => {
    const out = buildNotifyKitPayload({
      token: 'token',
      notification,
      options: { collapseKey: 'transport-7' },
    });
    expect(JSON.parse(out.data.notifee_options).id).toBe('logical-42');
    expect(out.android.collapseKey).toBe('transport-7');
    expect(out.apns.headers['apns-collapse-id']).toBe('transport-7');
  });

  it('preserves the legacy omission of N and C', () => {
    const out = buildNotifyKitPayload({
      token: 'token',
      notification: { title: 'Title', body: 'Body' },
    });
    expect(JSON.parse(out.data.notifee_options)).not.toHaveProperty('id');
    expect(out.android).not.toHaveProperty('collapseKey');
    expect(out.apns.headers).not.toHaveProperty('apns-collapse-id');
  });

  it('accepts exactly 64 UTF-8 bytes for effective APNs C', () => {
    const out = buildNotifyKitPayload({
      token: 'token',
      notification: { ...notification, id: 'é'.repeat(32) },
    });
    expect(out.apns.headers['apns-collapse-id']).toBe('é'.repeat(32));
  });

  it('rejects effective APNs C over 64 UTF-8 bytes, including an explicit override', () => {
    expect(() =>
      buildNotifyKitPayload({
        token: 'token',
        notification: { ...notification, id: 'é'.repeat(33) },
      }),
    ).toThrow(/apns-collapse-id.*64 UTF-8 bytes/);
    expect(() =>
      buildNotifyKitPayload({
        token: 'token',
        notification,
        options: { collapseKey: '🚀'.repeat(17) },
      }),
    ).toThrow(/apns-collapse-id.*64 UTF-8 bytes/);
  });

  it('does not apply the APNs C limit to N when C is short or to Android-only construction', () => {
    const longId = '🚀'.repeat(17);
    const out = buildNotifyKitPayload({
      token: 'token',
      notification: { ...notification, id: longId },
      options: { collapseKey: 'short' },
    });
    expect(JSON.parse(out.data.notifee_options).id).toBe(longId);
    expect(
      buildAndroidPayload(
        { token: 'token', notification: { ...notification, id: longId } },
        {
          collapseKey: longId,
        },
      ).collapseKey,
    ).toBe(longId);
  });
});
