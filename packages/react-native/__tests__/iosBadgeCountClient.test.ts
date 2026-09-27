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
  { label: 'positive', badgeCount: 7, nativeBadge: 7 },
];

function notificationForBadge(testCase: (typeof badgeCases)[number]): Notification {
  return {
    id: `badge-${testCase.label}`,
    title: 'Badge probe',
    ios:
      testCase.label === 'absent'
        ? { categoryId: 'badge-category' }
        : { badgeCount: testCase.badgeCount, categoryId: 'badge-category' },
  };
}

function expectNativeBadge(notification: Notification, expected?: number): void {
  expect(notification.ios).toHaveProperty('categoryId', 'badge-category');
  if (expected === undefined) {
    expect(notification.ios).not.toHaveProperty('badgeCount');
  } else {
    expect(notification.ios).toHaveProperty('badgeCount', expected);
  }
}

describe('normal iOS badgeCount client boundary', () => {
  beforeEach(() => {
    setPlatform('ios');
    jest.clearAllMocks();
    mockNotifeeNativeModule.displayNotification.mockResolvedValue(undefined);
    mockNotifeeNativeModule.createTriggerNotification.mockResolvedValue(undefined);
  });

  test.each(badgeCases)('displayNotification: $label', async testCase => {
    const notification = notificationForBadge(testCase);

    await expect(apiModule.displayNotification(notification)).resolves.toBe(notification.id);

    expect(mockNotifeeNativeModule.displayNotification).toHaveBeenCalledTimes(1);
    const nativeNotification = mockNotifeeNativeModule.displayNotification.mock.calls[0][0];
    expectNativeBadge(nativeNotification, testCase.nativeBadge);
    expect(notification.ios).toHaveProperty('categoryId', 'badge-category');
    if (testCase.label === 'null') {
      expect(notification.ios).toHaveProperty('badgeCount', null);
    }
  });

  test('displayNotification rejects negative and invalid badge values before native dispatch', () => {
    for (const badgeCount of [-1, undefined, [] as any, '7' as any]) {
      expect(() =>
        apiModule.displayNotification({ ios: { badgeCount, categoryId: 'badge-category' } }),
      ).toThrow("'notification.ios.badgeCount' expected a number value >=0.");
    }
    expect(mockNotifeeNativeModule.displayNotification).not.toHaveBeenCalled();
  });

  test('displayNotification still rejects an unrelated invalid iOS property', () => {
    expect(() =>
      apiModule.displayNotification({ ios: { badgeCount: null, categoryId: [] as any } }),
    ).toThrow("'notification.ios.categoryId' expected a of string value");
    expect(mockNotifeeNativeModule.displayNotification).not.toHaveBeenCalled();
  });

  test.each(['one-shot', 'rolling'] as const)(
    'createTriggerNotification: %s keeps badge semantics through native payload',
    async triggerKind => {
      const trigger = {
        type: TriggerType.TIMESTAMP,
        timestamp: Date.now() + 60_000,
        ...(triggerKind === 'rolling' ? { repeatFrequency: RepeatFrequency.DAILY } : {}),
      };

      for (const testCase of badgeCases) {
        const notification = notificationForBadge(testCase);
        await expect(apiModule.createTriggerNotification(notification, trigger)).resolves.toBe(
          notification.id,
        );

        const [nativeNotification, nativeTrigger] =
          mockNotifeeNativeModule.createTriggerNotification.mock.calls.at(-1)!;
        expectNativeBadge(nativeNotification, testCase.nativeBadge);
        expect(nativeTrigger).toHaveProperty('type', TriggerType.TIMESTAMP);
        if (triggerKind === 'rolling') {
          expect(nativeTrigger).toHaveProperty('repeatFrequency', RepeatFrequency.DAILY);
        }
      }

      expect(mockNotifeeNativeModule.createTriggerNotification).toHaveBeenCalledTimes(4);
    },
  );
});
