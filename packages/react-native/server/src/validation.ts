import type { NotifyKitPayloadInput } from './types';

const PREFIX = '[react-native-notify-kit/server]';
const RESERVED_DATA_KEYS = ['notifee_options', 'notifee_data'] as const;

function err(category: string, message: string): Error {
  return new Error(`${PREFIX} ${category}: ${message}`);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function validateInput(input: NotifyKitPayloadInput): void {
  if (input === null || typeof input !== 'object') {
    throw err('Validation', 'input must be an object');
  }

  const routingCount =
    (input.token !== undefined ? 1 : 0) +
    (input.topic !== undefined ? 1 : 0) +
    (input.condition !== undefined ? 1 : 0);

  if (routingCount !== 1) {
    throw err(
      'Routing',
      `exactly one of 'token', 'topic', or 'condition' must be provided. Got: ${routingCount}`,
    );
  }

  if (input.token !== undefined && !isNonEmptyString(input.token)) {
    throw err('Routing', "'token' must be a non-empty string");
  }
  if (input.topic !== undefined && !isNonEmptyString(input.topic)) {
    throw err('Routing', "'topic' must be a non-empty string");
  }
  if (input.condition !== undefined && !isNonEmptyString(input.condition)) {
    throw err('Routing', "'condition' must be a non-empty string");
  }

  const { notification } = input;
  if (notification === null || typeof notification !== 'object') {
    throw err('Validation', "'notification' is required and must be an object");
  }

  if (notification.id !== undefined && !isNonEmptyString(notification.id)) {
    throw err('Validation', 'notification.id must be a non-empty string when provided');
  }
  if (!isNonEmptyString(notification.title)) {
    throw err('Validation', 'notification.title is required and must be a non-empty string');
  }
  if (!isNonEmptyString(notification.body)) {
    throw err('Validation', 'notification.body is required and must be a non-empty string');
  }

  if (notification.data !== undefined) {
    if (notification.data === null || typeof notification.data !== 'object') {
      throw err('Validation', "'notification.data' must be an object");
    }
    for (const reserved of RESERVED_DATA_KEYS) {
      if (Object.prototype.hasOwnProperty.call(notification.data, reserved)) {
        throw err(
          'Validation',
          "'notifee_options' and 'notifee_data' are reserved keys and cannot be used in notification.data",
        );
      }
    }
    for (const [key, value] of Object.entries(notification.data)) {
      if (typeof value !== 'string') {
        throw err(
          'Validation',
          `FCM data values must be strings. Got ${typeof value} for key '${key}'. Use JSON.stringify() if you need to pass complex values.`,
        );
      }
    }
  }

  const attachments = notification.ios?.attachments;
  if (attachments !== undefined) {
    if (!Array.isArray(attachments)) {
      throw err('iOS', "'notification.ios.attachments' must be an array");
    }
    for (const attachment of attachments) {
      if (
        attachment === null ||
        typeof attachment !== 'object' ||
        typeof attachment.url !== 'string'
      ) {
        throw err('iOS', "each attachment must be an object with a string 'url' field");
      }
      if (!attachment.url.startsWith('https://')) {
        throw err('iOS', `iOS attachments require https:// URLs. Got: ${attachment.url}`);
      }
    }
  }

  if (input.options !== undefined) {
    const { options } = input;
    if (options === null || typeof options !== 'object') {
      throw err('Validation', "'options' must be an object");
    }
    if (
      options.androidPriority !== undefined &&
      options.androidPriority !== 'high' &&
      options.androidPriority !== 'normal'
    ) {
      throw err(
        'Validation',
        `'options.androidPriority' must be 'high' or 'normal'. Got: ${String(options.androidPriority)}`,
      );
    }
    if (
      options.iosBadgeCount !== undefined &&
      (typeof options.iosBadgeCount !== 'number' ||
        !Number.isFinite(options.iosBadgeCount) ||
        options.iosBadgeCount < 0 ||
        !Number.isInteger(options.iosBadgeCount))
    ) {
      throw err('Validation', "'options.iosBadgeCount' must be a non-negative integer");
    }
    if (
      options.ttl !== undefined &&
      (typeof options.ttl !== 'number' || !Number.isInteger(options.ttl) || options.ttl <= 0)
    ) {
      throw err(
        'Validation',
        `options.ttl must be a positive integer (seconds). Got: ${String(options.ttl)}`,
      );
    }
    if (options.collapseKey !== undefined && !isNonEmptyString(options.collapseKey)) {
      throw err('Validation', "'options.collapseKey' must be a non-empty string");
    }
  }
}
