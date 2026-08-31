import * as path from 'path';

export const DEFAULT_IOS_NSE_TARGET_NAME = 'NotifyKitNSE';
export const DEFAULT_IOS_NSE_BUNDLE_SUFFIX = '.NotifyKitNSE';

export const ANDROID_FOREGROUND_SERVICE_TYPES = [
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
] as const;

const TARGET_NAME_PATTERN = /^[A-Za-z0-9_\-.]+$/;
const BUNDLE_SUFFIX_PATTERN = /^\.[A-Za-z0-9\-.]+$/;
const ANDROID_RESOURCE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

export interface NotifyKitPluginOptions {
  ios?: {
    notificationServiceExtension?: IosNotificationServiceExtensionInput;
  };
  android?: {
    foregroundService?: AndroidForegroundServiceInput;
    icons?: AndroidNotificationIconInput[];
  };
}

export type IosNotificationServiceExtensionInput =
  | boolean
  | {
      enabled?: boolean;
      targetName?: string;
      bundleSuffix?: string;
    };

export interface AndroidForegroundServiceInput {
  types?: unknown;
  specialUseSubtype?: unknown;
}

export interface AndroidNotificationIconInput {
  name: string;
  path: string;
  type: 'small';
}

export type AndroidForegroundServiceType = (typeof ANDROID_FOREGROUND_SERVICE_TYPES)[number];

export interface NormalizedNotifyKitPluginOptions {
  ios: {
    notificationServiceExtension: NormalizedIosNotificationServiceExtensionOptions;
  };
  android: {
    foregroundService: NormalizedAndroidForegroundServiceOptions;
    icons: NormalizedAndroidNotificationIconOptions[];
  };
}

export interface NormalizedIosNotificationServiceExtensionOptions {
  enabled: boolean;
  targetName: string;
  bundleSuffix: string;
}

export interface NormalizedAndroidForegroundServiceOptions {
  enabled: boolean;
  types: AndroidForegroundServiceType[];
  specialUseSubtype?: string;
}

export type NormalizedAndroidNotificationIconOptions = AndroidNotificationIconInput;

export function normalizeNotifyKitPluginOptions(
  options: NotifyKitPluginOptions = {},
): NormalizedNotifyKitPluginOptions {
  return {
    ios: {
      notificationServiceExtension: normalizeIosNotificationServiceExtensionOptions(
        options.ios?.notificationServiceExtension,
      ),
    },
    android: {
      foregroundService: normalizeAndroidForegroundServiceOptions(
        options.android?.foregroundService,
      ),
      icons: normalizeAndroidNotificationIcons(options.android?.icons),
    },
  };
}

export function normalizeIosNotificationServiceExtensionOptions(
  input?: IosNotificationServiceExtensionInput,
): NormalizedIosNotificationServiceExtensionOptions {
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

function disabledIosNotificationServiceExtensionOptions(): NormalizedIosNotificationServiceExtensionOptions {
  return {
    enabled: false,
    targetName: DEFAULT_IOS_NSE_TARGET_NAME,
    bundleSuffix: DEFAULT_IOS_NSE_BUNDLE_SUFFIX,
  };
}

function validateEnabledIosNotificationServiceExtensionOptions(
  options: NormalizedIosNotificationServiceExtensionOptions,
): NormalizedIosNotificationServiceExtensionOptions {
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

export function normalizeAndroidForegroundServiceOptions(
  input?: AndroidForegroundServiceInput,
): NormalizedAndroidForegroundServiceOptions {
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

export function normalizeAndroidNotificationIcons(
  input?: unknown,
): NormalizedAndroidNotificationIconOptions[] {
  if (input === undefined) {
    return [];
  }

  if (!Array.isArray(input)) {
    throw new Error('[react-native-notify-kit] android.icons must be an array.');
  }

  const names = new Set<string>();
  const icons: NormalizedAndroidNotificationIconOptions[] = [];

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

function disabledAndroidForegroundServiceOptions(): NormalizedAndroidForegroundServiceOptions {
  return {
    enabled: false,
    types: [],
  };
}

function normalizeAndroidForegroundServiceTypes(input: unknown): AndroidForegroundServiceType[] {
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

  const seen = new Set<AndroidForegroundServiceType>();
  const types: AndroidForegroundServiceType[] = [];

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

function normalizeSpecialUseSubtype(input: unknown): string | undefined {
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

function isAndroidForegroundServiceType(value: string): value is AndroidForegroundServiceType {
  return ANDROID_FOREGROUND_SERVICE_TYPES.includes(value as AndroidForegroundServiceType);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
