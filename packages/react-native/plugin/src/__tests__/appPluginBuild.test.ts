import type { AndroidManifest } from '../android/withNotifyKitAndroidManifest';

function createManifest(): AndroidManifest {
  return {
    manifest: {
      application: [
        {
          service: [],
        },
      ],
    },
  };
}

describe('NotifyKit published Expo app.plugin entrypoint', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('loads plugin/build through app.plugin.js and applies the Android manifest mod', async () => {
    const withAndroidManifest = jest.fn((config, action) =>
      action({
        ...config,
        modResults: createManifest(),
      }),
    );
    const createRunOncePlugin = jest.fn(plugin => plugin);
    jest.doMock(
      'expo/config-plugins',
      () => ({
        createRunOncePlugin,
        withAndroidManifest,
      }),
      { virtual: true },
    );

    const plugin = await import('../../../app.plugin.js');
    const config = plugin.default(
      {},
      {
        android: {
          foregroundService: {
            types: ['shortService'],
          },
        },
      },
    );

    expect(createRunOncePlugin).toHaveBeenCalledTimes(1);
    expect(withAndroidManifest).toHaveBeenCalledTimes(1);
    expect(
      config.modResults.manifest.application[0].service[0].$['android:foregroundServiceType'],
    ).toBe('shortService');
  });
});
