import validateTrigger from 'react-native-notify-kit/src/validators/validateTrigger';
import {
  Trigger,
  TimestampTrigger,
  TriggerType,
  IntervalTrigger,
  TimeUnit,
  AlarmType,
  RepeatFrequency,
} from 'react-native-notify-kit/src/types/Trigger';
import { setPlatform } from '../testSetup';

describe('Validate Trigger', () => {
  describe('validateTrigger()', () => {
    beforeEach(() => {
      setPlatform('android');
    });

    test('throws error if value is not an object', () => {
      // @ts-ignore
      expect(() => validateTrigger(null)).toThrowError("'trigger' expected an object value.");

      // @ts-ignore
      expect(() => validateTrigger(undefined)).toThrowError("'trigger' expected an object value.");

      // @ts-ignore
      expect(() => validateTrigger('string')).toThrowError("'trigger' expected an object value.");

      // @ts-ignore
      expect(() => validateTrigger(1)).toThrowError("'trigger' expected an object value.");
    });

    test('throws an error if trigger type is unknown', () => {
      // @ts-ignore
      const trigger: Trigger = { type: -1 };

      expect(() => validateTrigger(trigger)).toThrowError('Unknown trigger type');
    });

    describe('validateTimestampTrigger()', () => {
      test('throws error if timestamp is invalid', () => {
        let trigger: TimestampTrigger = {
          type: TriggerType.TIMESTAMP,
          // @ts-ignore
          timestamp: null,
        };

        expect(() => validateTrigger(trigger)).toThrowError(
          "trigger.timestamp' expected a number value.",
        );

        trigger = {
          type: TriggerType.TIMESTAMP,
          // @ts-ignore
          timestamp: '',
        };

        expect(() => validateTrigger(trigger)).toThrowError(
          "trigger.timestamp' expected a number value.",
        );
      });

      test('throws error when timestamp is in the past', () => {
        const date = new Date(Date.now());
        const trigger: TimestampTrigger = {
          type: TriggerType.TIMESTAMP,
          timestamp: date.getTime(),
        };

        expect(() => validateTrigger(trigger)).toThrowError(
          "'trigger.timestamp' date must be in the future.",
        );
      });

      // Regression tests for upstream invertase/notifee#872 — users repeatedly
      // confuse Date.getDate() (day-of-month) and seconds-epoch with the
      // milliseconds-epoch shape Notifee actually expects.
      test('throws targeted error when timestamp looks like a day-of-month (.getDate())', () => {
        const trigger: TimestampTrigger = {
          type: TriggerType.TIMESTAMP,
          timestamp: 15,
        };

        expect(() => validateTrigger(trigger)).toThrowError(
          "'trigger.timestamp' looks like a day-of-month (15). Did you mean `date.getTime()` instead of `date.getDate()`?",
        );
      });

      test('throws targeted error when timestamp looks like seconds since epoch', () => {
        const trigger: TimestampTrigger = {
          type: TriggerType.TIMESTAMP,
          timestamp: 1730000000,
        };

        expect(() => validateTrigger(trigger)).toThrowError(
          "'trigger.timestamp' looks like seconds since epoch (1730000000). Notifee expects milliseconds — multiply by 1000, or use `Date.now()` / `date.getTime()`.",
        );
      });

      test('throws generic small-value error for sub-1e12 values that match no specific pattern', () => {
        const trigger: TimestampTrigger = {
          type: TriggerType.TIMESTAMP,
          timestamp: 500,
        };

        expect(() => validateTrigger(trigger)).toThrowError(
          "'trigger.timestamp' (500) is too small to be a valid epoch millisecond value. Use `Date.now()` or `someDate.getTime()`.",
        );
      });

      test('accepts a valid future epoch-ms timestamp without small-value detection', () => {
        const trigger: TimestampTrigger = {
          type: TriggerType.TIMESTAMP,
          timestamp: Date.now() + 60_000,
        };

        expect(() => validateTrigger(trigger)).not.toThrow();
      });

      test('repeatFrequency defaults to -1 if not set', () => {
        const date = new Date(Date.now());
        date.setSeconds(date.getSeconds() + 10);
        const trigger: TimestampTrigger = {
          type: TriggerType.TIMESTAMP,
          timestamp: date.getTime(),
        };

        const $ = validateTrigger(trigger) as TimestampTrigger;

        expect($.repeatFrequency).toEqual(-1);
      });

      test('defaults to AlarmManager when alarmManager is not specified', () => {
        const date = new Date(Date.now());
        date.setSeconds(date.getSeconds() + 10);
        const trigger: TimestampTrigger = {
          type: TriggerType.TIMESTAMP,
          timestamp: date.getTime(),
        };

        const $ = validateTrigger(trigger) as TimestampTrigger;

        expect($.alarmManager).toEqual({ type: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE });
      });

      test('throws error if repeatFrequency is invalid', () => {
        const date = new Date(Date.now());
        date.setSeconds(date.getSeconds() + 10);

        const trigger: TimestampTrigger = {
          type: TriggerType.TIMESTAMP,
          timestamp: date.getTime(),
          // @ts-ignore
          repeatFrequency: 4,
        };

        expect(() => validateTrigger(trigger)).toThrowError(
          "'trigger.repeatFrequency' expected a RepeatFrequency value.",
        );
      });

      test('accepts -1 for repeatFrequency when creating a timestamp trigger', () => {
        const date = new Date(Date.now());
        date.setSeconds(date.getSeconds() + 10);

        const trigger: TimestampTrigger = {
          type: TriggerType.TIMESTAMP,
          timestamp: date.getTime(),
          repeatFrequency: -1,
        };

        const $ = validateTrigger(trigger) as TimestampTrigger;

        expect($.repeatFrequency).toEqual(-1);
        expect($.timestamp).toEqual(date.getTime());
      });

      test('defaults repeatInterval to 1 for a repeated timestamp trigger', () => {
        const date = new Date(Date.now());
        date.setSeconds(date.getSeconds() + 10);
        const trigger: TimestampTrigger = {
          type: TriggerType.TIMESTAMP,
          timestamp: date.getTime(),
          repeatFrequency: RepeatFrequency.DAILY,
        };

        const $ = validateTrigger(trigger) as TimestampTrigger;

        expect($.repeatFrequency).toEqual(RepeatFrequency.DAILY);
        expect($.repeatInterval).toEqual(1);
      });

      test('accepts DAILY repeatFrequency with repeatInterval 2', () => {
        const date = new Date(Date.now());
        date.setSeconds(date.getSeconds() + 10);
        const trigger: TimestampTrigger = {
          type: TriggerType.TIMESTAMP,
          timestamp: date.getTime(),
          repeatFrequency: RepeatFrequency.DAILY,
          repeatInterval: 2,
        };

        const $ = validateTrigger(trigger) as TimestampTrigger;

        expect($.repeatFrequency).toEqual(RepeatFrequency.DAILY);
        expect($.repeatInterval).toEqual(2);
      });

      test('accepts WEEKLY repeatFrequency with repeatInterval 2', () => {
        const date = new Date(Date.now());
        date.setSeconds(date.getSeconds() + 10);
        const trigger: TimestampTrigger = {
          type: TriggerType.TIMESTAMP,
          timestamp: date.getTime(),
          repeatFrequency: RepeatFrequency.WEEKLY,
          repeatInterval: 2,
        };

        const $ = validateTrigger(trigger) as TimestampTrigger;

        expect($.repeatFrequency).toEqual(RepeatFrequency.WEEKLY);
        expect($.repeatInterval).toEqual(2);
      });

      test('accepts MONTHLY repeatFrequency with repeatInterval 3', () => {
        const date = new Date(Date.now());
        date.setSeconds(date.getSeconds() + 10);
        const trigger: TimestampTrigger = {
          type: TriggerType.TIMESTAMP,
          timestamp: date.getTime(),
          repeatFrequency: RepeatFrequency.MONTHLY,
          repeatInterval: 3,
        };

        const $ = validateTrigger(trigger) as TimestampTrigger;

        expect($.repeatFrequency).toEqual(RepeatFrequency.MONTHLY);
        expect($.repeatInterval).toEqual(3);
      });

      test('accepts MONTHLY repeatFrequency when alarmManager is not false', () => {
        const date = new Date(Date.now());
        date.setSeconds(date.getSeconds() + 10);
        const trigger: TimestampTrigger = {
          type: TriggerType.TIMESTAMP,
          timestamp: date.getTime(),
          repeatFrequency: RepeatFrequency.MONTHLY,
        };

        const $ = validateTrigger(trigger) as TimestampTrigger;

        expect($.repeatFrequency).toEqual(RepeatFrequency.MONTHLY);
        expect($.repeatInterval).toEqual(1);
        expect($.alarmManager).toEqual({ type: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE });
      });

      test('throws error if repeatInterval is set without repeatFrequency', () => {
        const date = new Date(Date.now());
        date.setSeconds(date.getSeconds() + 10);
        const trigger: TimestampTrigger = {
          type: TriggerType.TIMESTAMP,
          timestamp: date.getTime(),
          repeatInterval: 2,
        };

        expect(() => validateTrigger(trigger)).toThrowError(
          "'trigger.repeatInterval' requires a repeatFrequency value.",
        );
      });

      test('throws error if repeatInterval is set with repeatFrequency NONE', () => {
        const date = new Date(Date.now());
        date.setSeconds(date.getSeconds() + 10);
        const trigger: TimestampTrigger = {
          type: TriggerType.TIMESTAMP,
          timestamp: date.getTime(),
          repeatFrequency: RepeatFrequency.NONE,
          repeatInterval: 2,
        };

        expect(() => validateTrigger(trigger)).toThrowError(
          "'trigger.repeatInterval' requires a repeating repeatFrequency value.",
        );
      });

      test.each([0, -1, 1.5, NaN, Infinity, '2', {}, []])(
        'throws error if repeatInterval is invalid: %p',
        repeatInterval => {
          const date = new Date(Date.now());
          date.setSeconds(date.getSeconds() + 10);
          const trigger: TimestampTrigger = {
            type: TriggerType.TIMESTAMP,
            timestamp: date.getTime(),
            repeatFrequency: RepeatFrequency.DAILY,
            // @ts-ignore
            repeatInterval,
          };

          expect(() => validateTrigger(trigger)).toThrowError(
            "'trigger.repeatInterval' expected a positive integer value.",
          );
        },
      );

      test('throws error if MONTHLY repeatFrequency uses WorkManager on Android', () => {
        const date = new Date(Date.now());
        date.setSeconds(date.getSeconds() + 10);
        const trigger: TimestampTrigger = {
          type: TriggerType.TIMESTAMP,
          timestamp: date.getTime(),
          repeatFrequency: RepeatFrequency.MONTHLY,
          alarmManager: false,
        };

        expect(() => validateTrigger(trigger)).toThrowError(
          "'trigger.repeatFrequency' MONTHLY is not supported when 'trigger.alarmManager' is false.",
        );
      });

      test('returns a valid timestamp trigger object', () => {
        const date = new Date(Date.now());
        date.setSeconds(date.getSeconds() + 10);

        const trigger: TimestampTrigger = {
          type: TriggerType.TIMESTAMP,
          timestamp: date.getTime(),
          repeatFrequency: 2,
        };

        const $ = validateTrigger(trigger) as TimestampTrigger;

        // expect($.).toEqual(date.getTime());
        expect($.repeatFrequency).toEqual(2);
        expect($.repeatInterval).toEqual(1);
        expect($.timestamp).toEqual(date.getTime());
      });

      describe('alarmManager', () => {
        test('ignores property when false', () => {
          const date = new Date(Date.now());
          date.setSeconds(date.getSeconds() + 10);

          const trigger: TimestampTrigger = {
            type: TriggerType.TIMESTAMP,
            timestamp: date.getTime(),
            repeatFrequency: 2,
            alarmManager: false,
          };

          const $ = validateTrigger(trigger) as TimestampTrigger;

          // expect($.).toEqual(date.getTime());
          expect($.repeatFrequency).toEqual(2);
          expect($.timestamp).toEqual(date.getTime());
          expect($.alarmManager).not.toBeDefined();
        });

        test('parses property to the default values', () => {
          const date = new Date(Date.now());
          date.setSeconds(date.getSeconds() + 10);

          const trigger: TimestampTrigger = {
            type: TriggerType.TIMESTAMP,
            timestamp: date.getTime(),
            repeatFrequency: 2,
            alarmManager: true,
          };

          const $ = validateTrigger(trigger) as TimestampTrigger;

          // expect($.).toEqual(date.getTime());
          expect($.repeatFrequency).toEqual(2);
          expect($.timestamp).toEqual(date.getTime());
          expect($.alarmManager).toEqual({ type: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE });
        });

        test('parses deprecated property to an object with proper alarm type set', () => {
          const date = new Date(Date.now());
          date.setSeconds(date.getSeconds() + 10);

          const trigger: TimestampTrigger = {
            type: TriggerType.TIMESTAMP,
            timestamp: date.getTime(),
            repeatFrequency: 2,
            alarmManager: {
              allowWhileIdle: true,
            },
          };

          const $ = validateTrigger(trigger) as TimestampTrigger;

          // expect($.).toEqual(date.getTime());
          expect($.repeatFrequency).toEqual(2);
          expect($.timestamp).toEqual(date.getTime());
          expect($.alarmManager).toEqual({ type: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE });
        });

        test('parses property to an object with proper alarm type set', () => {
          const date = new Date(Date.now());
          date.setSeconds(date.getSeconds() + 10);

          const trigger: TimestampTrigger = {
            type: TriggerType.TIMESTAMP,
            timestamp: date.getTime(),
            repeatFrequency: 2,
            alarmManager: {
              type: AlarmType.SET_ALARM_CLOCK,
            },
          };

          const $ = validateTrigger(trigger) as TimestampTrigger;

          // expect($.).toEqual(date.getTime());
          expect($.repeatFrequency).toEqual(2);
          expect($.timestamp).toEqual(date.getTime());
          expect($.alarmManager).toEqual({ type: AlarmType.SET_ALARM_CLOCK });
        });
      });
    });

    describe('validateIntervalTrigger()', () => {
      test('throws error if interval is invalid', () => {
        let trigger: IntervalTrigger = {
          type: TriggerType.INTERVAL,
          // @ts-ignore
          interval: null,
        };

        expect(() => validateTrigger(trigger)).toThrowError(
          "trigger.interval' expected a number value.",
        );

        trigger = {
          type: TriggerType.INTERVAL,
          // @ts-ignore
          interval: '',
        };

        expect(() => validateTrigger(trigger)).toThrowError(
          "trigger.interval' expected a number value.",
        );
      });

      test('defaults timeUnit to SECONDS if not set', () => {
        const trigger: IntervalTrigger = {
          type: TriggerType.INTERVAL,
          interval: 1000,
        };

        const $ = validateTrigger(trigger) as IntervalTrigger;

        expect($.type).toEqual(TriggerType.INTERVAL);
        expect($.timeUnit).toEqual(TimeUnit.SECONDS);
        expect($.interval).toEqual(1000);
      });

      test('throws error if timeUnit is invalid', () => {
        const trigger: IntervalTrigger = {
          type: TriggerType.INTERVAL,
          // @ts-ignore
          timeUnit: 'MONTHS',
          interval: 60,
        };

        expect(() => validateTrigger(trigger)).toThrowError(
          "'trigger.timeUnit' expected a TimeUnit value.",
        );
      });

      test('throws error if interval is less than 15 minutes', () => {
        let trigger: IntervalTrigger = {
          type: TriggerType.INTERVAL,
          timeUnit: TimeUnit.SECONDS,
          interval: 60,
        };

        expect(() => validateTrigger(trigger)).toThrowError(
          "'trigger.interval' expected to be at least 15 minutes.",
        );

        trigger = {
          type: TriggerType.INTERVAL,
          timeUnit: TimeUnit.MINUTES,
          interval: 12,
        };

        expect(() => validateTrigger(trigger)).toThrowError(
          "'trigger.interval' expected to be at least 15 minutes.",
        );

        trigger = {
          type: TriggerType.INTERVAL,
          timeUnit: TimeUnit.HOURS,
          interval: 0.5,
        };

        expect(() => validateTrigger(trigger)).toThrowError(
          "'trigger.interval' expected to be at least 15 minutes.",
        );

        trigger = {
          type: TriggerType.INTERVAL,
          timeUnit: TimeUnit.DAYS,
          interval: 0.5,
        };

        expect(() => validateTrigger(trigger)).toThrowError(
          "'trigger.interval' expected to be at least 15 minutes.",
        );
      });

      test('returns a valid interval trigger object', () => {
        const date = new Date(Date.now());
        date.setSeconds(date.getSeconds() + 10);

        const trigger: IntervalTrigger = {
          type: TriggerType.INTERVAL,
          timeUnit: TimeUnit.DAYS,
          interval: 1,
        };

        const $ = validateTrigger(trigger) as IntervalTrigger;

        expect($.type).toEqual(TriggerType.INTERVAL);
        expect($.timeUnit).toEqual(TimeUnit.DAYS);
        expect($.interval).toEqual(1);
      });
    });
  });
});
