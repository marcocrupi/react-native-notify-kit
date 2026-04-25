/*
 * Copyright (c) 2016-present Invertase Limited
 */

import {
  objectHasProperty,
  isNumber,
  isObject,
  isValidEnum,
  isUndefined,
  isBoolean,
  isAndroid,
} from '../utils';
import {
  Trigger,
  TimeUnit,
  RepeatFrequency,
  TimestampTrigger,
  IntervalTrigger,
  TriggerType,
  TimestampTriggerAlarmManager,
  AlarmType,
} from '../types/Trigger';

const MINIMUM_INTERVAL = 15;

function isMinimumInterval(interval: number, timeUnit: any): boolean {
  switch (timeUnit) {
    case TimeUnit.SECONDS:
      return interval / 60 >= MINIMUM_INTERVAL;
    case TimeUnit.MINUTES:
      return interval >= MINIMUM_INTERVAL;
    case TimeUnit.HOURS:
      return interval >= 1;
    case TimeUnit.DAYS:
      return interval >= 1;
  }
  return true;
}

export default function validateTrigger(trigger: Trigger): Trigger {
  if (!isObject(trigger)) {
    throw new Error("'trigger' expected an object value.");
  }

  switch (trigger.type) {
    case TriggerType.TIMESTAMP:
      return validateTimestampTrigger(trigger);
    case TriggerType.INTERVAL:
      return validateIntervalTrigger(trigger);
    default:
      throw new Error('Unknown trigger type');
  }
}

// Smallest plausible epoch-ms value for a future trigger. 1e12 ms ≈ Sep 2001;
// anything smaller is almost certainly the wrong unit (seconds-since-epoch,
// or a Date.getDate() day-of-month). We intercept the three common shapes
// and emit targeted hints — see upstream invertase/notifee#872 for the
// year-after-year UX pattern this guards against.
const MIN_PLAUSIBLE_EPOCH_MS = 1e12;
const MIN_PLAUSIBLE_EPOCH_SECONDS = 1e9;

function validateTimestampTrigger(trigger: TimestampTrigger): TimestampTrigger {
  if (!isNumber(trigger.timestamp)) {
    throw new Error("'trigger.timestamp' expected a number value.");
  }

  if (trigger.timestamp < MIN_PLAUSIBLE_EPOCH_MS) {
    if (trigger.timestamp >= 1 && trigger.timestamp <= 31) {
      throw new Error(
        `'trigger.timestamp' looks like a day-of-month (${trigger.timestamp}). Did you mean \`date.getTime()\` instead of \`date.getDate()\`?`,
      );
    }
    if (trigger.timestamp >= MIN_PLAUSIBLE_EPOCH_SECONDS) {
      throw new Error(
        `'trigger.timestamp' looks like seconds since epoch (${trigger.timestamp}). Notifee expects milliseconds — multiply by 1000, or use \`Date.now()\` / \`date.getTime()\`.`,
      );
    }
    throw new Error(
      `'trigger.timestamp' (${trigger.timestamp}) is too small to be a valid epoch millisecond value. Use \`Date.now()\` or \`someDate.getTime()\`.`,
    );
  }

  const now = Date.now();
  if (trigger.timestamp <= now) {
    throw new Error("'trigger.timestamp' date must be in the future.");
  }

  const out: TimestampTrigger = {
    type: trigger.type,
    timestamp: trigger.timestamp,
    repeatFrequency: -1,
  };

  if (objectHasProperty(trigger, 'repeatFrequency') && !isUndefined(trigger.repeatFrequency)) {
    if (!isValidEnum(trigger.repeatFrequency, RepeatFrequency)) {
      throw new Error("'trigger.repeatFrequency' expected a RepeatFrequency value.");
    }

    out.repeatFrequency = trigger.repeatFrequency;
  }

  const hasRepeatFrequency =
    objectHasProperty(trigger, 'repeatFrequency') && !isUndefined(trigger.repeatFrequency);
  const isRepeating =
    hasRepeatFrequency && trigger.repeatFrequency !== RepeatFrequency.NONE;

  if (objectHasProperty(trigger, 'repeatInterval') && !isUndefined(trigger.repeatInterval)) {
    if (!hasRepeatFrequency) {
      throw new Error("'trigger.repeatInterval' requires a repeatFrequency value.");
    }

    if (trigger.repeatFrequency === RepeatFrequency.NONE) {
      throw new Error("'trigger.repeatInterval' requires a repeating repeatFrequency value.");
    }

    if (
      !isNumber(trigger.repeatInterval) ||
      !Number.isFinite(trigger.repeatInterval) ||
      !Number.isInteger(trigger.repeatInterval) ||
      trigger.repeatInterval <= 0
    ) {
      throw new Error("'trigger.repeatInterval' expected a positive integer value.");
    }

    out.repeatInterval = trigger.repeatInterval;
  } else if (isRepeating) {
    out.repeatInterval = 1;
  }

  if (objectHasProperty(trigger, 'alarmManager') && !isUndefined(trigger.alarmManager)) {
    if (isBoolean(trigger.alarmManager)) {
      if (trigger.alarmManager) {
        out.alarmManager = validateTimestampAlarmManager();
      }
      // alarmManager: false → respect opt-out, use WorkManager
    } else {
      try {
        out.alarmManager = validateTimestampAlarmManager(trigger.alarmManager);
      } catch (e: any) {
        throw new Error(`'trigger.alarmManager' ${e.message}.`);
      }
    }
  } else {
    // Default to AlarmManager for reliable delivery when app is killed
    out.alarmManager = validateTimestampAlarmManager();
  }

  if (
    isAndroid &&
    trigger.alarmManager === false &&
    out.repeatFrequency === RepeatFrequency.MONTHLY
  ) {
    throw new Error(
      "'trigger.repeatFrequency' MONTHLY is not supported when 'trigger.alarmManager' is false.",
    );
  }

  return out;
}

function validateTimestampAlarmManager(
  alarmManager?: TimestampTriggerAlarmManager,
): TimestampTriggerAlarmManager {
  const out: TimestampTriggerAlarmManager = {
    type: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE,
  };
  if (!alarmManager) {
    return out;
  }
  if (isBoolean(alarmManager.allowWhileIdle) && alarmManager.allowWhileIdle) {
    out.type = AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE;
  }

  if (objectHasProperty(alarmManager, 'type') && !isUndefined(alarmManager.type)) {
    if (!isValidEnum(alarmManager.type, AlarmType)) {
      throw new Error("'alarmManager.type' expected a AlarmType value.");
    }
    out.type = alarmManager.type;
  }

  return out;
}

function validateIntervalTrigger(trigger: IntervalTrigger): IntervalTrigger {
  if (!isNumber(trigger.interval)) {
    throw new Error("'trigger.interval' expected a number value.");
  }

  const out: IntervalTrigger = {
    type: trigger.type,
    interval: trigger.interval,
    timeUnit: TimeUnit.SECONDS,
  };

  if (objectHasProperty(trigger, 'timeUnit') && !isUndefined(trigger.timeUnit)) {
    if (!isValidEnum(trigger.timeUnit, TimeUnit)) {
      throw new Error("'trigger.timeUnit' expected a TimeUnit value.");
    }
    out.timeUnit = trigger.timeUnit;
  }

  if (!isMinimumInterval(trigger.interval, out.timeUnit)) {
    throw new Error("'trigger.interval' expected to be at least 15 minutes.");
  }

  return out;
}
