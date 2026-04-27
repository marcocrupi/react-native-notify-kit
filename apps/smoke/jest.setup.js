jest.mock('react-native-notify-kit', () => {
  const publicMock = require('react-native-notify-kit/jest-mock');
  const defaultExport = publicMock.default ?? publicMock;

  return {
    __esModule: true,
    ...publicMock,
    default: {
      ...defaultExport,
      getInitialNotification: jest.fn(async () => null),
      handleFcmMessage: jest.fn(async () => undefined),
      setFcmConfig: jest.fn(),
      setNotificationConfig: jest.fn(async () => undefined),
      prewarmForegroundService: jest.fn(async () => undefined),
      openAlarmPermissionSettings: jest.fn(async () => undefined),
    },
  };
});

jest.mock('@react-native-firebase/app', () => ({
  __esModule: true,
  default: jest.fn(() => ({})),
  firebase: {
    app: jest.fn(() => ({})),
  },
}));

jest.mock('@react-native-firebase/messaging/lib/modular', () => {
  const mockMessaging = {};

  return {
    __esModule: true,
    getMessaging: jest.fn(() => mockMessaging),
    getToken: jest.fn(async () => 'mock-fcm-token'),
    onMessage: jest.fn(() => jest.fn()),
    onNotificationOpenedApp: jest.fn(() => jest.fn()),
    getInitialNotification: jest.fn(async () => null),
    setBackgroundMessageHandler: jest.fn(),
  };
});

jest.mock('@react-native-firebase/messaging', () => {
  const messaging = jest.fn(() => ({
    getToken: jest.fn(async () => 'mock-fcm-token'),
    onMessage: jest.fn(() => jest.fn()),
    onNotificationOpenedApp: jest.fn(() => jest.fn()),
    getInitialNotification: jest.fn(async () => null),
    setBackgroundMessageHandler: jest.fn(),
  }));

  return {
    __esModule: true,
    default: messaging,
  };
});

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');

  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };

  return {
    __esModule: true,
    SafeAreaProvider: ({ children }) => React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children, ...props }) => React.createElement(View, props, children),
    useSafeAreaInsets: jest.fn(() => insets),
    useSafeAreaFrame: jest.fn(() => frame),
    initialWindowMetrics: {
      frame,
      insets,
    },
  };
});
