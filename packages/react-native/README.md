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

This fork is a complete migration to React Native's **New Architecture**:

- **TurboModules only** — no legacy Bridge support
- **Android bridge rewritten in Kotlin** (original was Java)
- **11 upstream bugs fixed** — see table below
- **Reliable trigger notifications** — AlarmManager is the default backend instead of WorkManager
- **New API: `setNotificationConfig()`** — opt-out flag for iOS remote notification handling

## Bugs Fixed from Upstream Notifee

| Bug | Platform | Upstream Issue | Fixed in |
| --- | -------- | -------------- | -------- |
| Notifee intercepts iOS remote notification tap handlers, breaking RNFB `onNotificationOpenedApp` / `getInitialNotification` | iOS | [#912](https://github.com/invertase/notifee/issues/912) | 9.1.12 |
| `completionHandler` not called on notification dismiss | iOS | Pre-existing | 9.1.12 |
| `completionHandler` not called in `willPresentNotification` fallback | iOS | Pre-existing | 9.1.12 |
| `getInitialNotification()` returns `null` on cold start (deprecated `UIApplicationLaunchOptionsLocalNotificationKey` check) | iOS | [#1128](https://github.com/invertase/notifee/issues/1128) | 9.1.12 |
| `getInitialNotification()` returns `null` without `pressAction` configured | Android | [#1128](https://github.com/invertase/notifee/issues/1128) | 9.1.12 |
| Foreground press events silently dropped when React instance not ready | Android | [#1279](https://github.com/invertase/notifee/issues/1279) | 9.1.12 |
| Trigger notifications not firing on Android 14-15 when app is killed (missing `goAsync()` in `BroadcastReceiver`) | Android | [#1100](https://github.com/invertase/notifee/issues/1100) | 9.1.12 |
| `SCHEDULE_EXACT_ALARM` denial silently drops scheduled alarms (no fallback) | Android | [#1100](https://github.com/invertase/notifee/issues/1100) | 9.1.12 |
| `getNotificationSettings()` returns `DENIED` instead of `NOT_DETERMINED` on Android 13+ before permission requested | Android | [#1237](https://github.com/invertase/notifee/issues/1237) | 9.1.12 |
| Default `AlarmType.SET_EXACT` doesn't work in Doze mode; `AlarmType.SET` uses `RTC` instead of `RTC_WAKEUP` | Android | [#961](https://github.com/invertase/notifee/issues/961) | 9.1.12 |
| Foreground service crashes with ANR after ~3 min on Android 14+ (`shortService` timeout, missing `onTimeout()`) | Android | [#703](https://github.com/invertase/notifee/issues/703) | 9.1.13 |
| Manifest merger failure when overriding `foregroundServiceType` on `ForegroundService` | Android | [#1108](https://github.com/invertase/notifee/issues/1108) | 9.1.13 |

> **Note for apps requiring guaranteed exact alarms (alarm clocks, timers, calendars):**
> Add `<uses-permission android:name="android.permission.USE_EXACT_ALARM" />` to your app's
> `AndroidManifest.xml`. This permission is auto-granted and not revocable, but Google Play
> restricts its use to apps whose core function requires exact timing.
> For all other apps, the library uses `SCHEDULE_EXACT_ALARM` with automatic fallback
> to inexact alarms when the permission is not granted.

See [CHANGELOG](https://github.com/marcocrupi/notifee/blob/main/CHANGELOG.md) for full details.

## Foreground Service Setup (Android 14+)

Android 14 (API 34) requires all foreground services to declare an explicit `foregroundServiceType`. If you use `asForegroundService: true` in your notifications, add the following to your app's `AndroidManifest.xml`:

1. **Add the required permissions:**

   ```xml
   <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
   <!-- Replace SHORT_SERVICE with the type matching your use case -->
   <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SHORT_SERVICE" />
   ```

2. **Declare the service type on Notifee's ForegroundService:**

   ```xml
   <application ...>
     <service
       android:name="app.notifee.core.ForegroundService"
       android:exported="false"
       android:foregroundServiceType="shortService" />
   </application>
   ```

Available types: `camera`, `connectedDevice`, `dataSync`, `health`, `location`, `mediaPlayback`, `mediaProjection`, `microphone`, `phoneCall`, `remoteMessaging`, `shortService`, `specialUse`, `systemExempted`. Choose the type that matches your use case — using the wrong type may cause Google Play policy violations.

> **Note:** `shortService` has a 3-minute timeout on Android 14+. If your foreground service needs to run longer, use a different type. The library's `onTimeout()` handler will gracefully stop the service if the timeout fires.

## Trigger Notification Reliability

This fork defaults to AlarmManager for trigger notifications on Android, instead of WorkManager.
This ensures scheduled notifications are delivered reliably even when the app is killed.

The original Notifee used WorkManager by default, which is battery-friendly but unreliable
for time-sensitive notifications — Android may defer or drop WorkManager tasks based on
battery optimization, Doze mode, and OEM power management.

If you need battery-friendly scheduling where exact timing is not critical (e.g., daily digest
notifications), you can opt out:

```typescript
await notifee.createTriggerNotification(notification, {
  type: TriggerType.TIMESTAMP,
  timestamp: Date.now() + 60000,
  alarmManager: false, // Uses WorkManager instead
});
```

## New APIs

### `setNotificationConfig` (iOS)

Controls whether Notifee intercepts remote (push) notification tap events on iOS.
When using React Native Firebase Messaging alongside Notifee, call this at app startup
to let Firebase handle remote notification taps:

```typescript
import notifee from 'react-native-notify-kit';

await notifee.setNotificationConfig({
  ios: { handleRemoteNotifications: false },
});
```

With `handleRemoteNotifications: false`:

- Remote notifications (FCM) → handled by Firebase Messaging (`onNotificationOpenedApp`, `getInitialNotification`)
- Local Notifee notifications → still handled by Notifee (unchanged)

Default is `true` (backward compatible — Notifee handles everything, same as original Notifee behavior).

### Android: `pressAction` required for tap handling

On Android, notifications require a `pressAction` to open the app when tapped:

```typescript
await notifee.displayNotification({
  title: 'Hello',
  body: 'Tap to open',
  android: {
    channelId: 'default',
    pressAction: { id: 'default', launchActivity: 'default' },
  },
});
```

Without `pressAction`, the notification will display but tapping it will do nothing.
This is Android platform behavior, not a bug. iOS opens the app by default on tap.

## Documentation

The upstream Notifee documentation remains a valid reference for the API:

- [Overview](https://docs.page/marcocrupi/react-native-notify-kit/react-native/overview)
- [API Reference](https://docs.page/marcocrupi/react-native-notify-kit/react-native/reference)
- [Android Guides](https://docs.page/marcocrupi/react-native-notify-kit/react-native/android/channels)
- [iOS Guides](https://docs.page/marcocrupi/react-native-notify-kit/react-native/ios/permissions)

## License

Apache-2.0 — see [LICENSE](/LICENSE).

Originally built by [Invertase](https://invertase.io). This fork is independently maintained by Marco Crupi.
