import {
  DEFAULT_IOS_NSE_BUNDLE_SUFFIX,
  DEFAULT_IOS_NSE_TARGET_NAME,
  normalizeAndroidForegroundServiceOptions,
  normalizeAndroidNotificationIcons,
  normalizeIosNotificationServiceExtensionOptions,
  normalizeNotifyKitPluginOptions,
} from '../options';

const VALID_ANDROID_NOTIFICATION_ICON = {
  name: 'notification_message',
  path: './assets/notification-icon.png',
  type: 'small',
} as const;

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
        icons: [],
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

  it('normalizes missing Android notification icons as an empty array', () => {
    expect(normalizeAndroidNotificationIcons()).toEqual([]);
  });

  it('normalizes an empty Android notification icons array as an empty array', () => {
    expect(normalizeAndroidNotificationIcons([])).toEqual([]);
  });

  it('normalizes one valid Android notification icon', () => {
    expect(normalizeAndroidNotificationIcons([VALID_ANDROID_NOTIFICATION_ICON])).toEqual([
      VALID_ANDROID_NOTIFICATION_ICON,
    ]);
  });

  it('preserves multiple Android notification icons in configured order', () => {
    expect(
      normalizeAndroidNotificationIcons([
        VALID_ANDROID_NOTIFICATION_ICON,
        {
          name: 'notification_warning',
          path: './assets/notification-warning.png',
          type: 'small',
        },
      ]),
    ).toEqual([
      VALID_ANDROID_NOTIFICATION_ICON,
      {
        name: 'notification_warning',
        path: './assets/notification-warning.png',
        type: 'small',
      },
    ]);
  });

  it('does not mutate Android notification icon input', () => {
    const input = [
      {
        ...VALID_ANDROID_NOTIFICATION_ICON,
      },
    ];
    const before = JSON.stringify(input);
    const normalized = normalizeAndroidNotificationIcons(input);

    expect(JSON.stringify(input)).toBe(before);
    expect(normalized).not.toBe(input);
    expect(normalized[0]).not.toBe(input[0]);
  });

  it('rejects a non-array Android notification icons value', () => {
    expect(() => normalizeAndroidNotificationIcons({})).toThrow(/android\.icons must be an array/);
  });

  it.each([null, 'notification_message', []])(
    'rejects a non-object Android notification icon entry %#',
    entry => {
      expect(() => normalizeAndroidNotificationIcons([entry])).toThrow(
        /android\.icons\[0\] must be an object/,
      );
    },
  );

  it('rejects a missing Android notification icon name', () => {
    expect(() =>
      normalizeAndroidNotificationIcons([
        {
          path: VALID_ANDROID_NOTIFICATION_ICON.path,
          type: VALID_ANDROID_NOTIFICATION_ICON.type,
        },
      ]),
    ).toThrow(/android\.icons\[0\]\.name must be a non-empty string/);
  });

  it('rejects a non-string Android notification icon name', () => {
    expect(() =>
      normalizeAndroidNotificationIcons([
        {
          ...VALID_ANDROID_NOTIFICATION_ICON,
          name: 42,
        },
      ]),
    ).toThrow(/android\.icons\[0\]\.name must be a non-empty string/);
  });

  it('rejects an empty Android notification icon name', () => {
    expect(() =>
      normalizeAndroidNotificationIcons([
        {
          ...VALID_ANDROID_NOTIFICATION_ICON,
          name: '',
        },
      ]),
    ).toThrow(/android\.icons\[0\]\.name must be a non-empty string/);
  });

  it.each([
    'Notification_message',
    'notification-message',
    'notification_message.png',
    'drawable/notification_message',
    '@drawable/notification_message',
    '1_notification_message',
  ])('rejects invalid Android notification resource name %s', name => {
    expect(() =>
      normalizeAndroidNotificationIcons([
        {
          ...VALID_ANDROID_NOTIFICATION_ICON,
          name,
        },
      ]),
    ).toThrow(/Invalid android\.icons\[0\]\.name/);
  });

  it('rejects a missing Android notification icon path', () => {
    expect(() =>
      normalizeAndroidNotificationIcons([
        {
          name: VALID_ANDROID_NOTIFICATION_ICON.name,
          type: VALID_ANDROID_NOTIFICATION_ICON.type,
        },
      ]),
    ).toThrow(/android\.icons\[0\]\.path must be a non-empty string/);
  });

  it('rejects a non-string Android notification icon path', () => {
    expect(() =>
      normalizeAndroidNotificationIcons([
        {
          ...VALID_ANDROID_NOTIFICATION_ICON,
          path: 42,
        },
      ]),
    ).toThrow(/android\.icons\[0\]\.path must be a non-empty string/);
  });

  it('rejects an empty Android notification icon path', () => {
    expect(() =>
      normalizeAndroidNotificationIcons([
        {
          ...VALID_ANDROID_NOTIFICATION_ICON,
          path: '',
        },
      ]),
    ).toThrow(/android\.icons\[0\]\.path must be a non-empty string/);
  });

  it('rejects an absolute Android notification icon path', () => {
    expect(() =>
      normalizeAndroidNotificationIcons([
        {
          ...VALID_ANDROID_NOTIFICATION_ICON,
          path: '/tmp/notification-icon.png',
        },
      ]),
    ).toThrow(/android\.icons\[0\]\.path must be project-relative/);
  });

  it('rejects a publicly unsupported Android notification icon source format', () => {
    expect(() =>
      normalizeAndroidNotificationIcons([
        {
          ...VALID_ANDROID_NOTIFICATION_ICON,
          path: './assets/notification-icon.jpg',
        },
      ]),
    ).toThrow(/android\.icons\[0\]\.path must reference a lowercase \.png file/);
  });

  it('rejects a missing Android notification icon type', () => {
    expect(() =>
      normalizeAndroidNotificationIcons([
        {
          name: VALID_ANDROID_NOTIFICATION_ICON.name,
          path: VALID_ANDROID_NOTIFICATION_ICON.path,
        },
      ]),
    ).toThrow(/android\.icons\[0\]\.type must be the string 'small'/);
  });

  it('rejects a non-string Android notification icon type', () => {
    expect(() =>
      normalizeAndroidNotificationIcons([
        {
          ...VALID_ANDROID_NOTIFICATION_ICON,
          type: true,
        },
      ]),
    ).toThrow(/android\.icons\[0\]\.type must be the string 'small'/);
  });

  it('rejects an unsupported Android notification icon type', () => {
    expect(() =>
      normalizeAndroidNotificationIcons([
        {
          ...VALID_ANDROID_NOTIFICATION_ICON,
          type: 'large',
        },
      ]),
    ).toThrow(/android\.icons\[0\]\.type 'large' is unsupported/);
  });

  it('rejects duplicate Android notification icon names', () => {
    expect(() =>
      normalizeAndroidNotificationIcons([
        VALID_ANDROID_NOTIFICATION_ICON,
        {
          ...VALID_ANDROID_NOTIFICATION_ICON,
          path: './assets/notification-icon-alternate.png',
        },
      ]),
    ).toThrow(/Duplicate android\.icons name 'notification_message'/);
  });
});
