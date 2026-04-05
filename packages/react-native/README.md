# react-native-notify-kit

A feature-rich local and push notification library for React Native (Android & iOS).

Maintained fork of [Notifee](https://github.com/invertase/notifee) — New Architecture only (TurboModules).

## Requirements

- React Native >= 0.73 (New Architecture required)
- Android: minSdk 24, compileSdk 35
- iOS: deployment target 15.1+
- Node.js >= 22

### Compatibility

| React Native | Status                                |
| ------------ | ------------------------------------- |
| 0.84         | Tested (Android + iOS)                |
| 0.73 - 0.83  | Supported (New Architecture required) |
| < 0.73       | Not supported                         |

## Installation

```bash
yarn add react-native-notify-kit
# or
npm install react-native-notify-kit
```

### iOS

```bash
cd ios && pod install
```

### Android

No additional steps — the library is auto-linked via React Native CLI.

## Quick Start

### 1. Request permission (required on Android 13+ and iOS)

```ts
import notifee from 'react-native-notify-kit';

const settings = await notifee.requestPermission();
```

### 2. Create a channel (Android only, required for Android 8+)

```ts
import notifee, { AndroidImportance } from 'react-native-notify-kit';

await notifee.createChannel({
  id: 'default',
  name: 'Default Channel',
  importance: AndroidImportance.HIGH,
});
```

### 3. Display a notification

```ts
await notifee.displayNotification({
  title: 'Hello',
  body: 'This is a local notification',
  android: { channelId: 'default' },
});
```

### 4. Handle events

In your `index.js` (before `AppRegistry.registerComponent`):

```ts
import notifee from 'react-native-notify-kit';

// Background/killed state events
notifee.onBackgroundEvent(async ({ type, detail }) => {
  console.log('Background event:', type, detail.notification?.id);
});
```

In your React component:

```ts
import { useEffect } from 'react';
import notifee, { EventType } from 'react-native-notify-kit';

useEffect(() => {
  return notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.PRESS) {
      console.log('Notification pressed:', detail.notification?.id);
    }
  });
}, []);
```

## Push Notifications (Firebase)

This library handles notification **display and management**. For receiving push notifications, pair it with [`@react-native-firebase/messaging`](https://rnfirebase.io/messaging/usage):

### Android setup

1. Add Firebase dependencies to your app:

   ```bash
   yarn add @react-native-firebase/app @react-native-firebase/messaging
   ```

2. Add the google-services plugin to `android/build.gradle`:

   ```gradle
   classpath("com.google.gms:google-services:4.4.2")
   ```

3. Apply the plugin in `android/app/build.gradle`:

   ```gradle
   apply plugin: "com.google.gms.google-services"
   ```

4. Download `google-services.json` from [Firebase Console](https://console.firebase.google.com/) and place it in `android/app/`.

5. Add `POST_NOTIFICATIONS` permission to `AndroidManifest.xml` (required for Android 13+):

   ```xml
   <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
   ```

### iOS setup

1. Download `GoogleService-Info.plist` from Firebase Console and add it to your Xcode project.

2. Enable **Push Notifications** capability in Xcode:
   - Select your target > **Signing & Capabilities** > **+ Capability** > **Push Notifications**

3. Enable **Background Modes** > **Remote notifications**:
   - Select your target > **Signing & Capabilities** > **+ Capability** > **Background Modes** > check **Remote notifications**

4. Configure APNs certificates or keys in Firebase Console > Project Settings > Cloud Messaging.

### Display a push notification

```ts
import messaging from '@react-native-firebase/messaging';
import notifee from 'react-native-notify-kit';

messaging().onMessage(async remoteMessage => {
  await notifee.displayNotification({
    title: remoteMessage.notification?.title,
    body: remoteMessage.notification?.body,
    android: { channelId: 'default' },
  });
});
```

## iOS Notification Service Extension

To modify push notification content before display (e.g., attach images), create a Notification Service Extension:

1. In Xcode: **File > New > Target > Notification Service Extension**
2. Add to your Podfile:

   ```ruby
   target 'YourNSETarget' do
     pod 'RNNotifeeCore', :path => '../node_modules/react-native-notify-kit'
   end
   ```

3. Use `NotifeeExtensionHelper` in your `NotificationService.m`:

   ```objc
   #import "NotifeeExtensionHelper.h"

   - (void)didReceiveNotificationRequest:(UNNotificationRequest *)request
                      withContentHandler:(void (^)(UNNotificationContent *))contentHandler {
       self.contentHandler = contentHandler;
       self.bestAttemptContent = [request.content mutableCopy];
       [NotifeeExtensionHelper populateNotificationContent:request
                                               withContent:self.bestAttemptContent
                                        withContentHandler:contentHandler];
   }
   ```

4. Run `cd ios && pod install`

## Jest Testing

Mock the native module in your Jest setup file:

```js
// jest.setup.js
jest.mock('react-native-notify-kit', () => require('react-native-notify-kit/jest-mock'));
```

Add to your Jest config:

```js
setupFiles: ['<rootDir>/jest.setup.js'],
transformIgnorePatterns: [
  'node_modules/(?!(jest-)?react-native|@react-native|react-native-notify-kit)'
],
```

## What's Different from Notifee

This fork fixes 9 upstream bugs and adds several improvements:

- **Reliable trigger notifications** — AlarmManager is the default backend instead of WorkManager, ensuring delivery even when the app is killed
- **iOS remote notification fix** — new `setNotificationConfig()` API to prevent Notifee from intercepting Firebase Messaging tap handlers ([#912](https://github.com/invertase/notifee/issues/912))
- **Android alarm fixes** — `goAsync()` in BroadcastReceivers, exact alarm fallback, Doze mode compatibility ([#1100](https://github.com/invertase/notifee/issues/1100), [#961](https://github.com/invertase/notifee/issues/961))
- **Cold start fixes** — `getInitialNotification()` works correctly on both platforms ([#1128](https://github.com/invertase/notifee/issues/1128))

See the full [CHANGELOG](https://github.com/marcocrupi/notifee/blob/main/CHANGELOG.md) and [README](https://github.com/marcocrupi/notifee#bugs-fixed-from-upstream-notifee) for details.

## Documentation

The upstream Notifee documentation remains a valid reference for the API:

- [Overview](https://docs.page/marcocrupi/react-native-notify-kit/react-native/overview)
- [API Reference](https://docs.page/marcocrupi/react-native-notify-kit/react-native/reference)
- [Android Guides](https://docs.page/marcocrupi/react-native-notify-kit/react-native/android/channels)
- [iOS Guides](https://docs.page/marcocrupi/react-native-notify-kit/react-native/ios/permissions)

## License

Apache-2.0 — see [LICENSE](/LICENSE).

Originally built by [Invertase](https://invertase.io). This fork is independently maintained by Marco Crupi.
