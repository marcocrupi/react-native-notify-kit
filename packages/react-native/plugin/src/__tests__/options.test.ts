import {
  DEFAULT_IOS_NSE_BUNDLE_SUFFIX,
  DEFAULT_IOS_NSE_TARGET_NAME,
  normalizeAndroidForegroundServiceOptions,
  normalizeIosNotificationServiceExtensionOptions,
  normalizeNotifyKitPluginOptions,
} from '../options';

describe('NotifyKit Expo plugin option normalization', () => {
  it('normalizes undefined as disabled', () => {
    expect(normalizeNotifyKitPluginOptions()).toEqual({
      ios: {
        notificationServiceExtension: {
          enabled: false,
          targetName: DEFAULT_IOS_NSE_TARGET_NAME,
          bundleSuffix: DEFAULT_IOS_NSE_BUNDLE_SUFFIX,
        },
      },
      android: {
        foregroundService: {
          enabled: false,
          types: [],
        },
      },
    });
  });

  it('normalizes false as disabled', () => {
    expect(normalizeIosNotificationServiceExtensionOptions(false)).toMatchObject({
      enabled: false,
      targetName: DEFAULT_IOS_NSE_TARGET_NAME,
      bundleSuffix: DEFAULT_IOS_NSE_BUNDLE_SUFFIX,
    });
  });

  it('normalizes true alias as enabled with defaults', () => {
    expect(normalizeIosNotificationServiceExtensionOptions(true)).toEqual({
      enabled: true,
      targetName: DEFAULT_IOS_NSE_TARGET_NAME,
      bundleSuffix: DEFAULT_IOS_NSE_BUNDLE_SUFFIX,
    });
  });

  it('normalizes object config with defaults', () => {
    expect(
      normalizeIosNotificationServiceExtensionOptions({
        enabled: true,
      }),
    ).toEqual({
      enabled: true,
      targetName: DEFAULT_IOS_NSE_TARGET_NAME,
      bundleSuffix: DEFAULT_IOS_NSE_BUNDLE_SUFFIX,
    });
  });

  it('normalizes object config with custom targetName and bundleSuffix', () => {
    expect(
      normalizeIosNotificationServiceExtensionOptions({
        enabled: true,
        targetName: 'Custom.NotifyKit_NSE-1',
        bundleSuffix: '.Custom-NSE.1',
      }),
    ).toEqual({
      enabled: true,
      targetName: 'Custom.NotifyKit_NSE-1',
      bundleSuffix: '.Custom-NSE.1',
    });
  });

  it('normalizes { enabled: false } as disabled', () => {
    expect(
      normalizeIosNotificationServiceExtensionOptions({
        enabled: false,
      }),
    ).toMatchObject({
      enabled: false,
      targetName: DEFAULT_IOS_NSE_TARGET_NAME,
      bundleSuffix: DEFAULT_IOS_NSE_BUNDLE_SUFFIX,
    });
  });

  it('rejects empty targetName', () => {
    expect(() =>
      normalizeIosNotificationServiceExtensionOptions({
        enabled: true,
        targetName: '',
      }),
    ).toThrow(/targetName must be a non-empty string/);
  });

  it('rejects targetName with unsafe characters', () => {
    expect(() =>
      normalizeIosNotificationServiceExtensionOptions({
        enabled: true,
        targetName: "Foo'; system('rm -rf /'); #",
      }),
    ).toThrow(/Invalid notification service extension targetName/);
  });

  it('rejects bundleSuffix without leading dot', () => {
    expect(() =>
      normalizeIosNotificationServiceExtensionOptions({
        enabled: true,
        bundleSuffix: 'NotifyKitNSE',
      }),
    ).toThrow(/Invalid notification service extension bundleSuffix/);
  });

  it('rejects bundleSuffix with unsafe characters', () => {
    expect(() =>
      normalizeIosNotificationServiceExtensionOptions({
        enabled: true,
        bundleSuffix: '".evil"',
      }),
    ).toThrow(/Invalid notification service extension bundleSuffix/);
  });

  it('normalizes missing Android foreground service config as disabled', () => {
    expect(normalizeAndroidForegroundServiceOptions()).toEqual({
      enabled: false,
      types: [],
    });
  });

  it('normalizes Android foreground service types and deduplicates them', () => {
    expect(
      normalizeAndroidForegroundServiceOptions({
        types: ['dataSync', ' dataSync ', 'remoteMessaging'],
      }),
    ).toEqual({
      enabled: true,
      types: ['dataSync', 'remoteMessaging'],
    });
  });

  it('rejects Android foreground service boolean aliases', () => {
    expect(() => normalizeAndroidForegroundServiceOptions(true as never)).toThrow(
      /android\.foregroundService must be an object/,
    );
  });

  it('rejects empty Android foreground service types', () => {
    expect(() =>
      normalizeAndroidForegroundServiceOptions({
        types: [],
      }),
    ).toThrow(/types must be a non-empty array/);
  });

  it('rejects invalid Android foreground service types', () => {
    expect(() =>
      normalizeAndroidForegroundServiceOptions({
        types: ['shortService', 'invalidType'],
      }),
    ).toThrow(/Invalid android\.foregroundService type 'invalidType'/);
  });

  it('rejects specialUse without specialUseSubtype', () => {
    expect(() =>
      normalizeAndroidForegroundServiceOptions({
        types: ['specialUse'],
      }),
    ).toThrow(/specialUseSubtype must be a non-empty string/);
  });

  it('rejects specialUseSubtype without specialUse', () => {
    expect(() =>
      normalizeAndroidForegroundServiceOptions({
        types: ['shortService'],
        specialUseSubtype: 'Need special handling',
      }),
    ).toThrow(/specialUseSubtype requires types to include specialUse/);
  });

  it('normalizes specialUse with specialUseSubtype', () => {
    expect(
      normalizeAndroidForegroundServiceOptions({
        types: ['specialUse'],
        specialUseSubtype: ' User-visible special use case ',
      }),
    ).toEqual({
      enabled: true,
      types: ['specialUse'],
      specialUseSubtype: 'User-visible special use case',
    });
  });
});
