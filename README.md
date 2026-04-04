# Notifee for React Native

<!-- markdownlint-disable MD033 -->
<p align="center">
  <img
    width="140px"
    src="https://static.invertase.io/assets/notifee-logo.png"
    alt="Notifee logo"
  ><br/>
</p>

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
