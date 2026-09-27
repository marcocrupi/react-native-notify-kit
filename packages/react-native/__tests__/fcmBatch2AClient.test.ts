import { AppState } from 'react-native';
import NotifeeApiModule from 'react-native-notify-kit/src/NotifeeApiModule';
import * as Notifee from 'react-native-notify-kit/src';
import {
  /* @ts-ignore */
  mockNotifeeNativeModule,
} from 'react-native-notify-kit/src/NotifeeNativeModule';
import type { FcmRemoteMessage } from 'react-native-notify-kit/src/fcm/types';
import { buildNotifyKitPayload } from '../server/src/buildPayload';
import type { NotifyKitPayloadInput } from '../server/src/types';
import { setPlatform } from './testSetup';

jest.mock('react-native-notify-kit/src/NotifeeNativeModule');

const apiModule = new NotifeeApiModule({
  version: Notifee.default.SDK_VERSION,
  nativeModuleName: 'NotifeeApiModule',
  nativeEvents: [],
});

function messageWithOptions(options: Record<string, unknown>): FcmRemoteMessage {
  return {
    messageId: 'batch-2a-id',
    data: { notifee_options: JSON.stringify(options) },
  };
}

function androidOptions(android: Record<string, unknown>): Record<string, unknown> {
  return {
    _v: 1,
    title: 'Main title',
    body: 'Main body',
    android: { channelId: 'news', ...android },
  };
}

beforeEach(async () => {
  setPlatform('android');
  Object.defineProperty(AppState, 'currentState', { get: () => 'active', configurable: true });
  await apiModule.setFcmConfig({});
});

afterEach(async () => {
  await apiModule.setFcmConfig({});
  setPlatform('android');
  mockNotifeeNativeModule.displayNotification.mockClear();
});

describe('FCM Mode Batch 2A client reconstruction', () => {
  it('carries a Server SDK BIG_PICTURE payload through FCM reconstruction and native display', async () => {
    const input: NotifyKitPayloadInput = {
      token: 'device-token',
      notification: {
        title: 'Server title',
        subtitle: 'Server subtitle',
        body: 'Server body',
        android: {
          channelId: 'news',
          largeIcon: 'https://cdn.example.com/main.png',
          circularLargeIcon: false,
          style: {
            type: 'BIG_PICTURE',
            picture: 'https://cdn.example.com/picture.png',
            title: 'Expanded title',
            summary: 'Expanded summary',
            largeIcon: null,
          },
        },
      },
    };
    const payload = buildNotifyKitPayload(input);
    const remoteMessage: FcmRemoteMessage = {
      messageId: 'cross-boundary-picture',
      data: payload.data,
    };

    expect(JSON.parse(payload.data.notifee_options)._v).toBe(1);
    expect(payload.sizeBytes).toBe(
      Buffer.byteLength(
        JSON.stringify({
          token: payload.token,
          data: payload.data,
          android: payload.android,
          apns: payload.apns,
        }),
        'utf8',
      ),
    );

    const reconstructed = apiModule.buildFcmNotification(remoteMessage);
    expect(reconstructed?.subtitle).toBe('Server subtitle');
    expect(reconstructed?.android?.circularLargeIcon).toBe(false);
    expect(reconstructed?.android?.style).toEqual({
      type: Notifee.AndroidStyle.BIGPICTURE,
      picture: 'https://cdn.example.com/picture.png',
      title: 'Expanded title',
      summary: 'Expanded summary',
      largeIcon: null,
    });

    mockNotifeeNativeModule.displayNotification.mockResolvedValueOnce(undefined);
    await expect(apiModule.handleFcmMessage(remoteMessage)).resolves.toBe('cross-boundary-picture');
    expect(mockNotifeeNativeModule.displayNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        subtitle: 'Server subtitle',
        android: expect.objectContaining({
          circularLargeIcon: false,
          style: {
            type: Notifee.AndroidStyle.BIGPICTURE,
            picture: 'https://cdn.example.com/picture.png',
            title: 'Expanded title',
            summary: 'Expanded summary',
            largeIcon: null,
          },
        }),
      }),
    );
  });

  it('carries a Server SDK BIG_TEXT payload through FCM reconstruction and native display', async () => {
    const input: NotifyKitPayloadInput = {
      token: 'device-token',
      notification: {
        title: 'Server title',
        subtitle: 'Server subtitle',
        body: 'Server body',
        android: {
          channelId: 'news',
          style: {
            type: 'BIG_TEXT',
            text: 'Expanded text',
            title: 'Expanded title',
            summary: 'Expanded summary',
          },
        },
      },
    };
    const payload = buildNotifyKitPayload(input);
    const remoteMessage: FcmRemoteMessage = {
      messageId: 'cross-boundary-text',
      data: payload.data,
    };

    expect(JSON.parse(payload.data.notifee_options)._v).toBe(1);
    const reconstructed = apiModule.buildFcmNotification(remoteMessage);
    expect(reconstructed?.android?.style).toEqual({
      type: Notifee.AndroidStyle.BIGTEXT,
      text: 'Expanded text',
      title: 'Expanded title',
      summary: 'Expanded summary',
    });

    mockNotifeeNativeModule.displayNotification.mockResolvedValueOnce(undefined);
    await expect(apiModule.handleFcmMessage(remoteMessage)).resolves.toBe('cross-boundary-text');
    expect(mockNotifeeNativeModule.displayNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        subtitle: 'Server subtitle',
        android: expect.objectContaining({
          style: {
            type: Notifee.AndroidStyle.BIGTEXT,
            text: 'Expanded text',
            title: 'Expanded title',
            summary: 'Expanded summary',
          },
        }),
      }),
    );
  });

  it.each(['android', 'ios'] as const)(
    'preserves a top-level subtitle on %s through the public FCM builder',
    platform => {
      setPlatform(platform);
      const notification = apiModule.buildFcmNotification(
        messageWithOptions({ _v: 1, title: 'Main', subtitle: 'Second line', body: 'Body' }),
      );

      expect(notification).toEqual(
        expect.objectContaining({
          id: 'batch-2a-id',
          title: 'Main',
          subtitle: 'Second line',
          body: 'Body',
        }),
      );
      expect(Object.prototype.hasOwnProperty.call(notification, 'subtitle')).toBe(true);
    },
  );

  it('preserves circularLargeIcon true when a largeIcon is present', () => {
    const notification = apiModule.buildFcmNotification(
      messageWithOptions(
        androidOptions({ largeIcon: 'https://cdn.example.com/icon.png', circularLargeIcon: true }),
      ),
    );

    expect(notification?.android).toEqual({
      channelId: 'news',
      largeIcon: 'https://cdn.example.com/icon.png',
      circularLargeIcon: true,
    });
  });

  it('distinguishes explicit circularLargeIcon false from an absent field', () => {
    const base = { largeIcon: 'https://cdn.example.com/icon.png' };
    const explicit = apiModule.buildFcmNotification(
      messageWithOptions(androidOptions({ ...base, circularLargeIcon: false })),
    );
    const absent = apiModule.buildFcmNotification(messageWithOptions(androidOptions(base)));

    expect(explicit?.android?.circularLargeIcon).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(explicit?.android, 'circularLargeIcon')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(absent?.android, 'circularLargeIcon')).toBe(false);
    expect(absent?.android).toEqual({ channelId: 'news', largeIcon: base.largeIcon });
  });

  it.each([
    ['title', 'Expanded text title'],
    ['summary', 'Expanded text summary'],
  ] as const)(
    'preserves BIG_TEXT.%s independently of other optional style fields',
    (field, value) => {
      const notification = apiModule.buildFcmNotification(
        messageWithOptions(
          androidOptions({
            style: { type: 'BIG_TEXT', text: 'Required expanded text', [field]: value },
          }),
        ),
      );

      expect(notification?.android?.style).toEqual({
        type: Notifee.AndroidStyle.BIGTEXT,
        text: 'Required expanded text',
        [field]: value,
      });
    },
  );

  it.each([
    ['title', 'Expanded picture title'],
    ['summary', 'Expanded picture summary'],
    ['largeIcon', 'https://cdn.example.com/expanded-icon.png'],
    ['largeIcon', null],
  ] as const)('preserves BIG_PICTURE.%s value %s', (field, value) => {
    const notification = apiModule.buildFcmNotification(
      messageWithOptions(
        androidOptions({
          style: {
            type: 'BIG_PICTURE',
            picture: 'https://cdn.example.com/picture.png',
            [field]: value,
          },
        }),
      ),
    );

    expect(notification?.android?.style).toEqual({
      type: Notifee.AndroidStyle.BIGPICTURE,
      picture: 'https://cdn.example.com/picture.png',
      [field]: value,
    });
  });

  it('preserves the Android kitchen sink through reconstruction and normal display validation', async () => {
    const message = messageWithOptions({
      _v: 1,
      title: 'Shipment',
      subtitle: 'Arriving today',
      body: 'Open for details',
      android: {
        channelId: 'news',
        largeIcon: 'https://cdn.example.com/main-icon.png',
        circularLargeIcon: false,
        style: {
          type: 'BIG_PICTURE',
          picture: 'https://cdn.example.com/shipment.png',
          title: 'Expanded shipment',
          summary: 'Expected by 6 PM',
          largeIcon: null,
        },
      },
    });

    const reconstructed = apiModule.buildFcmNotification(message);
    expect(reconstructed?.subtitle).toBe('Arriving today');
    expect(reconstructed?.android?.circularLargeIcon).toBe(false);
    expect(reconstructed?.android?.style).toEqual({
      type: Notifee.AndroidStyle.BIGPICTURE,
      picture: 'https://cdn.example.com/shipment.png',
      title: 'Expanded shipment',
      summary: 'Expected by 6 PM',
      largeIcon: null,
    });

    mockNotifeeNativeModule.displayNotification.mockResolvedValueOnce(undefined);
    await expect(apiModule.handleFcmMessage(message)).resolves.toBe('batch-2a-id');
    expect(mockNotifeeNativeModule.displayNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        subtitle: 'Arriving today',
        android: expect.objectContaining({
          largeIcon: 'https://cdn.example.com/main-icon.png',
          circularLargeIcon: false,
          style: {
            type: Notifee.AndroidStyle.BIGPICTURE,
            picture: 'https://cdn.example.com/shipment.png',
            title: 'Expanded shipment',
            summary: 'Expected by 6 PM',
            largeIcon: null,
          },
        }),
      }),
    );
  });

  it('preserves all BIG_TEXT nested fields together through the normal validator', async () => {
    const message = messageWithOptions(
      androidOptions({
        style: {
          type: 'BIG_TEXT',
          text: 'Required expanded text',
          title: 'Expanded text title',
          summary: 'Expanded text summary',
        },
      }),
    );

    mockNotifeeNativeModule.displayNotification.mockResolvedValueOnce(undefined);
    await apiModule.handleFcmMessage(message);

    expect(mockNotifeeNativeModule.displayNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        android: expect.objectContaining({
          style: {
            type: Notifee.AndroidStyle.BIGTEXT,
            text: 'Required expanded text',
            title: 'Expanded text title',
            summary: 'Expanded text summary',
          },
        }),
      }),
    );
  });

  it('preserves an iOS subtitle through the normal validator', async () => {
    setPlatform('ios');
    const message = messageWithOptions({
      _v: 1,
      title: 'Main',
      subtitle: 'iOS subtitle',
      body: 'Body',
    });

    mockNotifeeNativeModule.displayNotification.mockResolvedValueOnce(undefined);
    await apiModule.handleFcmMessage(message);

    expect(mockNotifeeNativeModule.displayNotification).toHaveBeenCalledWith(
      expect.objectContaining({ subtitle: 'iOS subtitle' }),
    );
  });

  it('keeps old version-1 payloads unchanged when Batch 2A fields are omitted', () => {
    const legacyText = apiModule.buildFcmNotification(
      messageWithOptions(
        androidOptions({ style: { type: 'BIG_TEXT', text: 'Only required text' } }),
      ),
    );
    const legacyPicture = apiModule.buildFcmNotification(
      messageWithOptions(
        androidOptions({
          style: { type: 'BIG_PICTURE', picture: 'https://cdn.example.com/old.png' },
        }),
      ),
    );

    expect(Object.prototype.hasOwnProperty.call(legacyText, 'subtitle')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(legacyText?.android, 'circularLargeIcon')).toBe(
      false,
    );
    expect(legacyText?.android?.style).toEqual({
      type: Notifee.AndroidStyle.BIGTEXT,
      text: 'Only required text',
    });
    expect(legacyPicture?.android?.style).toEqual({
      type: Notifee.AndroidStyle.BIGPICTURE,
      picture: 'https://cdn.example.com/old.png',
    });
    expect(Object.prototype.hasOwnProperty.call(legacyPicture?.android?.style, 'largeIcon')).toBe(
      false,
    );
  });

  it('does not forward malformed optional wire values to normal display validation', async () => {
    const message = messageWithOptions({
      _v: 1,
      title: 'Main',
      subtitle: 42,
      body: 'Body',
      android: {
        channelId: 'news',
        largeIcon: 'https://cdn.example.com/main-icon.png',
        circularLargeIcon: 'false',
        style: {
          type: 'BIG_PICTURE',
          picture: 'https://cdn.example.com/picture.png',
          title: 4,
          summary: false,
          largeIcon: true,
        },
      },
    });
    const reconstructed = apiModule.buildFcmNotification(message);

    expect(Object.prototype.hasOwnProperty.call(reconstructed, 'subtitle')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(reconstructed?.android, 'circularLargeIcon')).toBe(
      false,
    );
    expect(reconstructed?.android?.style).toEqual({
      type: Notifee.AndroidStyle.BIGPICTURE,
      picture: 'https://cdn.example.com/picture.png',
    });

    mockNotifeeNativeModule.displayNotification.mockResolvedValueOnce(undefined);
    await expect(apiModule.handleFcmMessage(message)).resolves.toBe('batch-2a-id');
  });
});
