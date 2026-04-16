import { serializeData, serializeNotifeeOptions } from '../serialize';

const BASE = { title: 'T', body: 'B' } as const;

describe('serializeNotifeeOptions', () => {
  it('emits _v: 1 as the first JSON field', () => {
    const json = serializeNotifeeOptions(BASE);
    expect(json.startsWith('{"_v":1')).toBe(true);
  });

  it('emits title and body right after _v', () => {
    const parsed = JSON.parse(serializeNotifeeOptions(BASE));
    expect(parsed).toEqual({ _v: 1, title: 'T', body: 'B' });
  });

  it('keeps _v: 1 in the first position even with both platform blocks', () => {
    const json = serializeNotifeeOptions({
      ...BASE,
      android: { channelId: 'x' },
      ios: { sound: 'default' },
    });
    expect(json.startsWith('{"_v":1,')).toBe(true);
  });

  it('round-trips android and ios fields losslessly', () => {
    const json = serializeNotifeeOptions({
      ...BASE,
      android: { channelId: 'orders', smallIcon: 'ic' },
      ios: { sound: 'chime', categoryId: 'cat' },
    });
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({
      _v: 1,
      title: 'T',
      body: 'B',
      android: { channelId: 'orders', smallIcon: 'ic' },
      ios: { sound: 'chime', categoryId: 'cat' },
    });
  });

  it('escapes special characters like quotes and backslashes', () => {
    const json = serializeNotifeeOptions({
      ...BASE,
      android: { channelId: 'he said "hi"\\n' },
    });
    const parsed = JSON.parse(json);
    expect(parsed.android.channelId).toBe('he said "hi"\\n');
  });

  it('preserves unicode and emoji in serialized strings', () => {
    const json = serializeNotifeeOptions({
      ...BASE,
      android: { channelId: 'café-🚀-Ω' },
    });
    const parsed = JSON.parse(json);
    expect(parsed.android.channelId).toBe('café-🚀-Ω');
  });
});

describe('serializeData', () => {
  it('returns undefined when data is undefined', () => {
    expect(serializeData(undefined)).toBeUndefined();
  });

  it('returns undefined when data is an empty object', () => {
    expect(serializeData({})).toBeUndefined();
  });

  it('returns a JSON string when data has entries', () => {
    expect(serializeData({ a: '1', b: '2' })).toBe('{"a":"1","b":"2"}');
  });
});

describe('serializeNotifeeOptions — circular reference guard', () => {
  it('throws a clear error on circular android config', () => {
    const circular: Record<string, unknown> = { channelId: 'orders' };
    circular.self = circular;
    expect(() => serializeNotifeeOptions({ ...BASE, android: circular as never })).toThrow(
      /\[react-native-notify-kit\/server\] Serialization: notifee_options contains circular references/,
    );
  });
});
