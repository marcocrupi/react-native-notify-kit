/*
 * Pure function — builds a Notification object from a parsed notifee_options
 * blob, an FCM remote message, and the current FcmConfig.
 */

import { Notification } from '../types/Notification';
import { NotificationAndroid, AndroidStyle } from '../types/NotificationAndroid';
import { NotificationIOS } from '../types/NotificationIOS';
import { isAndroid, isIOS } from '../utils';
import { isValidTimestamp } from '../validators/validate';
import type { FcmConfig, FcmRemoteMessage } from './types';
import type { ParsedPayload } from './parseFcmPayload';

const PREFIX = '[react-native-notify-kit]';
const RESERVED_DATA_KEYS = new Set(['notifee_options', 'notifee_data']);

const VALID_INTERRUPTION_LEVELS = new Set(['active', 'critical', 'passive', 'timeSensitive']);

const STYLE_TYPE_MAP: Record<string, AndroidStyle | undefined> = {
  BIG_TEXT: AndroidStyle.BIGTEXT,
  BIG_PICTURE: AndroidStyle.BIGPICTURE,
};
const ANDROID_INPUT_KEYS = new Set([
  'allowFreeFormInput',
  'allowGeneratedReplies',
  'choices',
  'editableChoices',
  'placeholder',
]);

function rejectReservedPressActionId(value: unknown, path: string): void {
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).id === '__NOTIFEE_OPT_OUT__'
  ) {
    throw new Error(`${PREFIX} ${path}.id is reserved for explicit null`);
  }
}

/**
 * Reconstructs a {@link Notification} object suitable for
 * `displayNotification` from the parsed FCM payload + config defaults.
 */
export function reconstructNotification(
  parsed: ParsedPayload | null,
  remoteMessage: FcmRemoteMessage,
  config: FcmConfig,
): Notification {
  const data = rebuildData(remoteMessage.data);

  const title =
    parsed?.title ?? remoteMessage.notification?.title ?? remoteMessage.data?.title ?? '';

  const body = parsed?.body ?? remoteMessage.notification?.body ?? remoteMessage.data?.body ?? '';

  const id =
    ((parsed as Record<string, unknown> | null)?.id as string | undefined) ??
    remoteMessage.messageId;

  const notification: Notification = {
    ...(id === undefined || id === null ? {} : { id }),
    title,
    body,
  };

  if (typeof parsed?.subtitle === 'string') {
    notification.subtitle = parsed.subtitle;
  }

  if (Object.keys(data).length > 0) {
    notification.data = data;
  }

  if (isAndroid && (parsed?.android || config.defaultChannelId || config.defaultPressAction)) {
    notification.android = buildAndroidConfig(parsed?.android, config);
  }

  if (isIOS && parsed?.ios) {
    notification.ios = buildIosConfig(parsed.ios);
  }

  return notification;
}

// ---------------------------------------------------------------------------
// Data reconstruction (Rules C6 / C7)
// ---------------------------------------------------------------------------

function rebuildData(rawData: Record<string, string> | undefined): Record<string, string> {
  if (!rawData) {
    return {};
  }

  // Start with top-level data keys (excluding reserved)
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawData)) {
    if (!RESERVED_DATA_KEYS.has(key)) {
      result[key] = value;
    }
  }

  // Merge notifee_data blob — overrides top-level on conflict (Rule C7)
  const notifeeDataRaw = rawData.notifee_data;
  if (typeof notifeeDataRaw === 'string') {
    try {
      const notifeeData = JSON.parse(notifeeDataRaw) as Record<string, string>;
      if (notifeeData && typeof notifeeData === 'object') {
        Object.assign(result, notifeeData);
      }
    } catch {
      console.warn(`${PREFIX} Failed to parse notifee_data. Using top-level data keys only.`);
    }
  }

  // Post-merge strip: notifee_data blob could contain reserved keys
  for (const key of RESERVED_DATA_KEYS) {
    delete result[key];
  }

  return result;
}

// ---------------------------------------------------------------------------
// Android config mapping
// ---------------------------------------------------------------------------

function buildAndroidConfig(
  raw: Record<string, unknown> | undefined,
  config: FcmConfig,
): NotificationAndroid {
  const android: NotificationAndroid = {};

  // channelId: payload > config default
  const channelId = raw?.channelId ?? config.defaultChannelId;
  if (typeof channelId === 'string') {
    android.channelId = channelId;
  }

  // Explicit null opts out of the body tap; only absence uses the configured default.
  const pressAction = raw?.pressAction === undefined ? config.defaultPressAction : raw.pressAction;
  rejectReservedPressActionId(pressAction, 'android.pressAction');
  if (
    pressAction === null ||
    (pressAction && typeof pressAction === 'object' && !Array.isArray(pressAction))
  ) {
    android.pressAction = pressAction as Exclude<NotificationAndroid['pressAction'], undefined>;
  }

  // Direct string copies
  if (typeof raw?.smallIcon === 'string') android.smallIcon = raw.smallIcon;
  if (typeof raw?.largeIcon === 'string') android.largeIcon = raw.largeIcon;
  if (typeof raw?.circularLargeIcon === 'boolean') {
    android.circularLargeIcon = raw.circularLargeIcon;
  }
  if (typeof raw?.color === 'string') android.color = raw.color;

  // Timestamp fields — preserve only values accepted by the canonical Android validator
  if (typeof raw?.showTimestamp === 'boolean') android.showTimestamp = raw.showTimestamp;
  if (typeof raw?.timestamp === 'number' && isValidTimestamp(raw.timestamp)) {
    android.timestamp = raw.timestamp;
  }

  // Legacy input:false means no reply. Other malformed inputs must fail here:
  // the normal validator accepts some of them as a default RemoteInput.
  if (Array.isArray(raw?.actions)) {
    android.actions = raw.actions.map((action, index) => {
      if (action === null || typeof action !== 'object' || Array.isArray(action)) {
        return action;
      }
      rejectReservedPressActionId(action.pressAction, `android.actions[${index}].pressAction`);
      const input = action.input;
      if (input === false) {
        const withoutInput = { ...action };
        delete withoutInput.input;
        return withoutInput;
      }
      if (
        input !== undefined &&
        input !== true &&
        (input === null || typeof input !== 'object' || Array.isArray(input))
      ) {
        throw new Error(`${PREFIX} android.actions[${index}].input is invalid`);
      }
      if (input !== undefined && input !== true) {
        for (const key of Object.keys(input)) {
          if (!ANDROID_INPUT_KEYS.has(key)) {
            throw new Error(`${PREFIX} android.actions[${index}].input.${key} is unsupported`);
          }
        }
      }
      return action;
    }) as NonNullable<NotificationAndroid['actions']>;
  }

  // Style — enum mapping with defense-in-depth for unknown types
  if (raw?.style && typeof raw.style === 'object') {
    const style = raw.style as Record<string, unknown>;
    if (typeof style.type === 'string') {
      const mappedType = STYLE_TYPE_MAP[style.type];
      if (mappedType !== undefined) {
        if (mappedType === AndroidStyle.BIGTEXT && typeof style.text === 'string') {
          android.style = {
            type: AndroidStyle.BIGTEXT,
            text: style.text,
            ...(typeof style.title === 'string' ? { title: style.title } : {}),
            ...(typeof style.summary === 'string' ? { summary: style.summary } : {}),
          };
        } else if (mappedType === AndroidStyle.BIGPICTURE && typeof style.picture === 'string') {
          android.style = {
            type: AndroidStyle.BIGPICTURE,
            picture: style.picture,
            ...(typeof style.title === 'string' ? { title: style.title } : {}),
            ...(typeof style.summary === 'string' ? { summary: style.summary } : {}),
            ...(style.largeIcon === null || typeof style.largeIcon === 'string'
              ? { largeIcon: style.largeIcon }
              : {}),
          };
        } else {
          const field = mappedType === AndroidStyle.BIGTEXT ? 'text' : 'picture';
          console.warn(
            `${PREFIX} android.style.type '${style.type}' present but required '${field}' field missing or not a string. Style ignored.`,
          );
        }
      } else {
        console.warn(`${PREFIX} Unknown android.style.type '${style.type}'. Style ignored.`);
      }
    }
  }

  return android;
}

// ---------------------------------------------------------------------------
// iOS config mapping
// ---------------------------------------------------------------------------

function buildIosConfig(raw: Record<string, unknown>): NotificationIOS {
  const ios: NotificationIOS = {};

  if (typeof raw.sound === 'string') ios.sound = raw.sound;
  if (typeof raw.categoryId === 'string') ios.categoryId = raw.categoryId;
  if (typeof raw.threadId === 'string') ios.threadId = raw.threadId;

  // interruptionLevel — defense-in-depth for unknown values
  if (typeof raw.interruptionLevel === 'string') {
    if (VALID_INTERRUPTION_LEVELS.has(raw.interruptionLevel)) {
      ios.interruptionLevel = raw.interruptionLevel as NotificationIOS['interruptionLevel'];
    } else {
      console.warn(`${PREFIX} Unknown ios.interruptionLevel '${raw.interruptionLevel}'. Ignored.`);
    }
  }

  // Attachments — rename identifier → id, filter out invalid entries
  if (Array.isArray(raw.attachments)) {
    ios.attachments = (raw.attachments as Array<unknown>)
      .filter((att): att is Record<string, unknown> => {
        if (att == null || typeof att !== 'object') return false;
        const a = att as Record<string, unknown>;
        if (typeof a.url !== 'string' || a.url.length === 0) {
          console.warn(`${PREFIX} ios.attachments entry has missing or empty url. Skipped.`);
          return false;
        }
        return true;
      })
      .map(att => {
        const mapped: { id?: string; url: string } = {
          url: att.url as string,
        };
        if (typeof att.identifier === 'string') {
          mapped.id = att.identifier;
        }
        return mapped;
      });
  }

  return ios;
}
