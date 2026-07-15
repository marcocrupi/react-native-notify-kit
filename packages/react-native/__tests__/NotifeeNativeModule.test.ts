const mockNativeModule = {
  addListener: jest.fn(),
  removeListeners: jest.fn(),
  getConstants: jest.fn(() => ({ ANDROID_API_LEVEL: 33 })),
};
const mockGetEnforcing = jest.fn();
const mockAddNativeListener = jest.fn();
const mockNativeEventEmitter = jest.fn();
const mockRegisterHeadlessTask = jest.fn();

type NativeListener = (payload: any) => void;

let nativeListeners: Map<string, NativeListener>;
let foregroundCleanups: Array<() => void>;

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

const foregroundEventName = nativeModuleConfig.nativeEvents[0];

function getNativeListener(eventName: string): NativeListener {
  const listener = nativeListeners.get(eventName);
  if (!listener) {
    throw new Error(`Native listener not registered for ${eventName}`);
  }
  return listener;
}

function trackForegroundCleanup(cleanup: () => void): () => void {
  let active = true;
  const trackedCleanup = (): void => {
    if (active) {
      active = false;
      cleanup();
    }
  };
  foregroundCleanups.push(trackedCleanup);
  return trackedCleanup;
}

describe('NotifeeNativeModule lazy native resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    nativeListeners = new Map();
    foregroundCleanups = [];
    mockGetEnforcing.mockReturnValue(mockNativeModule);
    mockNativeEventEmitter.mockImplementation(() => ({
      addListener: mockAddNativeListener,
    }));
    mockAddNativeListener.mockImplementation((eventName: string, listener: NativeListener) => {
      nativeListeners.set(eventName, listener);
      return { remove: jest.fn() };
    });
  });

  afterEach(() => {
    for (let i = 0; i < foregroundCleanups.length; i++) {
      foregroundCleanups[i]();
    }
  });

  test('importing the package does not resolve the native module or register native listeners', () => {
    jest.isolateModules(() => {
      expect(require('react-native-notify-kit').default).toBeDefined();
    });

    expect(mockGetEnforcing).not.toHaveBeenCalled();
    expect(mockNativeEventEmitter).not.toHaveBeenCalled();
    expect(mockAddNativeListener).not.toHaveBeenCalled();
  });

  test('constructing native and API modules does not register native listeners', () => {
    const nativeModule = new NotifeeNativeModule(nativeModuleConfig);
    const apiModule = new NotifeeApiModule(nativeModuleConfig);

    expect(nativeModule).toBeDefined();
    expect(apiModule).toBeDefined();
    expect(mockGetEnforcing).not.toHaveBeenCalled();
    expect(mockNativeEventEmitter).not.toHaveBeenCalled();
    expect(mockAddNativeListener).not.toHaveBeenCalled();
  });

  test('onBackgroundEvent remains lazy', () => {
    const apiModule = new NotifeeApiModule(nativeModuleConfig);

    apiModule.onBackgroundEvent(async () => undefined);

    expect(mockGetEnforcing).not.toHaveBeenCalled();
    expect(mockNativeEventEmitter).not.toHaveBeenCalled();
    expect(mockAddNativeListener).not.toHaveBeenCalled();
  });

  test('onForegroundEvent synchronously initializes the native relay', () => {
    const apiModule = new NotifeeApiModule(nativeModuleConfig);

    const unsubscribe = trackForegroundCleanup(apiModule.onForegroundEvent(() => undefined));

    expect(unsubscribe).toEqual(expect.any(Function));
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

  test('relays a subsequent native foreground event without changing type or detail', () => {
    const apiModule = new NotifeeApiModule(nativeModuleConfig);
    const observer = jest.fn();
    const detail = {
      notification: { id: 'foreground-event-id' },
      pressAction: { id: 'default' },
    };

    trackForegroundCleanup(apiModule.onForegroundEvent(observer));
    getNativeListener(foregroundEventName)({ type: 1, detail });

    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledWith({ type: 1, detail });
    expect(observer.mock.calls[0][0].detail).toBe(detail);
  });

  test('multiple foreground observers share one native relay', () => {
    const apiModule = new NotifeeApiModule(nativeModuleConfig);
    const firstObserver = jest.fn();
    const secondObserver = jest.fn();

    trackForegroundCleanup(apiModule.onForegroundEvent(firstObserver));
    trackForegroundCleanup(apiModule.onForegroundEvent(secondObserver));
    getNativeListener(foregroundEventName)({ type: 1, detail: { notification: { id: 'shared' } } });

    expect(mockGetEnforcing).toHaveBeenCalledTimes(1);
    expect(mockNativeEventEmitter).toHaveBeenCalledTimes(1);
    expect(mockAddNativeListener).toHaveBeenCalledTimes(nativeModuleConfig.nativeEvents.length);
    expect(firstObserver).toHaveBeenCalledTimes(1);
    expect(secondObserver).toHaveBeenCalledTimes(1);
  });

  test('foreground cleanup removes only its observer and later registrations reuse the relay', () => {
    const apiModule = new NotifeeApiModule(nativeModuleConfig);
    const firstObserver = jest.fn();
    const secondObserver = jest.fn();
    const laterObserver = jest.fn();
    const firstCleanup = trackForegroundCleanup(apiModule.onForegroundEvent(firstObserver));

    trackForegroundCleanup(apiModule.onForegroundEvent(secondObserver));
    firstCleanup();
    getNativeListener(foregroundEventName)({
      type: 1,
      detail: { notification: { id: 'after-cleanup' } },
    });

    expect(firstObserver).not.toHaveBeenCalled();
    expect(secondObserver).toHaveBeenCalledTimes(1);

    trackForegroundCleanup(apiModule.onForegroundEvent(laterObserver));
    getNativeListener(foregroundEventName)({ type: 2, detail: { notification: { id: 'later' } } });

    expect(firstObserver).not.toHaveBeenCalled();
    expect(secondObserver).toHaveBeenCalledTimes(2);
    expect(laterObserver).toHaveBeenCalledTimes(1);
    expect(mockGetEnforcing).toHaveBeenCalledTimes(1);
    expect(mockNativeEventEmitter).toHaveBeenCalledTimes(1);
    expect(mockAddNativeListener).toHaveBeenCalledTimes(nativeModuleConfig.nativeEvents.length);
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
