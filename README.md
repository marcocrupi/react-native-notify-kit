# react-native-notify-kit

A feature-rich local notification library for React Native (Android & iOS).

<!-- markdownlint-disable MD033 -->
<p align="center">
  <a href="https://www.npmjs.com/package/react-native-notify-kit"><img src="https://img.shields.io/npm/v/react-native-notify-kit.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-Android%20%7C%20iOS-green.svg" alt="Platform">
  <img src="https://img.shields.io/badge/React%20Native-%3E%3D0.73-blue.svg" alt="React Native">
</p>

<hr/>

An actively maintained fork of Notifee for React Native notifications, continued and improved by Marco Crupi.

This repository preserves the original Notifee APIs and native core while continuing development for modern React Native releases.

## Project Status

- Maintained fork of Notifee
- New Architecture only (TurboModules)
- Minimum supported React Native: `0.73`
- Development target: React Native `0.84`
- License: `Apache-2.0`

## Installation

```bash
yarn add react-native-notify-kit
```

For iOS, run `cd ios && pod install` after installing.

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

For push notifications, Firebase/APNs setup, Notification Service Extension, and more, see the [package README](packages/react-native/README.md).

## What's Different from Notifee

This fork is a complete migration to React Native's **New Architecture**:

- **TurboModules only** — no legacy Bridge support (`NativeModules` replaced with `TurboModuleRegistry`)
- **Android bridge rewritten in Kotlin** (original was Java)
- **iOS bridge uses Objective-C++** with `NativeNotifeeModuleSpecJSI` TurboModule conformance
- **Minimum React Native 0.73**, development target **0.84**
- **Toolchain**: Yarn 4, Node 22+, Java 17, compileSdk/targetSdk 35
- **Core notification logic (NotifeeCore) is unchanged** — the public API is fully compatible with the original Notifee
- **11 upstream bugs fixed** — see [Bugs Fixed from Upstream Notifee](#bugs-fixed-from-upstream-notifee) below
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
| Foreground service crashes with ANR after ~3 min on Android 14+ (`shortService` timeout, missing `onTimeout()`) | Android | [#703](https://github.com/invertase/notifee/issues/703) | Unreleased |
| Manifest merger failure when overriding `foregroundServiceType` on `ForegroundService` | Android | [#1108](https://github.com/invertase/notifee/issues/1108) | Unreleased |

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

## License

- See [LICENSE](/LICENSE). This fork remains licensed under Apache-2.0.

---

<p align="center">
  Originally built by Invertase. This fork is independently maintained by Marco Crupi.
</p>
