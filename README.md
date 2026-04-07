# react-native-notify-kit

Maintained Notifee-compatible fork — a feature-rich React Native notification library (Android & iOS).

<!-- markdownlint-disable MD033 -->
<p align="center">
  <a href="https://www.npmjs.com/package/react-native-notify-kit"><img src="https://img.shields.io/npm/v/react-native-notify-kit.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-Android%20%7C%20iOS-green.svg" alt="Platform">
  <img src="https://img.shields.io/badge/React%20Native-%3E%3D0.73-blue.svg" alt="React Native">
</p>

<hr/>

A maintained fork of Notifee for React Native, providing advanced notification features for modern Android & iOS apps.

This repository preserves the original Notifee APIs and native core while continuing development for modern React Native releases.

## Why this fork

The original [Notifee](https://github.com/invertase/notifee) has not received updates since December 2024 (v9.1.8), with no bug fixes, no New Architecture support, and several critical issues left unresolved. In [issue #1254](https://github.com/invertase/notifee/issues/1254), the Invertase maintainer recommended migrating to `expo-notifications`.

However, `expo-notifications` does not cover several advanced capabilities that many production apps rely on:

- **Android foreground services** (ongoing notifications for background tasks)
- **Rich notification styles** (BigPicture, Messaging, Inbox)
- **Progress bar notifications**
- **Full-screen intent notifications** (alarm/call screens)
- **Ongoing / persistent notifications**

This fork fills the gap: it preserves all of Notifee's advanced features, migrates the bridge to React Native's **New Architecture** (TurboModules), and actively fixes the critical bugs left unresolved upstream — see the [bug fix table](#bugs-fixed-from-upstream-notifee) below.

## Project Status

<a href="https://github.com/marcocrupi/react-native-notify-kit/commits"><img src="https://img.shields.io/github/last-commit/marcocrupi/react-native-notify-kit.svg" alt="Last commit"></a>

- Maintained fork of Notifee — actively developed and published as `react-native-notify-kit`
- New Architecture only (TurboModules)
- Minimum supported React Native: `0.73`
- Development target: React Native `0.84`
- License: `Apache-2.0`
- Full changelog: [CHANGELOG.md](CHANGELOG.md)

The native core (NotifeeCore) is preserved intact and the public API is **100% compatible** with the original `@notifee/react-native` — migration is a safe, drop-in replacement.

## Installation

```bash
yarn add react-native-notify-kit
# or
npm install react-native-notify-kit
```

For iOS, run `cd ios && pod install` after installing.

## Migration from @notifee/react-native

If you're coming from the original Notifee package, migrating takes just a few steps:

1. **Swap the package:**

   ```bash
   yarn remove @notifee/react-native
   yarn add react-native-notify-kit
   ```

2. **Update imports** — find and replace across your codebase:

   ```diff
   - import notifee from '@notifee/react-native';
   + import notifee from 'react-native-notify-kit';
   ```

   The default export is still called `notifee`, so your application code stays the same — only the import path changes.

3. **Reinstall pods** (iOS):

   ```bash
   cd ios && pod install
   ```

No native code changes are required. The public API is fully compatible with `@notifee/react-native`.

## Quick Start

```ts
import notifee, { AndroidImportance } from 'react-native-notify-kit';

// 1. Request permission (required on Android 13+ and iOS)
await notifee.requestPermission();

// 2. Create a channel (Android only, required for Android 8+)
await notifee.createChannel({
  id: 'default',
  name: 'Default Channel',
  importance: AndroidImportance.HIGH,
});

// 3. Display a notification
await notifee.displayNotification({
  title: 'Hello',
  body: 'This is a local notification',
  android: { channelId: 'default' },
});
```

> **Note:** The default export name `notifee` is kept intentionally for backward compatibility. If you're migrating from `@notifee/react-native`, a simple find-and-replace of the import path is all you need.

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

- **TurboModules only** — no legacy Bridge support (`NativeModules` replaced with `TurboModuleRegistry`)
- **Android bridge rewritten in Kotlin** (original was Java)
- **iOS bridge uses Objective-C++** with `NativeNotifeeModuleSpecJSI` TurboModule conformance
- **Minimum React Native 0.73**, development target **0.84**
- **Toolchain**: Yarn 4, Node 22+, Java 17, compileSdk/targetSdk 35
- **Core notification logic (NotifeeCore) is unchanged** — the public API is fully compatible with the original Notifee
- **16 upstream bugs fixed** — see [Bugs Fixed from Upstream Notifee](#bugs-fixed-from-upstream-notifee) below
- **Reliable trigger notifications** — AlarmManager is the default backend instead of WorkManager, with automatic fallback when exact alarm permission is not granted
- **New API: `setNotificationConfig()`** — opt-out flag to prevent Notifee from intercepting iOS remote notification handlers (see [New APIs](#new-apis) below)

## Bugs Fixed from Upstream Notifee

This fork fixes the following bugs that were never resolved in the original Notifee repository:

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
| Foreground service notifications dismissible on Android 13+ even with `ongoing: true` (library doesn't auto-set `ongoing` for foreground services) | Android | [#1248](https://github.com/invertase/notifee/issues/1248) | 9.1.14 |
| DST (daylight saving time) shifts repeating scheduled notifications by ±1 hour | Android | [#875](https://github.com/invertase/notifee/issues/875) | 9.1.14 |
| `!=` reference equality on String comparison in `NotificationPendingIntent` (latent — would activate when `getLaunchActivity()` returns a non-null value for `id=default`) | Android | Pre-existing (latent) | 9.1.19 |
| `pressAction.launchActivity` not defaulted at native layer when `pressAction.id === 'default'` | Android | N/A (defense-in-depth) | 9.1.19 |

> **Note for apps requiring guaranteed exact alarms (alarm clocks, timers, calendars):**
> Add `<uses-permission android:name="android.permission.USE_EXACT_ALARM" />` to your app's
> `AndroidManifest.xml`. This permission is auto-granted and not revocable, but Google Play
> restricts its use to apps whose core function requires exact timing.
> For all other apps, the library uses `SCHEDULE_EXACT_ALARM` with automatic fallback
> to inexact alarms when the permission is not granted.

As bugs are fixed, this table is updated. See [CHANGELOG.md](CHANGELOG.md) for full details.

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

### Trigger Notification Reliability

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

## Documentation

The upstream Notifee documentation remains the best reference for the public API and platform guides used by this fork.

- [Overview](https://docs.page/marcocrupi/react-native-notify-kit/react-native/overview)
- [Reference](https://docs.page/marcocrupi/react-native-notify-kit/react-native/reference)

### Android

The APIs for Android allow for creating rich, styled and highly interactive notifications. Below you'll find guides that cover the supported Android features.

| Topic | |
| --- | --- |
| [Appearance](https://docs.page/marcocrupi/react-native-notify-kit/react-native/android/appearance) | Change the appearance of a notification; icons, colors, visibility etc. |
| [Behaviour](https://docs.page/marcocrupi/react-native-notify-kit/react-native/android/behaviour) | Customize how a notification behaves when it is delivered to a device; sound, vibration, lights etc. |
| [Channels & Groups](https://docs.page/marcocrupi/react-native-notify-kit/react-native/android/channels) | Organize your notifications into channels & groups to allow users to control how notifications are handled on their device. |
| [Foreground Service](https://docs.page/marcocrupi/react-native-notify-kit/react-native/android/foreground-service) | Long running background tasks can take advantage of an Android Foreground Service to display an on-going, prominent notification. |
| [Grouping & Sorting](https://docs.page/marcocrupi/react-native-notify-kit/react-native/android/grouping-and-sorting) | Group and sort related notifications in a single notification pane. |
| [Interaction](https://docs.page/marcocrupi/react-native-notify-kit/react-native/android/interaction) | Allow users to interact with your application directly from the notification, with actions. |
| [Progress Indicators](https://docs.page/marcocrupi/react-native-notify-kit/react-native/android/progress-indicators) | Show users a progress indicator of an on-going background task, and learn how to keep it updated. |
| [Styles](https://docs.page/marcocrupi/react-native-notify-kit/react-native/android/styles) | Style notifications to show richer content, such as expandable images/text, or message conversations. |
| [Timers](https://docs.page/marcocrupi/react-native-notify-kit/react-native/android/timers) | Display counting timers on your notification, useful for on-going tasks such as a phone call, or event time remaining. |

### iOS

Below you'll find guides that cover the supported iOS features.

| Topic | |
| --- | --- |
| [Appearance](https://docs.page/marcocrupi/react-native-notify-kit/react-native/ios/appearance) | Change how the notification is displayed to your users. |
| [Badges](https://docs.page/marcocrupi/react-native-notify-kit/react-native/ios/badges) | Manage the app icon badge count on iOS devices. |
| [Behaviour](https://docs.page/marcocrupi/react-native-notify-kit/react-native/ios/behaviour) | Control how notifications behave when they are displayed on a device; sound, critical alerts, etc. |
| [Categories](https://docs.page/marcocrupi/react-native-notify-kit/react-native/ios/categories) | Create & assign categories to notifications. |
| [Interaction](https://docs.page/marcocrupi/react-native-notify-kit/react-native/ios/interaction) | Handle user interaction with your notifications. |
| [Permissions](https://docs.page/marcocrupi/react-native-notify-kit/react-native/ios/permissions) | Request permission from your application users to display notifications. |
| [Remote Notification Support](https://docs.page/marcocrupi/react-native-notify-kit/react-native/ios/remote-notification-support) | Handle and display remote notifications with Notification Service Extension. |

## Trademark Notice

"Notifee" is a trademark of Invertase. This project is not affiliated with, endorsed by, or sponsored by Invertase. The name "Notifee" is used solely to describe the origin and compatibility of this fork, as permitted under nominative fair use.

## License

- See [LICENSE](/LICENSE). This fork remains licensed under Apache-2.0.

---

<p align="center">
  Originally built by Invertase. This fork is independently maintained by Marco Crupi.
</p>
