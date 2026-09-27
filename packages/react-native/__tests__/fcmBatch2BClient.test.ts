import { AppState } from 'react-native';
import NotifeeApiModule from 'react-native-notify-kit/src/NotifeeApiModule';
import * as Notifee from 'react-native-notify-kit/src';
import {
  /* @ts-ignore */
  mockNotifeeNativeModule,
} from 'react-native-notify-kit/src/NotifeeNativeModule';
import type { FcmRemoteMessage } from 'react-native-notify-kit/src/fcm/types';
import validateAndroidNotification from 'react-native-notify-kit/src/validators/validateAndroidNotification';
import { buildNotifyKitPayload } from '../server/src/buildPayload';
import { setPlatform } from './testSetup';

jest.mock('react-native-notify-kit/src/NotifeeNativeModule');

const apiModule = new NotifeeApiModule({
  version: Notifee.default.SDK_VERSION,
  nativeModuleName: 'NotifeeApiModule',
  nativeEvents: [],
});

function messageWithAndroid(android: Record<string, unknown>): FcmRemoteMessage {
  return {
    messageId: 'interaction-id',
    data: {
      notifee_options: JSON.stringify({ _v: 1, title: 'Title', body: 'Body', android }),
    },
  };
}

beforeEach(async () => {
  setPlatform('android');
  Object.defineProperty(AppState, 'currentState', { get: () => 'active', configurable: true });
  await apiModule.setFcmConfig({});
  mockNotifeeNativeModule.displayNotification.mockClear();
  mockNotifeeNativeModule.displayNotification.mockResolvedValue(undefined);
});

afterEach(async () => {
  await apiModule.setFcmConfig({});
  setPlatform('android');
});

describe('FCM Mode Batch 2B Android interaction reconstruction', () => {
  it('keeps an absent body pressAction absent before normal validation and preserves the existing tap default', async () => {
    const message = messageWithAndroid({ channelId: 'news' });
    expect(apiModule.buildFcmNotification(message)?.android).not.toHaveProperty('pressAction');

    await apiModule.handleFcmMessage(message);
    expect(
      mockNotifeeNativeModule.displayNotification.mock.calls[0][0].android.pressAction,
    ).toEqual({
      id: 'default',
      launchActivity: 'default',
    });
  });

  it('keeps explicit null despite a configured default and reaches the native opt-out sentinel', async () => {
    await apiModule.setFcmConfig({ defaultPressAction: { id: 'configured' } });
    const message = messageWithAndroid({ channelId: 'news', pressAction: null });
    expect(apiModule.buildFcmNotification(message)?.android?.pressAction).toBeNull();

    await apiModule.handleFcmMessage(message);
    expect(
      mockNotifeeNativeModule.displayNotification.mock.calls[0][0].android.pressAction,
    ).toEqual({
      id: '__NOTIFEE_OPT_OUT__',
    });
  });

  it('keeps an explicit ordinary body pressAction', async () => {
    const message = messageWithAndroid({ channelId: 'news', pressAction: { id: 'open' } });
    expect(apiModule.buildFcmNotification(message)?.android?.pressAction).toEqual({ id: 'open' });
    await apiModule.handleFcmMessage(message);
    expect(
      mockNotifeeNativeModule.displayNotification.mock.calls[0][0].android.pressAction,
    ).toEqual({
      id: 'open',
    });
  });

  it.each([
    { id: 'screen', mainComponent: 'DetailsScreen' },
    {
      id: 'flags',
      launchActivityFlags: [
        Notifee.AndroidLaunchActivityFlag.NEW_TASK,
        Notifee.AndroidLaunchActivityFlag.SINGLE_TOP,
      ],
    },
  ])('keeps a partial body pressAction: %j', async pressAction => {
    const message = messageWithAndroid({ channelId: 'news', pressAction });
    expect(apiModule.buildFcmNotification(message)?.android?.pressAction).toEqual(pressAction);
    await apiModule.handleFcmMessage(message);
    expect(
      mockNotifeeNativeModule.displayNotification.mock.calls[0][0].android.pressAction,
    ).toEqual(pressAction);
  });

  it('carries mainComponent and ordered launchActivityFlags through the normal validator', async () => {
    const pressAction = {
      id: 'open',
      launchActivity: 'default',
      mainComponent: 'OrderScreen',
      launchActivityFlags: [
        Notifee.AndroidLaunchActivityFlag.CLEAR_TOP,
        Notifee.AndroidLaunchActivityFlag.NEW_TASK,
      ],
    };
    const message = messageWithAndroid({ channelId: 'news', pressAction });
    expect(apiModule.buildFcmNotification(message)?.android?.pressAction).toEqual(pressAction);

    await apiModule.handleFcmMessage(message);
    expect(
      mockNotifeeNativeModule.displayNotification.mock.calls[0][0].android.pressAction,
    ).toEqual(pressAction);
  });

  it('maps a legacy input:false to no input before normal validation', async () => {
    const message = messageWithAndroid({
      channelId: 'news',
      actions: [
        { title: 'Before', pressAction: { id: 'before' }, input: true },
        { title: 'Open', pressAction: { id: 'open' }, input: false },
        { title: 'After', pressAction: { id: 'after' } },
      ],
    });
    const reconstructedActions = apiModule.buildFcmNotification(message)?.android?.actions;
    expect(reconstructedActions?.map(action => action.title)).toEqual(['Before', 'Open', 'After']);
    expect(reconstructedActions?.[1]).not.toHaveProperty('input');

    await apiModule.handleFcmMessage(message);
    const nativeActions =
      mockNotifeeNativeModule.displayNotification.mock.calls[0][0].android.actions;
    expect(nativeActions.map((action: { title: string }) => action.title)).toEqual([
      'Before',
      'Open',
      'After',
    ]);
    expect(nativeActions[1]).not.toHaveProperty('input');
  });

  it.each([null, 'reply', 1, []])('rejects malformed legacy action input %p', async input => {
    const message = messageWithAndroid({
      channelId: 'news',
      actions: [{ title: 'Reply', pressAction: { id: 'reply' }, input }],
    });

    expect(() => apiModule.buildFcmNotification(message)).toThrow(/input/);
    await expect(apiModule.handleFcmMessage(message)).rejects.toThrow(/input/);
    expect(mockNotifeeNativeModule.displayNotification).not.toHaveBeenCalled();
  });

  it('rejects a legacy AndroidInput object with an unsupported field instead of dropping it', async () => {
    const message = messageWithAndroid({
      channelId: 'news',
      actions: [{ title: 'Reply', pressAction: { id: 'reply' }, input: { unsupported: 'reply' } }],
    });

    expect(() => apiModule.buildFcmNotification(message)).toThrow(/input.*unsupported/);
    await expect(apiModule.handleFcmMessage(message)).rejects.toThrow(/input.*unsupported/);
    expect(mockNotifeeNativeModule.displayNotification).not.toHaveBeenCalled();
  });

  it.each([true, { choices: ['Later', 'Now'], allowGeneratedReplies: false }])(
    'preserves supported legacy action input %p',
    async input => {
      const message = messageWithAndroid({
        channelId: 'news',
        actions: [{ title: 'Reply', pressAction: { id: 'reply' }, input }],
      });

      expect(apiModule.buildFcmNotification(message)?.android?.actions?.[0].input).toEqual(input);
      await apiModule.handleFcmMessage(message);
      const nativeInput =
        mockNotifeeNativeModule.displayNotification.mock.calls[0][0].android.actions[0].input;
      expect(nativeInput).toEqual(
        input === true
          ? { allowFreeFormInput: true, allowGeneratedReplies: true }
          : {
              allowFreeFormInput: true,
              allowGeneratedReplies: false,
              choices: ['Later', 'Now'],
            },
      );
    },
  );

  it.each([
    ['body', { pressAction: { id: '__NOTIFEE_OPT_OUT__' } }],
    ['action', { actions: [{ title: 'Open', pressAction: { id: '__NOTIFEE_OPT_OUT__' } }] }],
  ])('rejects an explicit wire %s opt-out ID', async (_location, android) => {
    const message = messageWithAndroid({ channelId: 'news', ...android });

    expect(() => apiModule.buildFcmNotification(message)).toThrow(/pressAction.*reserved/);
    await expect(apiModule.handleFcmMessage(message)).rejects.toThrow(/pressAction.*reserved/);
    expect(mockNotifeeNativeModule.displayNotification).not.toHaveBeenCalled();
  });

  it('rejects the opt-out ID supplied as a configured default pressAction', async () => {
    await apiModule.setFcmConfig({ defaultPressAction: { id: '__NOTIFEE_OPT_OUT__' } });
    const message = messageWithAndroid({ channelId: 'news' });

    expect(() => apiModule.buildFcmNotification(message)).toThrow(/pressAction.*reserved/);
    await expect(apiModule.handleFcmMessage(message)).rejects.toThrow(/pressAction.*reserved/);
    expect(mockNotifeeNativeModule.displayNotification).not.toHaveBeenCalled();
  });

  it.each([
    ['body', { pressAction: { id: '__NOTIFEE_OPT_OUT__' } }],
    ['action', { actions: [{ title: 'Open', pressAction: { id: '__NOTIFEE_OPT_OUT__' } }] }],
  ])('rejects an explicit public %s opt-out ID at the normal validator', (_location, android) => {
    expect(() =>
      validateAndroidNotification({ channelId: 'news', ...android } as Parameters<
        typeof validateAndroidNotification
      >[0]),
    ).toThrow(/reserved/);
  });

  it('carries a complete Server SDK interaction through serialization, reconstruction and native-facing validation', async () => {
    const pressAction = {
      id: 'open',
      launchActivity: 'default',
      mainComponent: 'OrderScreen',
      launchActivityFlags: [
        Notifee.AndroidLaunchActivityFlag.NEW_TASK,
        Notifee.AndroidLaunchActivityFlag.CLEAR_TOP,
      ],
    };
    const actions = [
      { title: 'Open', pressAction: { id: 'view', mainComponent: 'ViewScreen' }, icon: 'ic_view' },
      {
        title: 'Reply',
        pressAction: {
          id: 'reply',
          launchActivity: 'default',
          mainComponent: 'ReplyScreen',
          launchActivityFlags: [
            Notifee.AndroidLaunchActivityFlag.SINGLE_TOP,
            Notifee.AndroidLaunchActivityFlag.NEW_TASK,
          ],
        },
        input: {
          allowFreeFormInput: true,
          allowGeneratedReplies: false,
          choices: ['Later', 'Soon'],
          editableChoices: false,
          placeholder: '',
        },
      },
      { title: 'Quick reply', pressAction: { id: 'quick' }, input: true },
    ];
    const payload = buildNotifyKitPayload({
      token: 'token',
      notification: {
        title: 'Title',
        body: 'Body',
        android: { channelId: 'news', pressAction, actions },
      },
    });
    const serialized = JSON.parse(payload.data.notifee_options);
    expect(serialized._v).toBe(1);
    expect(serialized.android).toEqual({ channelId: 'news', pressAction, actions });
    const message: FcmRemoteMessage = { messageId: 'interaction-id', data: payload.data };
    expect(apiModule.buildFcmNotification(message)?.android?.actions).toEqual(actions);

    await apiModule.handleFcmMessage(message);
    const nativeAndroid = mockNotifeeNativeModule.displayNotification.mock.calls[0][0].android;
    expect(nativeAndroid.pressAction).toEqual(pressAction);
    expect(nativeAndroid.actions.map((action: { title: string }) => action.title)).toEqual([
      'Open',
      'Reply',
      'Quick reply',
    ]);
    expect(nativeAndroid.actions[0]).toEqual(actions[0]);
    expect(nativeAndroid.actions[1].pressAction).toEqual(actions[1].pressAction);
    expect(nativeAndroid.actions[1].input).toEqual({
      allowFreeFormInput: true,
      allowGeneratedReplies: false,
      choices: ['Later', 'Soon'],
      editableChoices: false,
      placeholder: '',
    });
    expect(nativeAndroid.actions[2].input).toEqual({
      allowFreeFormInput: true,
      allowGeneratedReplies: true,
    });
  });
});
