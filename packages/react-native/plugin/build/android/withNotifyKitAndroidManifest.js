'use strict';

const NOTIFY_KIT_FOREGROUND_SERVICE_NAME = 'app.notifee.core.ForegroundService';
const ANDROID_SPECIAL_USE_FGS_SUBTYPE_PROPERTY =
  'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE';

const ANDROID_FOREGROUND_SERVICE_PERMISSION = 'android.permission.FOREGROUND_SERVICE';

const ANDROID_FOREGROUND_SERVICE_TYPE_PERMISSIONS = {
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

function withNotifyKitAndroidManifest(config, foregroundServiceOptions) {
  if (!foregroundServiceOptions.enabled) {
    return config;
  }

  const { withAndroidManifest } = requireExpoConfigPlugins();

  return withAndroidManifest(config, modConfig => {
    applyNotifyKitAndroidForegroundServiceManifest(
      modConfig.modResults,
      foregroundServiceOptions,
    );

    return modConfig;
  });
}

function applyNotifyKitAndroidForegroundServiceManifest(
  androidManifest,
  foregroundServiceOptions,
) {
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

function resolveTypeSpecificPermissions(types) {
  const permissions = [];

  for (const type of types) {
    const permission = ANDROID_FOREGROUND_SERVICE_TYPE_PERMISSIONS[type];
    if (permission !== undefined && !permissions.includes(permission)) {
      permissions.push(permission);
    }
  }

  return permissions;
}

function ensurePermission(androidManifest, permissionName) {
  const manifest = ensureManifestRoot(androidManifest);
  const permissions = ensureArrayProperty(
    manifest,
    'uses-permission',
    '[react-native-notify-kit] AndroidManifest.xml uses-permission must be an array.',
  );

  const hasPermission = permissions.some(
    permission => permission.$ && permission.$['android:name'] === permissionName,
  );

  if (!hasPermission) {
    permissions.push({
      $: {
        'android:name': permissionName,
      },
    });
  }
}

function ensureMainApplication(androidManifest) {
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

function ensureNotifyKitForegroundService(application) {
  const services = ensureArrayProperty(
    application,
    'service',
    '[react-native-notify-kit] AndroidManifest.xml application.service must be an array.',
  );
  const existingService = services.find(
    service =>
      service.$ && service.$['android:name'] === NOTIFY_KIT_FOREGROUND_SERVICE_NAME,
  );

  if (existingService !== undefined) {
    return existingService;
  }

  const service = {
    $: {
      'android:name': NOTIFY_KIT_FOREGROUND_SERVICE_NAME,
    },
  };
  services.push(service);

  return service;
}

function upsertSpecialUseProperty(service, subtype) {
  const properties = ensureArrayProperty(
    service,
    'property',
    '[react-native-notify-kit] AndroidManifest.xml service.property must be an array.',
  );
  const existingProperty = properties.find(
    property =>
      property.$ &&
      property.$['android:name'] === ANDROID_SPECIAL_USE_FGS_SUBTYPE_PROPERTY,
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

function removeSpecialUseProperty(service) {
  if (service.property === undefined) {
    return;
  }

  service.property = service.property.filter(
    property =>
      property.$ &&
      property.$['android:name'] !== ANDROID_SPECIAL_USE_FGS_SUBTYPE_PROPERTY,
  );

  if (service.property.length === 0) {
    delete service.property;
  }
}

function ensureManifestRoot(androidManifest) {
  if (androidManifest.manifest === undefined) {
    androidManifest.manifest = {};
  }

  return androidManifest.manifest;
}

function ensureArrayProperty(object, key, errorMessage) {
  const value = object[key];

  if (value === undefined) {
    const nextValue = [];
    object[key] = nextValue;
    return nextValue;
  }

  if (!Array.isArray(value)) {
    throw new Error(errorMessage);
  }

  return value;
}

function requireExpoConfigPlugins() {
  try {
    return require('expo/config-plugins');
  } catch (error) {
    try {
      return require(require.resolve('expo/config-plugins', { paths: [process.cwd()] }));
    } catch {
      throw error;
    }
  }
}

module.exports = {
  NOTIFY_KIT_FOREGROUND_SERVICE_NAME,
  ANDROID_SPECIAL_USE_FGS_SUBTYPE_PROPERTY,
  withNotifyKitAndroidManifest,
  applyNotifyKitAndroidForegroundServiceManifest,
  resolveTypeSpecificPermissions,
};
