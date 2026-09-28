import validateIOSNotification from 'react-native-notify-kit/src/validators/validateIOSNotification';
import { NotificationIOS } from 'react-native-notify-kit/src/types/NotificationIOS';
import { setPlatform } from '../testSetup';

describe('Validate IOS Notification', () => {
  beforeEach(() => setPlatform('ios'));

  describe('validateIOSNotification()', () => {
    test('returns valid ', () => {
      const notification: NotificationIOS = {
        attachments: [],
        badgeCount: 0,
        categoryId: 'categoryId',
        launchImageName: 'launchImageName',
        sound: 'placeholderText',
        critical: true,
        criticalVolume: 0,
        threadId: 'threadId',
        summaryArgument: 'summaryArgument',
        summaryArgumentCount: 1,
        targetContentId: 'targetContentId',
      };

      const $ = validateIOSNotification(notification);
      //   expect($.attachments).toEqual([]);
      expect($.badgeCount).toEqual(0);
      expect($.categoryId).toEqual('categoryId');
      expect($.launchImageName).toEqual('launchImageName');
      expect($.sound).toEqual('placeholderText');
      expect($.critical).toEqual(true);
      expect($.criticalVolume).toEqual(0);
      expect($.threadId).toEqual('threadId');
      expect($.summaryArgument).toEqual('summaryArgument');
      expect($.summaryArgumentCount).toEqual(1);
      //   expect($.targetContentId).toEqual('targetContentId');
    });

    test('returns valid when no value is provided', () => {
      const $ = validateIOSNotification();
      expect($).toEqual({
        foregroundPresentationOptions: {
          alert: true,
          badge: true,
          sound: true,
          banner: true,
          list: true,
        },
      });
    });

    test('returns valid when there is a foregroundPresentationOptions', () => {
      const $ = validateIOSNotification({
        foregroundPresentationOptions: {
          alert: true,
          badge: true,
          sound: true,
          banner: true,
          list: true,
        },
      });
      expect($).toEqual({
        foregroundPresentationOptions: {
          alert: true,
          badge: true,
          sound: true,
          banner: true,
          list: true,
        },
      });
    });

    test('returns valid when there is a valid communicationInfo property', () => {
      const $ = validateIOSNotification({
        communicationInfo: {
          conversationId: 'id',
          groupName: 'Friends',
          sender: {
            id: 'sender-id',
            displayName: 'John Doe',
          },
        },
      });
      expect($).toEqual({
        communicationInfo: {
          conversationId: 'id',
          groupName: 'Friends',
          sender: {
            id: 'sender-id',
            displayName: 'John Doe',
          },
        },
        foregroundPresentationOptions: {
          alert: true,
          badge: true,
          sound: true,
          banner: true,
          list: true,
        },
      });
    });

    test('returns invalid when an invalid critical property is provided', () => {
      const notification: NotificationIOS = {
        critical: {} as any,
      };

      expect(() => validateIOSNotification(notification)).toThrowError(
        "'notification.ios.critical' must be a boolean value if specified.",
      );
    });

    test('returns invalid when an invalid criticalVolume property is provided', () => {
      const notification: NotificationIOS = {
        criticalVolume: {} as any,
      };

      expect(() => validateIOSNotification(notification)).toThrowError(
        "'notification.ios.criticalVolume' must be a number value if specified.",
      );
    });

    test('returns invalid when an invalid sound property is provided', () => {
      let notification: NotificationIOS = {
        sound: {} as any,
      };

      expect(() => validateIOSNotification(notification)).toThrowError(
        "'notification.sound' must be a string value if specified.",
      );

      notification = {
        sound: [] as any,
      };

      expect(() => validateIOSNotification(notification)).toThrowError(
        "'notification.sound' must be a string value if specified.",
      );
    });

    test('returns invalid when an invalid badgeCount property is provided', () => {
      const notification: NotificationIOS = {
        badgeCount: [] as any,
      };

      expect(() => validateIOSNotification(notification)).toThrowError(
        "'notification.ios.badgeCount' expected a number value >=0.",
      );
    });

    test('treats absent and null badgeCount as the same no-change value', () => {
      const absent = validateIOSNotification({ categoryId: 'badge-category' });
      const explicitNull = validateIOSNotification({
        badgeCount: null,
        categoryId: 'badge-category',
      });

      expect(explicitNull).toEqual(absent);
      expect(explicitNull).not.toHaveProperty('badgeCount');
      expect(explicitNull.categoryId).toBe('badge-category');
    });

    test.each([0, -0, 7, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, Number.MAX_VALUE])(
      'preserves finite integer badgeCount %s without a maximum',
      badgeCount => {
        const notification = Object.freeze({ badgeCount, categoryId: 'badge-category' });
        const validated = validateIOSNotification(notification);

        expect(Object.is(validated.badgeCount, badgeCount)).toBe(true);
        expect(validated.categoryId).toBe('badge-category');
        expect(Object.is(notification.badgeCount, badgeCount)).toBe(true);
      },
    );

    test.each([-1, -0.5, 0.5, 1.5, NaN, Infinity, -Infinity, '7', true, {}])(
      'rejects invalid badgeCount %s',
      badgeCount => {
        expect(() => validateIOSNotification({ badgeCount: badgeCount as any })).toThrowError(
          "'notification.ios.badgeCount' expected a number value >=0.",
        );
      },
    );

    test('still rejects an explicitly present undefined badgeCount', () => {
      const notification: NotificationIOS = { badgeCount: undefined };
      expect(Object.hasOwn(notification, 'badgeCount')).toBe(true);

      expect(() => validateIOSNotification(notification)).toThrowError(
        "'notification.ios.badgeCount' expected a number value >=0.",
      );
    });

    test('returns invalid when an invalid categoryId property is provided', () => {
      const notification: NotificationIOS = {
        categoryId: {} as any,
      };

      expect(() => validateIOSNotification(notification)).toThrowError(
        "'notification.ios.categoryId' expected a of string value",
      );
    });

    test('returns invalid when an invalid threadId property is provided', () => {
      const notification: NotificationIOS = {
        threadId: {} as any,
      };

      expect(() => validateIOSNotification(notification)).toThrowError(
        "'notification.ios.threadId' expected a string value.",
      );
    });

    test('returns invalid when an invalid summaryArgument property is provided', () => {
      const notification: NotificationIOS = {
        summaryArgument: {} as any,
      };

      expect(() => validateIOSNotification(notification)).toThrowError(
        "'notification.ios.summaryArgument' expected a string value.",
      );
    });

    test('returns invalid when an invalid launchImageName property is provided', () => {
      const notification: NotificationIOS = {
        launchImageName: {} as any,
      };

      expect(() => validateIOSNotification(notification)).toThrowError(
        "'notification.ios.launchImageName' expected a string value.",
      );
    });

    test('returns invalid when an invalid communicationInfo property is provided', () => {
      let notification: NotificationIOS = {
        communicationInfo: '' as any,
      };

      expect(() => validateIOSNotification(notification)).toThrowError(
        "'ios.communicationInfo' expected an object.",
      );

      notification = {
        communicationInfo: {} as any,
      };

      expect(() => validateIOSNotification(notification)).toThrowError(
        "'ios.communicationInfo' 'conversationId' expected a valid string value.",
      );
    });
  });
});
