/**
 * @format
 */

import '@react-native-firebase/app';
import '@react-native-firebase/messaging';
import { Alert, AppRegistry, Platform } from 'react-native';
import notifee, { EventType } from 'react-native-notify-kit';
import App from './App';
import { name as appName } from './app.json';

// Build a reverse map from numeric EventType values to readable names.
// Uses the runtime enum object as single source of truth.
const EVENT_NAMES = Object.fromEntries(
  Object.entries(EventType)
    .filter(([, v]) => typeof v === 'number')
    .map(([name, value]) => [value, name]),
);

// Handle notification events when the app is in the background or killed.
// Must be registered before AppRegistry.registerComponent().
notifee.onBackgroundEvent(async ({ type, detail }) => {
  const typeName = EVENT_NAMES[type] ?? String(type);
  console.log(
    '[BackgroundEvent]',
    typeName,
    'id:',
    detail.notification?.id,
    'title:',
    detail.notification?.title,
    'data:',
    JSON.stringify(detail.notification?.data),
  );
  Alert.alert(
    `BackgroundEvent (${typeName})`,
    `ID: ${detail.notification?.id}\n` +
      `Title: ${detail.notification?.title}\n` +
      `Data: ${JSON.stringify(detail.notification?.data)}`,
  );
});

// Register a foreground service runner for notifications displayed with
// android.asForegroundService = true. The runner receives the notification
// and must return a Promise that resolves when the service work is done.
// Android-only API — no-op on iOS but guarded for clarity.
if (Platform.OS === 'android') {
  notifee.registerForegroundService(notification => {
    return new Promise(resolve => {
      console.log('[ForegroundService] started for', notification.id);
      // Resolve immediately for smoke testing; real apps do long-running work here.
      resolve();
    });
  });
}

AppRegistry.registerComponent(appName, () => App);
