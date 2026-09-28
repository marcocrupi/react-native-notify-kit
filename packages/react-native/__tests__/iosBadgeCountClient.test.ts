import NotifeeApiModule from 'react-native-notify-kit/src/NotifeeApiModule';
import { Notification } from 'react-native-notify-kit/src/types/Notification';
import { RepeatFrequency, TriggerType } from 'react-native-notify-kit/src/types/Trigger';
import { setPlatform } from './testSetup';

// @ts-ignore - Jest replaces this module with its test mock.
import { mockNotifeeNativeModule } from 'react-native-notify-kit/src/NotifeeNativeModule';

jest.mock('react-native-notify-kit/src/NotifeeNativeModule');

const apiModule = new NotifeeApiModule({
  version: 'test',
  nativeModuleName: 'NotifeeApiModule',
  nativeEvents: [],
});

const badgeCases: Array<{ label: string; badgeCount?: number | null; nativeBadge?: number }> = [
  { label: 'absent' },
  { label: 'null', badgeCount: null },
  { label: 'zero', badgeCount: 0, nativeBadge: 0 },
  { label: 'negative-zero', badgeCount: -0, nativeBadge: -0 },
  { label: 'positive', badgeCount: 7, nativeBadge: 7 },
  {
    label: 'max-safe-integer',
    badgeCount: Number.MAX_SAFE_INTEGER,
    nativeBadge: Number.MAX_SAFE_INTEGER,
  },
  {
    label: 'above-max-safe-integer',
    badgeCount: Number.MAX_SAFE_INTEGER + 1,
    nativeBadge: Number.MAX_SAFE_INTEGER + 1,
  },
  { label: 'max-finite-number', badgeCount: Number.MAX_VALUE, nativeBadge: Number.MAX_VALUE },
];

const invalidBadgeCases = [
  { label: 'negative-integer', badgeCount: -1 },
  { label: 'negative-fraction', badgeCount: -0.5 },
  { label: 'fraction-zero-point-five', badgeCount: 0.5 },
  { label: 'fraction-one-point-five', badgeCount: 1.5 },
  { label: 'nan', badgeCount: NaN },
  { label: 'positive-infinity', badgeCount: Infinity },
  { label: 'negative-infinity', badgeCount: -Infinity },
  { label: 'explicit-undefined', badgeCount: undefined },
  { label: 'array', badgeCount: [] },
  { label: 'string', badgeCount: '7' },
  { label: 'boolean', badgeCount: true },
  { label: 'object', badgeCount: {} },
];

type EntryPoint = 'displayNotification' | 'timestamp' | 'rolling';

function invoke(
  entryPoint: EntryPoint,
  notification: Notification,
  timestamp: number,
): Promise<string> {
  if (entryPoint === 'displayNotification') {
    return apiModule.displayNotification(notification);
  }

  return apiModule.createTriggerNotification(notification, {
    type: TriggerType.TIMESTAMP,
    timestamp,
    ...(entryPoint === 'rolling'
      ? { repeatFrequency: RepeatFrequency.DAILY, repeatInterval: 2 }
      : {}),
  });
}

function notificationForBadge(testCase: (typeof badgeCases)[number]): Notification {
  return {
    id: `badge-${testCase.label}`,
    title: 'Badge probe',
    ios: Object.freeze(
      testCase.label === 'absent'
        ? { categoryId: 'badge-category' }
        : { badgeCount: testCase.badgeCount, categoryId: 'badge-category' },
    ),
  };
}

function expectNativeBadge(notification: Notification, expected?: number): void {
  expect(notification.ios).toHaveProperty('categoryId', 'badge-category');
  if (expected === undefined) {
    expect(notification.ios).not.toHaveProperty('badgeCount');
  } else {
    expect(Object.is(notification.ios?.badgeCount, expected)).toBe(true);
  }
}

describe.each<EntryPoint>(['displayNotification', 'timestamp', 'rolling'])(
  'normal iOS badgeCount client boundary: %s',
  entryPoint => {
    beforeEach(() => {
      setPlatform('ios');
      jest.clearAllMocks();
      mockNotifeeNativeModule.displayNotification.mockResolvedValue(undefined);
      mockNotifeeNativeModule.createTriggerNotification.mockResolvedValue(undefined);
    });

    test.each(badgeCases)('preserves $label through native payload', async testCase => {
      const notification = notificationForBadge(testCase);
      const originalIOS = { ...notification.ios };
      const timestamp = Date.now() + 60_000;

      await expect(invoke(entryPoint, notification, timestamp)).resolves.toBe(notification.id);

      const nativeMethod =
        entryPoint === 'displayNotification'
          ? mockNotifeeNativeModule.displayNotification
          : mockNotifeeNativeModule.createTriggerNotification;
      expect(nativeMethod).toHaveBeenCalledTimes(1);
      expectNativeBadge(nativeMethod.mock.calls[0][0], testCase.nativeBadge);
      expect(notification.ios).toEqual(originalIOS);

      if (entryPoint === 'displayNotification') {
        expect(mockNotifeeNativeModule.createTriggerNotification).not.toHaveBeenCalled();
      } else {
        expect(mockNotifeeNativeModule.displayNotification).not.toHaveBeenCalled();
        const nativeTrigger = nativeMethod.mock.calls[0][1];
        expect(nativeTrigger).toHaveProperty('type', TriggerType.TIMESTAMP);
        expect(nativeTrigger).toHaveProperty('timestamp', timestamp);
        if (entryPoint === 'rolling') {
          expect(nativeTrigger).toHaveProperty('repeatFrequency', RepeatFrequency.DAILY);
          expect(nativeTrigger).toHaveProperty('repeatInterval', 2);
        } else {
          expect(nativeTrigger.repeatFrequency).toBe(RepeatFrequency.NONE);
        }
      }
    });

    test.each(invalidBadgeCases)('rejects $label before native dispatch', testCase => {
      const notification: Notification = {
        ios: Object.freeze({
          badgeCount: testCase.badgeCount as any,
          categoryId: 'badge-category',
        }),
      };
      expect(Object.hasOwn(notification.ios!, 'badgeCount')).toBe(true);
      expect(() => invoke(entryPoint, notification, Date.now() + 60_000)).toThrow(
        "'notification.ios.badgeCount' expected a number value >=0.",
      );
      expect(mockNotifeeNativeModule.displayNotification).not.toHaveBeenCalled();
      expect(mockNotifeeNativeModule.createTriggerNotification).not.toHaveBeenCalled();
    });

    test('null still validates unrelated iOS properties before native dispatch', () => {
      expect(() =>
        invoke(
          entryPoint,
          { ios: { badgeCount: null, categoryId: [] as any } },
          Date.now() + 60_000,
        ),
      ).toThrow("'notification.ios.categoryId' expected a of string value");
      expect(mockNotifeeNativeModule.displayNotification).not.toHaveBeenCalled();
      expect(mockNotifeeNativeModule.createTriggerNotification).not.toHaveBeenCalled();
    });
  },
);
