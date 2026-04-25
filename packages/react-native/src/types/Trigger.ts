/**
 * Interface for building a trigger with a timestamp.
 *
 * View the [Triggers](/react-native/triggers) documentation to learn more.
 */
export interface TimestampTrigger {
  /**
   * Constant enum value used to identify the trigger type.
   */
  type: TriggerType.TIMESTAMP;
  /**
   * The timestamp when the notification should first be shown, in milliseconds since 1970.
   */
  timestamp: number;

  /**
   * The frequency at which the trigger repeats.
   * If unset, the notification will only be displayed once.
   *
   * For example:
   *  if set to `RepeatFrequency.HOURLY`, the notification will repeat every hour from the timestamp specified.
   *  if set to `RepeatFrequency.DAILY`, the notification will repeat every day from the timestamp specified.
   *  if set to `RepeatFrequency.WEEKLY`, the notification will repeat every week from the timestamp specified.
   *  if set to `RepeatFrequency.MONTHLY`, the notification will repeat every calendar month from the timestamp specified.
   *
   * Yearly recurrence is not supported.
   */
  repeatFrequency?: RepeatFrequency;

  /**
   * Multiplier applied to `repeatFrequency` for timestamp triggers.
   *
   * For example, `repeatFrequency: RepeatFrequency.DAILY` with
   * `repeatInterval: 2` repeats every 2 days. `RepeatFrequency.WEEKLY`
   * with `repeatInterval: 2` repeats every 2 weeks, and
   * `RepeatFrequency.MONTHLY` with `repeatInterval: 3` repeats every
   * 3 months.
   *
   * Valid only when `repeatFrequency` is set to a repeating value. It is
   * not valid without `repeatFrequency` or with `RepeatFrequency.NONE`.
   * Must be a positive integer.
   *
   * Defaults to `1` when `repeatFrequency` is set.
   */
  repeatInterval?: number;

  /**
   * Choose to schedule your trigger notification with Android's AlarmManager API.
   *
   * By default, timestamp trigger notifications use AlarmManager on Android. Set
   * this to `false` to opt out to WorkManager. `RepeatFrequency.MONTHLY` is not
   * supported when this is `false`.
   *
   * @platform android
   */
  alarmManager?: boolean | TimestampTriggerAlarmManager | undefined;
}

/**
 * An interface representing the different alarm types which can be used with `TimestampTrigger.alarmManager.type`.
 *
 * View the [Triggers](/react-native/triggers) documentation to learn more.
 */
export enum AlarmType {
  SET,
  SET_AND_ALLOW_WHILE_IDLE,
  SET_EXACT,
  SET_EXACT_AND_ALLOW_WHILE_IDLE,
  SET_ALARM_CLOCK,
}

/**
 * Interface to specify additional options for the AlarmManager which can be used with `TimestampTrigger.alarmManager`.
 *
 * View the [Triggers](/react-native/triggers) documentation to learn more.
 *
 * @platform android
 */
export interface TimestampTriggerAlarmManager {
  /**
   * @deprecated use `type` instead
   * -----
   *
   * Sets whether your trigger notification should be displayed even when the system is in low-power idle modes.
   *
   * Defaults to `false`.
   */
  allowWhileIdle?: boolean;

  /** The type of alarm set by alarm manager of android */
  type?: AlarmType;
}

/**
 * An interface representing the different frequencies which can be used with `TimestampTrigger.repeatFrequency`.
 * Supported timestamp repeat frequencies are hourly, daily, weekly, and monthly.
 * Yearly recurrence is not supported.
 *
 * View the [Triggers](/react-native/triggers) documentation to learn more.
 */
export enum RepeatFrequency {
  /**
   * Do not repeat. `TimestampTrigger.repeatInterval` cannot be used with `NONE`.
   */
  NONE = -1,
  /**
   * Repeat every calendar hour from the timestamp.
   */
  HOURLY = 0,
  /**
   * Repeat every calendar day from the timestamp.
   */
  DAILY = 1,
  /**
   * Repeat every calendar week from the timestamp.
   */
  WEEKLY = 2,
  /**
   * Repeat every calendar month from the timestamp.
   *
   * Use `TimestampTrigger.repeatInterval` for intervals such as every 3 months.
   * Monthly repeats use native calendar semantics; dates that do not exist in a
   * target month are adjusted by the platform calendar.
   */
  MONTHLY = 3,
}

/**
 * Interface for building a trigger that repeats at a specified interval.
 *
 * View the [Triggers](/react-native/triggers) documentation to learn more.
 */
export interface IntervalTrigger {
  /**
   * Constant enum value used to identify the trigger type.
   */
  type: TriggerType.INTERVAL;

  /**
   * How frequently the notification should be repeated.
   *
   * For example, if set to 30, the notification will be displayed every 30 minutes.
   *
   * Must be set to a minimum of 15 minutes.
   */
  interval: number;

  /**
   * The unit of time that the `interval` is measured in.
   *
   * For example, if set to `TimeUnit.DAYS` and repeat interval is set to 3, the notification will repeat every 3 days.
   *
   * Defaults to `TimeUnit.SECONDS`
   */
  timeUnit?: TimeUnit | TimeUnit.SECONDS;
}

/**
 * An interface representing the different units of time which can be used with `IntervalTrigger.timeUnit`.
 *
 * View the [Triggers](/react-native/triggers) documentation to learn more.
 */
export enum TimeUnit {
  SECONDS = 'SECONDS',
  MINUTES = 'MINUTES',
  HOURS = 'HOURS',
  DAYS = 'DAYS',
}

/**
 * Available Trigger Types.
 *
 * View the [Triggers](/react-native/triggers) documentation to learn more with example usage.
 */
export enum TriggerType {
  TIMESTAMP = 0,
  INTERVAL = 1,
}

export declare type Trigger = TimestampTrigger | IntervalTrigger;
