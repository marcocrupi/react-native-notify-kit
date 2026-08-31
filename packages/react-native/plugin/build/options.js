'use strict';

const path = require('path');

const DEFAULT_IOS_NSE_TARGET_NAME = 'NotifyKitNSE';
const DEFAULT_IOS_NSE_BUNDLE_SUFFIX = '.NotifyKitNSE';

const ANDROID_FOREGROUND_SERVICE_TYPES = [
  'camera',
  'connectedDevice',
  'dataSync',
  'health',
  'location',
  'mediaPlayback',
  'mediaProjection',
  'microphone',
  'phoneCall',
  'remoteMessaging',
  'shortService',
  'specialUse',
  'systemExempted',
];

const TARGET_NAME_PATTERN = /^[A-Za-z0-9_\-.]+$/;
const BUNDLE_SUFFIX_PATTERN = /^\.[A-Za-z0-9\-.]+$/;
const ANDROID_RESOURCE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

function normalizeNotifyKitPluginOptions(options = {}) {
  return {
    ios: {
      notificationServiceExtension: normalizeIosNotificationServiceExtensionOptions(
        options.ios && options.ios.notificationServiceExtension,
      ),
    },
    android: {
      foregroundService: normalizeAndroidForegroundServiceOptions(
        options.android && options.android.foregroundService,
      ),
      icons: normalizeAndroidNotificationIcons(options.android && options.android.icons),
    },
  };
}

function normalizeIosNotificationServiceExtensionOptions(input) {
  if (input === undefined || input === false) {
    return disabledIosNotificationServiceExtensionOptions();
  }

  if (input === true) {
    return validateEnabledIosNotificationServiceExtensionOptions({
      enabled: true,
      targetName: DEFAULT_IOS_NSE_TARGET_NAME,
      bundleSuffix: DEFAULT_IOS_NSE_BUNDLE_SUFFIX,
    });
  }

  if (!isPlainObject(input)) {
    throw new Error(
      '[react-native-notify-kit] ios.notificationServiceExtension must be a boolean or an object.',
    );
  }

  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    throw new Error(
      '[react-native-notify-kit] ios.notificationServiceExtension.enabled must be a boolean.',
    );
  }

  if (input.enabled !== true) {
    return disabledIosNotificationServiceExtensionOptions();
  }

  return validateEnabledIosNotificationServiceExtensionOptions({
    enabled: true,
    targetName: input.targetName ?? DEFAULT_IOS_NSE_TARGET_NAME,
    bundleSuffix: input.bundleSuffix ?? DEFAULT_IOS_NSE_BUNDLE_SUFFIX,
  });
}

function disabledIosNotificationServiceExtensionOptions() {
  return {
    enabled: false,
    targetName: DEFAULT_IOS_NSE_TARGET_NAME,
    bundleSuffix: DEFAULT_IOS_NSE_BUNDLE_SUFFIX,
  };
}

function validateEnabledIosNotificationServiceExtensionOptions(options) {
  if (typeof options.targetName !== 'string' || options.targetName.length === 0) {
    throw new Error(
      '[react-native-notify-kit] ios.notificationServiceExtension.targetName must be a non-empty string.',
    );
  }

  if (!TARGET_NAME_PATTERN.test(options.targetName)) {
    throw new Error(
      `[react-native-notify-kit] Invalid notification service extension targetName '${options.targetName}'. ` +
        'Use only letters, digits, underscores, hyphens, and dots.',
    );
  }

  if (typeof options.bundleSuffix !== 'string' || options.bundleSuffix.length === 0) {
    throw new Error(
      '[react-native-notify-kit] ios.notificationServiceExtension.bundleSuffix must be a non-empty string.',
    );
  }

  if (!BUNDLE_SUFFIX_PATTERN.test(options.bundleSuffix)) {
    throw new Error(
      `[react-native-notify-kit] Invalid notification service extension bundleSuffix '${options.bundleSuffix}'. ` +
        "It must start with '.' and contain only letters, digits, hyphens, and dots.",
    );
  }

  return options;
}

function normalizeAndroidForegroundServiceOptions(input) {
  if (input === undefined) {
    return disabledAndroidForegroundServiceOptions();
  }

  if (!isPlainObject(input)) {
    throw new Error(
      '[react-native-notify-kit] android.foregroundService must be an object with a non-empty types array.',
    );
  }

  const types = normalizeAndroidForegroundServiceTypes(input.types);
  const specialUseSubtype = normalizeSpecialUseSubtype(input.specialUseSubtype);
  const hasSpecialUse = types.includes('specialUse');

  if (hasSpecialUse && specialUseSubtype === undefined) {
    throw new Error(
      '[react-native-notify-kit] android.foregroundService.specialUseSubtype must be a non-empty string when types includes specialUse.',
    );
  }

  if (!hasSpecialUse && specialUseSubtype !== undefined) {
    throw new Error(
      '[react-native-notify-kit] android.foregroundService.specialUseSubtype requires types to include specialUse.',
    );
  }

  return {
    enabled: true,
    types,
    ...(specialUseSubtype === undefined ? {} : { specialUseSubtype }),
  };
}

function disabledAndroidForegroundServiceOptions() {
  return {
    enabled: false,
    types: [],
  };
}

function normalizeAndroidNotificationIcons(input) {
  if (input === undefined) {
    return [];
  }

  if (!Array.isArray(input)) {
    throw new Error('[react-native-notify-kit] android.icons must be an array.');
  }

  const names = new Set();
  const icons = [];

  for (const [index, value] of input.entries()) {
    if (!isPlainObject(value)) {
      throw new Error(`[react-native-notify-kit] android.icons[${index}] must be an object.`);
    }

    if (typeof value.name !== 'string' || value.name.trim().length === 0) {
      throw new Error(
        `[react-native-notify-kit] android.icons[${index}].name must be a non-empty string.`,
      );
    }

    if (!ANDROID_RESOURCE_NAME_PATTERN.test(value.name)) {
      throw new Error(
        `[react-native-notify-kit] Invalid android.icons[${index}].name '${value.name}'. ` +
          'It must start with a lowercase letter and contain only lowercase letters, digits, and underscores.',
      );
    }

    if (typeof value.path !== 'string' || value.path.trim().length === 0) {
      throw new Error(
        `[react-native-notify-kit] android.icons[${index}].path must be a non-empty string.`,
      );
    }

    if (path.isAbsolute(value.path) || path.win32.isAbsolute(value.path)) {
      throw new Error(
        `[react-native-notify-kit] android.icons[${index}].path must be project-relative.`,
      );
    }

    if (path.extname(value.path) !== '.png') {
      throw new Error(
        `[react-native-notify-kit] android.icons[${index}].path must reference a lowercase .png file.`,
      );
    }

    if (typeof value.type !== 'string') {
      throw new Error(
        `[react-native-notify-kit] android.icons[${index}].type must be the string 'small'.`,
      );
    }

    if (value.type !== 'small') {
      throw new Error(
        `[react-native-notify-kit] android.icons[${index}].type '${value.type}' is unsupported. ` +
          "Only 'small' is supported.",
      );
    }

    if (names.has(value.name)) {
      throw new Error(
        `[react-native-notify-kit] Duplicate android.icons name '${value.name}'. ` +
          'Each Android notification icon name must be unique.',
      );
    }

    names.add(value.name);
    icons.push({
      name: value.name,
      path: value.path,
      type: value.type,
    });
  }

  return icons;
}

function normalizeAndroidForegroundServiceTypes(input) {
  if (!Array.isArray(input)) {
    throw new Error(
      '[react-native-notify-kit] android.foregroundService.types must be a non-empty array.',
    );
  }

  if (input.length === 0) {
    throw new Error(
      '[react-native-notify-kit] android.foregroundService.types must be a non-empty array.',
    );
  }

  const seen = new Set();
  const types = [];

  for (const value of input) {
    if (typeof value !== 'string') {
      throw new Error(
        '[react-native-notify-kit] android.foregroundService.types must contain only strings.',
      );
    }

    const type = value.trim();
    if (!isAndroidForegroundServiceType(type)) {
      throw new Error(
        `[react-native-notify-kit] Invalid android.foregroundService type '${value}'. ` +
          `Allowed values: ${ANDROID_FOREGROUND_SERVICE_TYPES.join(', ')}.`,
      );
    }

    if (!seen.has(type)) {
      seen.add(type);
      types.push(type);
    }
  }

  return types;
}

function normalizeSpecialUseSubtype(input) {
  if (input === undefined) {
    return undefined;
  }

  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new Error(
      '[react-native-notify-kit] android.foregroundService.specialUseSubtype must be a non-empty string.',
    );
  }

  return input.trim();
}

function isAndroidForegroundServiceType(value) {
  return ANDROID_FOREGROUND_SERVICE_TYPES.includes(value);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

module.exports = {
  DEFAULT_IOS_NSE_TARGET_NAME,
  DEFAULT_IOS_NSE_BUNDLE_SUFFIX,
  ANDROID_FOREGROUND_SERVICE_TYPES,
  normalizeNotifyKitPluginOptions,
  normalizeIosNotificationServiceExtensionOptions,
  normalizeAndroidForegroundServiceOptions,
  normalizeAndroidNotificationIcons,
};
