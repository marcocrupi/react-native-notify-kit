import { serializeData, serializeNotifeeOptions } from '../serialize';

describe('serializeNotifeeOptions', () => {
  it('emits _v: 1 as the first JSON field when called with no input', () => {
    const json = serializeNotifeeOptions();
    expect(json.startsWith('{"_v":1')).toBe(true);
  });

  it('emits {"_v":1} for empty input', () => {
    expect(serializeNotifeeOptions({})).toBe('{"_v":1}');
  });

  it('keeps _v: 1 in the first position even with both platform blocks', () => {
    const json = serializeNotifeeOptions({
      android: { channelId: 'x' },
      ios: { sound: 'default' },
    });
    expect(json.startsWith('{"_v":1,')).toBe(true);
  });

  it('round-trips android and ios fields losslessly', () => {
    const json = serializeNotifeeOptions({
      android: { channelId: 'orders', smallIcon: 'ic' },
      ios: { sound: 'chime', categoryId: 'cat' },
    });
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({
      _v: 1,
      android: { channelId: 'orders', smallIcon: 'ic' },
      ios: { sound: 'chime', categoryId: 'cat' },
    });
  });

  it('escapes special characters like quotes and backslashes', () => {
    const json = serializeNotifeeOptions({
      android: { channelId: 'he said "hi"\\n' },
    });
    const parsed = JSON.parse(json);
    expect(parsed.android.channelId).toBe('he said "hi"\\n');
  });

  it('preserves unicode and emoji in serialized strings', () => {
    const json = serializeNotifeeOptions({
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
