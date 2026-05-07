import {
  resolveNotifyKitIosNseBundleIdentifier,
  upsertNotifyKitIosNseAppExtension,
  withNotifyKitIosNseAppExtension,
} from '../ios/withNotifyKitIosNseAppExtension';

const enabledOptions = {
  enabled: true,
  targetName: 'NotifyKitNSE',
  bundleSuffix: '.NotifyKitNSE',
};

describe('NotifyKit Expo EAS appExtensions config', () => {
  it('throws when ios.bundleIdentifier is missing and NSE is enabled', () => {
    expect(() => withNotifyKitIosNseAppExtension({}, enabledOptions)).toThrow(
      /ios.bundleIdentifier is required/,
    );
  });

  it('leaves config unchanged when NSE is disabled', () => {
    const config = {};

    expect(
      withNotifyKitIosNseAppExtension(config, {
        ...enabledOptions,
        enabled: false,
      }),
    ).toBe(config);
  });

  it('upserts appExtensions from an empty config', () => {
    const config = withNotifyKitIosNseAppExtension(
      {
        ios: {
          bundleIdentifier: 'com.notifykit.exposmoke',
        },
      },
      enabledOptions,
    );

    expect(config.extra?.eas.build.experimental.ios.appExtensions).toEqual([
      {
        targetName: 'NotifyKitNSE',
        bundleIdentifier: 'com.notifykit.exposmoke.NotifyKitNSE',
      },
    ]);
  });

  it('resolves the same bundleIdentifier used for the EAS appExtension config', () => {
    expect(
      resolveNotifyKitIosNseBundleIdentifier(
        {
          ios: {
            bundleIdentifier: 'com.notifykit.exposmoke',
          },
        },
        enabledOptions,
      ),
    ).toBe('com.notifykit.exposmoke.NotifyKitNSE');
  });

  it('keeps an existing matching appExtension idempotent', () => {
    const appExtensions = upsertNotifyKitIosNseAppExtension(
      [
        {
          targetName: 'NotifyKitNSE',
          bundleIdentifier: 'com.example.app.NotifyKitNSE',
        },
      ],
      {
        targetName: 'NotifyKitNSE',
        bundleIdentifier: 'com.example.app.NotifyKitNSE',
      },
    );

    expect(appExtensions).toEqual([
      {
        targetName: 'NotifyKitNSE',
        bundleIdentifier: 'com.example.app.NotifyKitNSE',
      },
    ]);
  });

  it('preserves unrelated appExtensions', () => {
    const existingExtension = {
      targetName: 'ShareExtension',
      bundleIdentifier: 'com.example.app.ShareExtension',
    };

    const appExtensions = upsertNotifyKitIosNseAppExtension([existingExtension], {
      targetName: 'NotifyKitNSE',
      bundleIdentifier: 'com.example.app.NotifyKitNSE',
    });

    expect(appExtensions).toEqual([
      existingExtension,
      {
        targetName: 'NotifyKitNSE',
        bundleIdentifier: 'com.example.app.NotifyKitNSE',
      },
    ]);
  });

  it('throws when the same targetName has a different bundleIdentifier', () => {
    expect(() =>
      upsertNotifyKitIosNseAppExtension(
        [
          {
            targetName: 'NotifyKitNSE',
            bundleIdentifier: 'com.example.app.OldNSE',
          },
        ],
        {
          targetName: 'NotifyKitNSE',
          bundleIdentifier: 'com.example.app.NotifyKitNSE',
        },
      ),
    ).toThrow(/already uses bundleIdentifier/);
  });

  it('throws when the same bundleIdentifier has a different targetName', () => {
    expect(() =>
      upsertNotifyKitIosNseAppExtension(
        [
          {
            targetName: 'OldNSE',
            bundleIdentifier: 'com.example.app.NotifyKitNSE',
          },
        ],
        {
          targetName: 'NotifyKitNSE',
          bundleIdentifier: 'com.example.app.NotifyKitNSE',
        },
      ),
    ).toThrow(/already belongs to targetName/);
  });

  it('preserves user entitlements on a matching appExtension', () => {
    const appExtensions = upsertNotifyKitIosNseAppExtension(
      [
        {
          targetName: 'NotifyKitNSE',
          bundleIdentifier: 'com.example.app.NotifyKitNSE',
          entitlements: {
            'com.apple.security.application-groups': ['group.com.example.app'],
          },
        },
      ],
      {
        targetName: 'NotifyKitNSE',
        bundleIdentifier: 'com.example.app.NotifyKitNSE',
      },
    );

    expect(appExtensions[0].entitlements).toEqual({
      'com.apple.security.application-groups': ['group.com.example.app'],
    });
  });

  it('deduplicates repeated matching appExtensions', () => {
    const appExtensions = upsertNotifyKitIosNseAppExtension(
      [
        {
          targetName: 'NotifyKitNSE',
          bundleIdentifier: 'com.example.app.NotifyKitNSE',
        },
        {
          targetName: 'NotifyKitNSE',
          bundleIdentifier: 'com.example.app.NotifyKitNSE',
        },
      ],
      {
        targetName: 'NotifyKitNSE',
        bundleIdentifier: 'com.example.app.NotifyKitNSE',
      },
    );

    expect(appExtensions).toHaveLength(1);
  });
});
