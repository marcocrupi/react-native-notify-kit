import {
  normalizeAndroidForegroundServiceOptions,
  normalizeNotifyKitPluginOptions,
} from '../options';
import {
  ANDROID_SPECIAL_USE_FGS_SUBTYPE_PROPERTY,
  applyNotifyKitAndroidForegroundServiceManifest,
  type AndroidManifest,
  NOTIFY_KIT_FOREGROUND_SERVICE_NAME,
  resolveTypeSpecificPermissions,
  withNotifyKitAndroidManifest,
} from '../android/withNotifyKitAndroidManifest';

function createManifest(): AndroidManifest {
  return {
    manifest: {
      $: {
        xmlns: 'http://schemas.android.com/apk/res/android',
      },
      application: [
        {
          service: [],
        },
      ],
    },
  };
}

function getPermissions(manifest: AndroidManifest): string[] {
  return (
    manifest.manifest?.['uses-permission']?.map(
      permission => permission.$?.['android:name'] ?? '',
    ) ?? []
  );
}

function getNotifyKitServices(manifest: AndroidManifest) {
  return (
    manifest.manifest?.application?.[0].service?.filter(
      service => service.$?.['android:name'] === NOTIFY_KIT_FOREGROUND_SERVICE_NAME,
    ) ?? []
  );
}

function getNotifyKitService(manifest: AndroidManifest) {
  const service = getNotifyKitServices(manifest)[0];

  if (service === undefined) {
    throw new Error('Missing NotifyKit foreground service in test manifest.');
  }

  return service;
}

function countOccurrences(values: string[], value: string): number {
  return values.filter(item => item === value).length;
}

describe('NotifyKit Expo Android manifest mod', () => {
  it('leaves config unchanged when android is absent', () => {
    const config = {};
    const options = normalizeNotifyKitPluginOptions().android.foregroundService;

    expect(withNotifyKitAndroidManifest(config, options)).toBe(config);
  });

  it('leaves config unchanged when android.foregroundService is absent', () => {
    const config = {};
    const options = normalizeNotifyKitPluginOptions({ android: {} }).android.foregroundService;

    expect(withNotifyKitAndroidManifest(config, options)).toBe(config);
  });

  it('adds the foreground service with foregroundServiceType shortService', () => {
    const manifest = createManifest();

    applyNotifyKitAndroidForegroundServiceManifest(
      manifest,
      normalizeAndroidForegroundServiceOptions({
        types: ['shortService'],
      }),
    );

    expect(getNotifyKitService(manifest).$).toMatchObject({
      'android:name': NOTIFY_KIT_FOREGROUND_SERVICE_NAME,
      'android:exported': 'false',
      'android:foregroundServiceType': 'shortService',
    });
  });

  it('adds the base foreground service permission', () => {
    const manifest = createManifest();

    applyNotifyKitAndroidForegroundServiceManifest(
      manifest,
      normalizeAndroidForegroundServiceOptions({
        types: ['shortService'],
      }),
    );

    expect(getPermissions(manifest)).toContain('android.permission.FOREGROUND_SERVICE');
  });

  it('does not add a type-specific permission for shortService', () => {
    const manifest = createManifest();

    applyNotifyKitAndroidForegroundServiceManifest(
      manifest,
      normalizeAndroidForegroundServiceOptions({
        types: ['shortService'],
      }),
    );

    expect(getPermissions(manifest)).not.toContain(
      'android.permission.FOREGROUND_SERVICE_SHORT_SERVICE',
    );
    expect(resolveTypeSpecificPermissions(['shortService'])).toEqual([]);
  });

  it('adds type-specific permissions for dataSync and remoteMessaging', () => {
    const manifest = createManifest();

    applyNotifyKitAndroidForegroundServiceManifest(
      manifest,
      normalizeAndroidForegroundServiceOptions({
        types: ['dataSync', 'remoteMessaging'],
      }),
    );

    expect(getPermissions(manifest)).toEqual([
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
      'android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING',
    ]);
  });

  it('writes multiple foreground service types with the Android pipe format', () => {
    const manifest = createManifest();

    applyNotifyKitAndroidForegroundServiceManifest(
      manifest,
      normalizeAndroidForegroundServiceOptions({
        types: ['dataSync', 'remoteMessaging'],
      }),
    );

    expect(getNotifyKitService(manifest).$?.['android:foregroundServiceType']).toBe(
      'dataSync|remoteMessaging',
    );
  });

  it('deduplicates duplicated types before writing the service', () => {
    const manifest = createManifest();

    applyNotifyKitAndroidForegroundServiceManifest(
      manifest,
      normalizeAndroidForegroundServiceOptions({
        types: ['dataSync', 'dataSync', 'remoteMessaging'],
      }),
    );

    expect(getNotifyKitService(manifest).$?.['android:foregroundServiceType']).toBe(
      'dataSync|remoteMessaging',
    );
    expect(
      countOccurrences(getPermissions(manifest), 'android.permission.FOREGROUND_SERVICE_DATA_SYNC'),
    ).toBe(1);
  });

  it('adds the specialUse property when specialUse is present', () => {
    const manifest = createManifest();

    applyNotifyKitAndroidForegroundServiceManifest(
      manifest,
      normalizeAndroidForegroundServiceOptions({
        types: ['specialUse'],
        specialUseSubtype: 'User-visible special foreground service use case',
      }),
    );

    expect(getPermissions(manifest)).toContain('android.permission.FOREGROUND_SERVICE_SPECIAL_USE');
    expect(getNotifyKitService(manifest).property).toEqual([
      {
        $: {
          'android:name': ANDROID_SPECIAL_USE_FGS_SUBTYPE_PROPERTY,
          'android:value': 'User-visible special foreground service use case',
        },
      },
    ]);
  });

  it('updates an existing service instead of duplicating it', () => {
    const manifest = createManifest();
    manifest.manifest?.application?.[0].service?.push(
      {
        $: {
          'android:name': NOTIFY_KIT_FOREGROUND_SERVICE_NAME,
          'android:exported': 'true',
        },
      },
      {
        $: {
          'android:name': 'com.example.UnrelatedService',
        },
      },
    );

    applyNotifyKitAndroidForegroundServiceManifest(
      manifest,
      normalizeAndroidForegroundServiceOptions({
        types: ['shortService'],
      }),
    );

    expect(getNotifyKitServices(manifest)).toHaveLength(1);
    expect(manifest.manifest?.application?.[0].service).toHaveLength(2);
    expect(getNotifyKitService(manifest).$).toMatchObject({
      'android:exported': 'false',
      'android:foregroundServiceType': 'shortService',
    });
  });

  it('keeps the manifest patch idempotent on repeated runs', () => {
    const manifest = createManifest();
    const options = normalizeAndroidForegroundServiceOptions({
      types: ['dataSync', 'remoteMessaging'],
    });

    applyNotifyKitAndroidForegroundServiceManifest(manifest, options);
    applyNotifyKitAndroidForegroundServiceManifest(manifest, options);

    expect(getNotifyKitServices(manifest)).toHaveLength(1);
    expect(
      countOccurrences(getPermissions(manifest), 'android.permission.FOREGROUND_SERVICE'),
    ).toBe(1);
    expect(
      countOccurrences(getPermissions(manifest), 'android.permission.FOREGROUND_SERVICE_DATA_SYNC'),
    ).toBe(1);
    expect(
      countOccurrences(
        getPermissions(manifest),
        'android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING',
      ),
    ).toBe(1);
    expect(getNotifyKitService(manifest).$?.['android:foregroundServiceType']).toBe(
      'dataSync|remoteMessaging',
    );
  });

  it('registers withAndroidManifest when Android foreground service is enabled', async () => {
    jest.resetModules();
    const withAndroidManifest = jest.fn((config, action) =>
      action({
        ...config,
        modResults: createManifest(),
      }),
    );
    jest.doMock('expo/config-plugins', () => ({ withAndroidManifest }), { virtual: true });

    const { withNotifyKitAndroidManifest: withManifest } =
      await import('../android/withNotifyKitAndroidManifest');
    const config = withManifest(
      {},
      normalizeAndroidForegroundServiceOptions({
        types: ['shortService'],
      }),
    );

    expect(withAndroidManifest).toHaveBeenCalledTimes(1);
    expect(getNotifyKitService(config.modResults).$?.['android:foregroundServiceType']).toBe(
      'shortService',
    );
  });
});
