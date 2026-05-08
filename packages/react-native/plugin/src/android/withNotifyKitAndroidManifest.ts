import type {
  AndroidForegroundServiceType,
  NormalizedAndroidForegroundServiceOptions,
} from '../options';
import type { ExpoConfigLike } from '../ios/withNotifyKitIosNseAppExtension';

export const NOTIFY_KIT_FOREGROUND_SERVICE_NAME = 'app.notifee.core.ForegroundService';
export const ANDROID_SPECIAL_USE_FGS_SUBTYPE_PROPERTY =
  'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE';

const ANDROID_FOREGROUND_SERVICE_PERMISSION = 'android.permission.FOREGROUND_SERVICE';

const ANDROID_FOREGROUND_SERVICE_TYPE_PERMISSIONS: Partial<
  Record<AndroidForegroundServiceType, string>
> = {
  camera: 'android.permission.FOREGROUND_SERVICE_CAMERA',
  connectedDevice: 'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
  dataSync: 'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
  health: 'android.permission.FOREGROUND_SERVICE_HEALTH',
  location: 'android.permission.FOREGROUND_SERVICE_LOCATION',
  mediaPlayback: 'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  mediaProjection: 'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
  microphone: 'android.permission.FOREGROUND_SERVICE_MICROPHONE',
  phoneCall: 'android.permission.FOREGROUND_SERVICE_PHONE_CALL',
  remoteMessaging: 'android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING',
  specialUse: 'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  systemExempted: 'android.permission.FOREGROUND_SERVICE_SYSTEM_EXEMPTED',
};

type AndroidManifestAttributes = Record<string, string | undefined>;

export interface AndroidManifestPermission {
  $?: AndroidManifestAttributes;
  [key: string]: unknown;
}

export interface AndroidManifestProperty {
  $?: AndroidManifestAttributes;
  [key: string]: unknown;
}

export interface AndroidManifestService {
  $?: AndroidManifestAttributes;
  property?: AndroidManifestProperty[];
  [key: string]: unknown;
}

export interface AndroidManifestApplication {
  service?: AndroidManifestService[];
  [key: string]: unknown;
}

export interface AndroidManifest {
  manifest?: {
    $?: AndroidManifestAttributes;
    'uses-permission'?: AndroidManifestPermission[];
    application?: AndroidManifestApplication[];
    [key: string]: unknown;
  };
}

type AndroidManifestModConfig<TConfig extends ExpoConfigLike> = TConfig & {
  modResults: AndroidManifest;
};

type WithAndroidManifest = <TConfig extends ExpoConfigLike>(
  config: TConfig,
  action: (
    config: AndroidManifestModConfig<TConfig>,
  ) => AndroidManifestModConfig<TConfig> | Promise<AndroidManifestModConfig<TConfig>>,
) => TConfig;

declare const require: {
  (id: string): unknown;
  resolve(id: string, options?: { paths?: string[] }): string;
};

declare const process: {
  cwd(): string;
};

export function withNotifyKitAndroidManifest<TConfig extends ExpoConfigLike>(
  config: TConfig,
  foregroundServiceOptions: NormalizedAndroidForegroundServiceOptions,
): TConfig {
  if (!foregroundServiceOptions.enabled) {
    return config;
  }

  const { withAndroidManifest } = requireExpoConfigPlugins();

  return withAndroidManifest(config, modConfig => {
    applyNotifyKitAndroidForegroundServiceManifest(modConfig.modResults, foregroundServiceOptions);

    return modConfig;
  });
}

export function applyNotifyKitAndroidForegroundServiceManifest(
  androidManifest: AndroidManifest,
  foregroundServiceOptions: NormalizedAndroidForegroundServiceOptions,
): AndroidManifest {
  ensurePermission(androidManifest, ANDROID_FOREGROUND_SERVICE_PERMISSION);

  for (const permission of resolveTypeSpecificPermissions(foregroundServiceOptions.types)) {
    ensurePermission(androidManifest, permission);
  }

  const application = ensureMainApplication(androidManifest);
  const service = ensureNotifyKitForegroundService(application);
  service.$ = {
    ...service.$,
    'android:name': NOTIFY_KIT_FOREGROUND_SERVICE_NAME,
    'android:exported': 'false',
    'android:foregroundServiceType': foregroundServiceOptions.types.join('|'),
  };

  if (foregroundServiceOptions.types.includes('specialUse')) {
    if (foregroundServiceOptions.specialUseSubtype === undefined) {
      throw new Error(
        '[react-native-notify-kit] android.foregroundService.specialUseSubtype is required when types includes specialUse.',
      );
    }

    upsertSpecialUseProperty(service, foregroundServiceOptions.specialUseSubtype);
  } else {
    removeSpecialUseProperty(service);
  }

  return androidManifest;
}

export function resolveTypeSpecificPermissions(types: AndroidForegroundServiceType[]): string[] {
  const permissions: string[] = [];

  for (const type of types) {
    const permission = ANDROID_FOREGROUND_SERVICE_TYPE_PERMISSIONS[type];
    if (permission !== undefined && !permissions.includes(permission)) {
      permissions.push(permission);
    }
  }

  return permissions;
}

function ensurePermission(androidManifest: AndroidManifest, permissionName: string): void {
  const manifest = ensureManifestRoot(androidManifest);
  const permissions = ensureArrayProperty(
    manifest,
    'uses-permission',
    '[react-native-notify-kit] AndroidManifest.xml uses-permission must be an array.',
  );

  const hasPermission = permissions.some(
    permission => permission.$?.['android:name'] === permissionName,
  );

  if (!hasPermission) {
    permissions.push({
      $: {
        'android:name': permissionName,
      },
    });
  }
}

function ensureMainApplication(androidManifest: AndroidManifest): AndroidManifestApplication {
  const manifest = ensureManifestRoot(androidManifest);
  const applications = ensureArrayProperty(
    manifest,
    'application',
    '[react-native-notify-kit] AndroidManifest.xml application must be an array.',
  );

  if (applications.length === 0) {
    applications.push({});
  }

  return applications[0];
}

function ensureNotifyKitForegroundService(
  application: AndroidManifestApplication,
): AndroidManifestService {
  const services = ensureArrayProperty(
    application,
    'service',
    '[react-native-notify-kit] AndroidManifest.xml application.service must be an array.',
  );
  const existingService = services.find(
    service => service.$?.['android:name'] === NOTIFY_KIT_FOREGROUND_SERVICE_NAME,
  );

  if (existingService !== undefined) {
    return existingService;
  }

  const service: AndroidManifestService = {
    $: {
      'android:name': NOTIFY_KIT_FOREGROUND_SERVICE_NAME,
    },
  };
  services.push(service);

  return service;
}

function upsertSpecialUseProperty(service: AndroidManifestService, subtype: string): void {
  const properties = ensureArrayProperty(
    service,
    'property',
    '[react-native-notify-kit] AndroidManifest.xml service.property must be an array.',
  );
  const existingProperty = properties.find(
    property => property.$?.['android:name'] === ANDROID_SPECIAL_USE_FGS_SUBTYPE_PROPERTY,
  );

  if (existingProperty !== undefined) {
    existingProperty.$ = {
      ...existingProperty.$,
      'android:name': ANDROID_SPECIAL_USE_FGS_SUBTYPE_PROPERTY,
      'android:value': subtype,
    };
    return;
  }

  properties.push({
    $: {
      'android:name': ANDROID_SPECIAL_USE_FGS_SUBTYPE_PROPERTY,
      'android:value': subtype,
    },
  });
}

function removeSpecialUseProperty(service: AndroidManifestService): void {
  if (service.property === undefined) {
    return;
  }

  service.property = service.property.filter(
    property => property.$?.['android:name'] !== ANDROID_SPECIAL_USE_FGS_SUBTYPE_PROPERTY,
  );

  if (service.property.length === 0) {
    delete service.property;
  }
}

function ensureManifestRoot(
  androidManifest: AndroidManifest,
): NonNullable<AndroidManifest['manifest']> {
  if (androidManifest.manifest === undefined) {
    androidManifest.manifest = {};
  }

  return androidManifest.manifest;
}

function ensureArrayProperty<
  TObject extends Record<string, unknown>,
  TKey extends keyof TObject & string,
  TItem,
>(object: TObject, key: TKey, errorMessage: string): TItem[] {
  const value = object[key];

  if (value === undefined) {
    const nextValue: TItem[] = [];
    object[key] = nextValue as TObject[TKey];
    return nextValue;
  }

  if (!Array.isArray(value)) {
    throw new Error(errorMessage);
  }

  return value as TItem[];
}

function requireExpoConfigPlugins(): {
  withAndroidManifest: WithAndroidManifest;
} {
  try {
    return require('expo/config-plugins') as ReturnType<typeof requireExpoConfigPlugins>;
  } catch (error) {
    try {
      const expoConfigPluginsPath = require.resolve('expo/config-plugins', {
        paths: [process.cwd()],
      });

      return require(expoConfigPluginsPath) as ReturnType<typeof requireExpoConfigPlugins>;
    } catch {
      throw error;
    }
  }
}
