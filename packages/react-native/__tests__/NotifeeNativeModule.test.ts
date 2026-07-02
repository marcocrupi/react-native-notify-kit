const mockNativeModule = {
  addListener: jest.fn(),
  removeListeners: jest.fn(),
  getConstants: jest.fn(() => ({ ANDROID_API_LEVEL: 33 })),
};
const mockGetEnforcing = jest.fn();
const mockAddNativeListener = jest.fn();
const mockNativeEventEmitter = jest.fn();
const mockRegisterHeadlessTask = jest.fn();

jest.mock('react-native', () => {
  return {
    AppRegistry: {
      registerHeadlessTask: mockRegisterHeadlessTask,
    },
    AppState: {
      currentState: 'active',
    },
    NativeEventEmitter: mockNativeEventEmitter,
    NativeModules: {
      NotifeeApiModule: mockNativeModule,
    },
    Platform: {
      OS: 'android',
      Version: 33,
    },
    TurboModuleRegistry: {
      getEnforcing: mockGetEnforcing,
    },
  };
});

const NotifeeApiModule = require('react-native-notify-kit/src/NotifeeApiModule').default;
const NotifeeNativeModule = require('react-native-notify-kit/src/NotifeeNativeModule').default;

const nativeModuleConfig = {
  version: '1.0.0',
  nativeModuleName: 'NotifeeApiModule',
  nativeEvents: ['app.notifee.notification-event', 'app.notifee.notification-event-background'],
};

describe('NotifeeNativeModule lazy native resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEnforcing.mockReturnValue(mockNativeModule);
    mockNativeEventEmitter.mockImplementation(() => ({
      addListener: mockAddNativeListener,
    }));
    mockAddNativeListener.mockImplementation(() => ({ remove: jest.fn() }));
  });

  test('constructor does not resolve native module or register native listeners', () => {
    const nativeModule = new NotifeeNativeModule(nativeModuleConfig);

    expect(nativeModule).toBeDefined();
    expect(mockGetEnforcing).not.toHaveBeenCalled();
    expect(mockNativeEventEmitter).not.toHaveBeenCalled();
    expect(mockAddNativeListener).not.toHaveBeenCalled();
  });

  test('listener registration APIs remain safe before native lookup', () => {
    const apiModule = new NotifeeApiModule(nativeModuleConfig);

    apiModule.onBackgroundEvent(async () => undefined);
    const unsubscribe = apiModule.onForegroundEvent(() => undefined);
    unsubscribe();

    expect(mockGetEnforcing).not.toHaveBeenCalled();
    expect(mockNativeEventEmitter).not.toHaveBeenCalled();
    expect(mockAddNativeListener).not.toHaveBeenCalled();
  });

  test('first native access resolves module and registers native listeners once', () => {
    const nativeModule = new NotifeeNativeModule(nativeModuleConfig);

    expect(nativeModule.native).toBe(mockNativeModule);
    expect(nativeModule.native).toBe(mockNativeModule);

    expect(mockGetEnforcing).toHaveBeenCalledTimes(1);
    expect(mockGetEnforcing).toHaveBeenCalledWith('NotifeeApiModule');
    expect(mockNativeEventEmitter).toHaveBeenCalledTimes(1);
    expect(mockNativeEventEmitter).toHaveBeenCalledWith(mockNativeModule);
    expect(mockAddNativeListener).toHaveBeenCalledTimes(nativeModuleConfig.nativeEvents.length);
    expect(mockAddNativeListener).toHaveBeenNthCalledWith(
      1,
      nativeModuleConfig.nativeEvents[0],
      expect.any(Function),
    );
    expect(mockAddNativeListener).toHaveBeenNthCalledWith(
      2,
      nativeModuleConfig.nativeEvents[1],
      expect.any(Function),
    );
  });

  test('getEnforcing errors propagate and do not mark native module initialized', () => {
    const error = new Error('native module missing');
    mockGetEnforcing.mockImplementationOnce(() => {
      throw error;
    });
    const nativeModule = new NotifeeNativeModule(nativeModuleConfig);

    expect(() => nativeModule.native).toThrow(error);
    expect(mockNativeEventEmitter).not.toHaveBeenCalled();

    expect(nativeModule.native).toBe(mockNativeModule);
    expect(mockGetEnforcing).toHaveBeenCalledTimes(2);
    expect(mockNativeEventEmitter).toHaveBeenCalledTimes(1);
  });

  test('NativeEventEmitter errors propagate and allow a later retry', () => {
    const error = new Error('native emitter failed');
    mockNativeEventEmitter.mockImplementationOnce(() => {
      throw error;
    });
    const nativeModule = new NotifeeNativeModule(nativeModuleConfig);

    expect(() => nativeModule.native).toThrow(error);
    expect(mockAddNativeListener).not.toHaveBeenCalled();

    expect(nativeModule.native).toBe(mockNativeModule);
    expect(mockGetEnforcing).toHaveBeenCalledTimes(2);
    expect(mockNativeEventEmitter).toHaveBeenCalledTimes(2);
    expect(mockAddNativeListener).toHaveBeenCalledTimes(nativeModuleConfig.nativeEvents.length);
  });

  test('listener registration errors clean up partial subscriptions and allow retry', () => {
    const error = new Error('native listener failed');
    const partialSubscription = { remove: jest.fn() };
    mockAddNativeListener
      .mockImplementationOnce(() => partialSubscription)
      .mockImplementationOnce(() => {
        throw error;
      });
    const nativeModule = new NotifeeNativeModule(nativeModuleConfig);

    expect(() => nativeModule.native).toThrow(error);
    expect(partialSubscription.remove).toHaveBeenCalledTimes(1);

    expect(nativeModule.native).toBe(mockNativeModule);
    expect(mockGetEnforcing).toHaveBeenCalledTimes(2);
    expect(mockNativeEventEmitter).toHaveBeenCalledTimes(2);
    expect(mockAddNativeListener).toHaveBeenCalledTimes(nativeModuleConfig.nativeEvents.length * 2);
  });
});
