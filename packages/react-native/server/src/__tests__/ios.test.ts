import { buildIosApnsPayload, toApnsInterruptionLevel } from '../ios';
import type { NotifyKitPayloadInput } from '../types';

function base(
  overrides: Partial<NotifyKitPayloadInput['notification']> = {},
): NotifyKitPayloadInput {
  return {
    token: 'abc',
    notification: { title: 'Hello', body: 'World', ...overrides },
  };
}

const minimalCtx = { notifeeOptions: '{"_v":1}' };

describe('buildIosApnsPayload — core structure', () => {
  it('always emits apns-push-type: alert and apns-priority: 10', () => {
    const out = buildIosApnsPayload(base(), minimalCtx);
    expect(out.headers['apns-push-type']).toBe('alert');
    expect(out.headers['apns-priority']).toBe('10');
  });

  it('always emits aps.alert and mutable-content: 1', () => {
    const out = buildIosApnsPayload(base(), minimalCtx);
    expect(out.payload.aps.alert).toEqual({ title: 'Hello', body: 'World' });
    expect(out.payload.aps['mutable-content']).toBe(1);
  });

  it('embeds notifee_options into payload (not into aps)', () => {
    const out = buildIosApnsPayload(base(), {
      notifeeOptions: '{"_v":1,"ios":{"sound":"x"}}',
    });
    expect(out.payload.notifee_options).toBe('{"_v":1,"ios":{"sound":"x"}}');
    expect('notifee_options' in out.payload.aps).toBe(false);
  });
});

describe('buildIosApnsPayload — field mappings', () => {
  it('maps sound to aps.sound', () => {
    const out = buildIosApnsPayload(base({ ios: { sound: 'chime' } }), minimalCtx);
    expect(out.payload.aps.sound).toBe('chime');
  });

  it('maps categoryId to aps.category', () => {
    const out = buildIosApnsPayload(base({ ios: { categoryId: 'order-updates' } }), minimalCtx);
    expect(out.payload.aps.category).toBe('order-updates');
  });

  it('maps threadId to aps.thread-id', () => {
    const out = buildIosApnsPayload(base({ ios: { threadId: 'thread-42' } }), minimalCtx);
    expect(out.payload.aps['thread-id']).toBe('thread-42');
  });

  it('maps badge from options.iosBadgeCount', () => {
    const out = buildIosApnsPayload(
      { token: 't', notification: { title: 'a', body: 'b' }, options: { iosBadgeCount: 7 } },
      minimalCtx,
    );
    expect(out.payload.aps.badge).toBe(7);
  });

  it('omits sound/category/thread-id/badge when not provided', () => {
    const out = buildIosApnsPayload(base(), minimalCtx);
    expect(out.payload.aps.sound).toBeUndefined();
    expect(out.payload.aps.category).toBeUndefined();
    expect(out.payload.aps['thread-id']).toBeUndefined();
    expect(out.payload.aps.badge).toBeUndefined();
  });
});

describe('buildIosApnsPayload — interruption level translation (Rule 9)', () => {
  it.each([
    ['passive', 'passive'],
    ['active', 'active'],
    ['timeSensitive', 'time-sensitive'],
    ['critical', 'critical'],
  ] as const)('maps %s → %s', (input, expected) => {
    expect(toApnsInterruptionLevel(input)).toBe(expected);
    const out = buildIosApnsPayload(base({ ios: { interruptionLevel: input } }), minimalCtx);
    expect(out.payload.aps['interruption-level']).toBe(expected);
  });

  it('throws on invalid interruptionLevel at runtime (JS consumers)', () => {
    expect(() => toApnsInterruptionLevel('timesensitive' as never)).toThrow(
      "[react-native-notify-kit/server] Validation: invalid interruptionLevel 'timesensitive'. Expected one of: passive, active, timeSensitive, critical",
    );
  });
});

describe('buildIosApnsPayload — collapse id and expiration', () => {
  it('sets apns-collapse-id from context', () => {
    const out = buildIosApnsPayload(base(), {
      ...minimalCtx,
      collapseKey: 'order-42',
    });
    expect(out.headers['apns-collapse-id']).toBe('order-42');
  });

  it('sets apns-expiration from context', () => {
    const out = buildIosApnsPayload(base(), {
      ...minimalCtx,
      expiration: '1700000000',
    });
    expect(out.headers['apns-expiration']).toBe('1700000000');
  });

  it('omits both when context does not provide them', () => {
    const out = buildIosApnsPayload(base(), minimalCtx);
    expect(out.headers['apns-collapse-id']).toBeUndefined();
    expect(out.headers['apns-expiration']).toBeUndefined();
  });
});

describe('buildIosApnsPayload — notifee_data', () => {
  it('includes notifee_data when context provides it', () => {
    const out = buildIosApnsPayload(base(), {
      ...minimalCtx,
      notifeeData: '{"a":"1"}',
    });
    expect(out.payload.notifee_data).toBe('{"a":"1"}');
  });

  it('omits notifee_data otherwise', () => {
    const out = buildIosApnsPayload(base(), minimalCtx);
    expect(out.payload.notifee_data).toBeUndefined();
  });
});
