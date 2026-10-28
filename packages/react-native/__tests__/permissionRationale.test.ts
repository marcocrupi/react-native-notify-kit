import NotifeeApiModule from '../src/NotifeeApiModule';
import notifee from '../src';
// @ts-ignore - Jest replaces the native module with its manual mock.
import { mockNotifeeNativeModule as native } from '../src/NotifeeNativeModule';
import consumerMock from '../jest-mock';
import { setPlatform } from './testSetup';

jest.mock('../src/NotifeeNativeModule');

const api = new NotifeeApiModule({
  version: notifee.SDK_VERSION,
  nativeModuleName: 'NotifeeApiModule',
  nativeEvents: [],
});

describe('notification permission rationale', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPlatform('android');
  });

  afterEach(() => setPlatform('ios'));

  test('the public singleton exposes the query', () => {
    expect(typeof notifee.shouldShowRequestPermissionRationale).toBe('function');
  });

  test.each([true, false])(
    'returns the native recommendation %s without requesting permission',
    async value => {
      native.shouldShowRequestPermissionRationale.mockResolvedValueOnce(value);
      await expect(api.shouldShowRequestPermissionRationale()).resolves.toBe(value);
      expect(native.shouldShowRequestPermissionRationale).toHaveBeenCalledWith();
      expect(native.requestPermission).not.toHaveBeenCalled();
      expect(native.getNotificationSettings).not.toHaveBeenCalled();
      expect(native.openNotificationSettings).not.toHaveBeenCalled();
    },
  );

  test('queries again after platform state changes', async () => {
    native.shouldShowRequestPermissionRationale
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    for (const expected of [false, true, false]) {
      await expect(api.shouldShowRequestPermissionRationale()).resolves.toBe(expected);
    }
    expect(native.shouldShowRequestPermissionRationale).toHaveBeenCalledTimes(3);
  });

  test('propagates unavailability and platform errors instead of returning false', async () => {
    const unavailable = Object.assign(new Error('No current Activity'), {
      code: 'ERR_NO_ACTIVITY',
    });
    native.shouldShowRequestPermissionRationale.mockRejectedValueOnce(unavailable);
    await expect(api.shouldShowRequestPermissionRationale()).rejects.toBe(unavailable);
  });

  test.each(['ios', 'web'])('%s resolves false without accessing native', async platform => {
    setPlatform(platform);
    const unsupportedApi = new NotifeeApiModule({
      version: notifee.SDK_VERSION,
      nativeModuleName: 'NotifeeApiModule',
      nativeEvents: [],
    });
    const nativeAccess = jest.fn(() => native);
    Object.defineProperty(unsupportedApi, 'native', { get: nativeAccess });
    await expect(unsupportedApi.shouldShowRequestPermissionRationale()).resolves.toBe(false);
    expect(nativeAccess).not.toHaveBeenCalled();
  });

  test('the consumer mock resolves a boolean', async () => {
    await expect(consumerMock.shouldShowRequestPermissionRationale()).resolves.toBe(false);
  });
});
