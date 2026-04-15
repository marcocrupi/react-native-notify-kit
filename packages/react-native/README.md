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

An actively maintained fork of Notifee for React Native notifications, continued and improved by Marco Crupi.

This repository preserves the original Notifee APIs and native core while continuing development for modern React Native releases.

## Why this fork

The original [Notifee](https://github.com/invertase/notifee) repository was **officially archived** by Invertase on April 7, 2026 (last release: v9.1.8, December 2024). The archived README recommends this fork (`react-native-notify-kit`) as a community-maintained drop-in replacement, alongside `expo-notifications`. Previously, in [issue #1254](https://github.com/invertase/notifee/issues/1254), the Invertase maintainer had already suggested migrating to `expo-notifications`.

However, `expo-notifications` does not cover several advanced capabilities that many production apps rely on:

- **Android foreground services** (ongoing notifications for background tasks)
- **Rich notification styles** (BigPicture, Messaging, Inbox)
- **Progress bar notifications**
- **Full-screen intent notifications** (alarm/call screens)
- **Ongoing / persistent notifications**

This fork fills the gap: it preserves all of Notifee's advanced features, migrates the bridge to React Native's **New Architecture** (TurboModules), and actively fixes the critical bugs left unresolved upstream — see the [bug fix table](#bugs-fixed-from-upstream-notifee) below.

## Project Status

<a href="https://github.com/marcocrupi/react-native-notify-kit/commits"><img src="https://img.shields.io/github/last-commit/marcocrupi/react-native-notify-kit.svg" alt="Last commit"></a>

- Officially recommended by Invertase as the community-maintained fork (April 2026)
- Maintained fork of Notifee — actively developed and published as `react-native-notify-kit`
- New Architecture only (TurboModules)
- Minimum supported React Native: `0.73`
- Development target: React Native `0.84`
- License: `Apache-2.0`
- Full changelog: [CHANGELOG.md](CHANGELOG.md)

The native core (NotifeeCore) is compiled from source as part of the bridge module (since 9.2.0) and the public API is **100% compatible** with the original `@notifee/react-native` — migration is a safe, drop-in replacement.

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

4. Implement `serviceExtensionTimeWillExpire` as a safety net. Notification Service Extensions have a ~30-second time budget; if your notification includes a large image attachment and the download is slow, the extension may be terminated before the content handler is called. Deliver a best-effort notification in the expiration handler:

   ```objc
   - (void)serviceExtensionTimeWillExpire {
       // Deliver the notification with whatever content we have so far
       // (e.g., without the image attachment if the download didn't finish).
       self.contentHandler(self.bestAttemptContent);
   }
   ```

5. Run `cd ios && pod install`

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
- **Single Android module** — the original Notifee shipped a pre-compiled AAR bundled inside the npm tarball under a frozen Maven coordinate; this fork compiles the core from source as part of the React Native bridge module on every consumer build. Eliminates the `FAIL_ON_PROJECT_REPOS` issue on RN 0.74+ and the Gradle cache staleness bug that could serve outdated bytecode after `yarn upgrade`.
- **Core notification logic (NotifeeCore) is unchanged** — the public API is fully compatible with the original Notifee
- **30 upstream bugs fixed** — see [Bugs Fixed from Upstream Notifee](#bugs-fixed-from-upstream-notifee) below
- **Reliable trigger notifications** — AlarmManager is the default backend instead of WorkManager, with automatic fallback when exact alarm permission is not granted
- **New API: `setNotificationConfig()`** — opt-out flag to prevent Notifee from intercepting iOS remote notification handlers (see [New APIs](#new-apis) below)
- **Baseline Profile** — the library AAR ships a Baseline Profile that instructs ART to AOT-compile the foreground service notification hot path at install time, eliminating JIT penalty on first invocation

## Bugs Fixed from Upstream Notifee

This fork fixes the following bugs that were never resolved in the original Notifee repository:

| Bug | Platform | Upstream Issue | Fixed in |
| --- | -------- | -------------- | -------- |
| Notifee intercepts iOS remote notification tap handlers, breaking RNFB `onNotificationOpenedApp` / `getInitialNotification` | iOS | [#912](https://github.com/invertase/notifee/issues/912) | 9.1.12 |
| `completionHandler` not called on notification dismiss | iOS | Pre-existing | 9.1.12 |
| `completionHandler` not called in `willPresentNotification` fallback | iOS | Pre-existing | 9.1.12 |
| `getInitialNotification()` returns `null` on cold start (deprecated `UIApplicationLaunchOptionsLocalNotificationKey` check) | iOS | [#1128](https://github.com/invertase/notifee/issues/1128) | 9.1.12 |
| `willPresentNotification:` fallback silently drops foreground notifications when no original delegate is captured (returns `None` instead of platform defaults) | iOS | Pre-existing (introduced by partial fix in v9.1.12) | 9.1.20 |
| All delivered notifications dismissed from Notification Center when the app is opened | iOS | [#828](https://github.com/invertase/notifee/issues/828) | 9.1.20 |
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
| Duplicate symbols linker error when using NSE (`$NotifeeExtension = true`) with static frameworks — `NotifeeExtensionHelper` compiled by both `RNNotifee` and `RNNotifeeCore` pods | iOS | Pre-existing | 9.1.22 |
| `FAIL_ON_PROJECT_REPOS` rejection on RN 0.74+ — library injected a Maven repository into the consumer's `rootProject.allprojects` block, rejected by `dependencyResolutionManagement` mode | Android | N/A (architectural) | 9.2.0 |
| Stale Gradle cache could serve outdated AAR bytecode after `yarn upgrade` — same Maven coordinate reused across releases violated Gradle's coordinate-immutability assumption | Android | N/A (architectural) | 9.2.0 |
| `EventType.DELIVERED` not emitted for `displayNotification()` in foreground (only for trigger notifications) — `notifeeTrigger != nil` guard in `willPresentNotification:` suppressed the event, breaking iOS/Android symmetry | iOS | Pre-existing | 9.3.0 |
| Tapping a notification without explicit `pressAction` does nothing (app doesn't open) — `NotificationPendingIntent.createIntent()` creates a tap-less PendingIntent when `pressActionModelBundle` is null, especially visible on trigger notifications after app kill | Android | Pre-existing (latent) | 9.3.0 |
| Foreground service notifications delayed up to 10 seconds on Android 12+ — library never calls `setForegroundServiceBehavior(FOREGROUND_SERVICE_IMMEDIATE)` | Android | [#272](https://github.com/invertase/notifee/issues/272), [#1242](https://github.com/invertase/notifee/issues/1242) | 9.4.0 |
| `didReceiveNotificationResponse:` completionHandler delayed by 15 seconds via `dispatch_after`, blocking subsequent notification taps and risking handler leaks if the app is suspended during the wait | iOS | Pre-existing (TODO since 2020) | 9.4.0 |
| `requestPermission:` silently swallows `NSError` from `requestAuthorizationWithOptions`, making MDM and parental-control authorization failures invisible to JS consumers | iOS | Pre-existing (TODO since day 1) | 9.4.0 |
| `contentByUpdatingWithProvider:` errors suppressed via `nil` error pointer in `displayNotification:` and `createTriggerNotification:` — communication notifications with malformed SiriKit intents silently fail with nil content | iOS | Pre-existing | 9.4.0 |
| `getBadgeCount:` completion block never called when running in an app extension, causing JS promises to hang forever in NSE handlers | iOS | Pre-existing | 9.4.0 |
| Notification Service Extension attachment downloads had no timeout cap (default 60-second `NSURLSession` timeout exceeds iOS's ~30-second NSE budget), causing extension process kill and notification loss on slow networks | iOS | Pre-existing | 9.4.0 |
| `cancelTriggerNotifications()` / `createTriggerNotification()` promises resolve before Room DB write completes, causing ~3% race on cancel-then-create patterns. Also fixes a previously-undocumented reboot-recovery data-loss bug in `NotifeeAlarmManager.rescheduleNotification` and an ordering bug in `NotificationManager.doScheduledWork` | Android | [#549](https://github.com/invertase/notifee/issues/549) | 9.5.0 |
| Scheduled trigger notifications silently lost across device reboot on OEM devices (Xiaomi MIUI, OnePlus, Huawei EMUI, Oppo ColorOS, Vivo FuntouchOS) whose vendor OS suppresses `BOOT_COMPLETED` until the user manually enables autostart. Also handles zombie non-repeating triggers whose fire time already passed (fire-once within a 24-hour grace period, then delete the Room row; delete silently beyond the grace period) and adds try/catch/finally guards to all notifee `BroadcastReceiver` async paths. | Android | [#734](https://github.com/invertase/notifee/issues/734) | Unreleased |

> **Note for apps requiring guaranteed exact alarms (alarm clocks, timers, calendars):**
> Add `<uses-permission android:name="android.permission.USE_EXACT_ALARM" />` to your app's
> `AndroidManifest.xml`. This permission is auto-granted and not revocable, but Google Play
> restricts its use to apps whose core function requires exact timing.
> For all other apps, the library uses `SCHEDULE_EXACT_ALARM` with automatic fallback
> to inexact alarms when the permission is not granted.

As bugs are fixed, this table is updated. See [CHANGELOG.md](CHANGELOG.md) for full details.

## Documented Workarounds for Platform Limitations

Some upstream Notifee issues are not bugs in the library itself but platform-level limitations imposed by Android's Doze mode and vendor power management — no library code can make `AlarmManager` deliver an alarm to, or a foreground service survive inside, an app the OEM has explicitly paused. For these, the fork provides **documented mitigations**: user-facing helper APIs, code-level self-healing where possible, and decision guides that steer consumers toward the Android primitive most resilient to the specific vendor policy.

| Upstream issue | Symptom | Platform root cause | Fork mitigation |
| --- | --- | --- | --- |
| [invertase/notifee#410](https://github.com/invertase/notifee/issues/410) | Foreground service paused on screen lock (Samsung OneUI, ~6 seconds after screen off on battery) and killed immediately when the app is backgrounded (Xiaomi MIUI) | Vendor aggressive battery-saver and autostart policies suspend or terminate foreground services of apps not whitelisted in the OEM's protected-apps / autostart settings. Partially Doze-related on non-exempt `foregroundServiceType` values; mostly OEM-specific behavior catalogued at [dontkillmyapp.com](https://dontkillmyapp.com/). | **(1) Decision guide** — the [Timers: foreground service or `SET_ALARM_CLOCK`?](#timers-foreground-service-or-set_alarm_clock) section recommends the `SET_ALARM_CLOCK` trigger over a silent foreground service for rest, cooking, and recovery timer use cases. `setAlarmClock` is the same primitive the stock Clock app uses and is generally respected by vendor aggressive-kill policies. **(2) Foreground service use case matrix** — the [Foreground service use case guide](#foreground-service-use-case-guide) documents which `foregroundServiceType` values are Doze-CPU-exempt, which have type-specific timeouts, and the Google Play policy constraints that rule out misusing `mediaPlayback` for silent timers. **(3) `openPowerManagerSettings()` helper API** — deep-links the user to the correct vendor autostart / protected-apps screen on 16 manufacturers; whitelisting the app prevents both `BOOT_COMPLETED` suppression and background FGS kills. |
| [invertase/notifee#734](https://github.com/invertase/notifee/issues/734) | Scheduled trigger notifications silently lost across a device reboot on OEM devices (Xiaomi MIUI, OnePlus, Huawei EMUI, Oppo ColorOS, Vivo FuntouchOS) | The vendor OS suppresses the `BOOT_COMPLETED` broadcast to apps the user has not manually whitelisted, so the library's `RebootBroadcastReceiver` never runs and persisted `AlarmManager` triggers are never re-armed after reboot. | **(1) `BOOT_COUNT` cold-start self-heal (code)** — on every app init, `InitProvider` compares `Settings.Global.BOOT_COUNT` against the last-known value in `SharedPreferences` and re-arms every persisted trigger on a background thread if a boot delta is detected, even when `BOOT_COMPLETED` was never delivered. Paired with a process-wide `AtomicBoolean` race guard in `NotifeeAlarmManager.rescheduleNotifications` that prevents double-advancement when the reboot receiver and the cold-start path race. **(2) `openPowerManagerSettings()` helper API** — the same vendor-settings deep-link used by #410, pointing the user at the autostart whitelist for defense in depth. |
| [invertase/notifee#927](https://github.com/invertase/notifee/issues/927) | Custom sound passed via `displayNotification({ android: { sound, channelId }, ios: { sound } })` is ignored for **remote push notifications** (FCM/APNs) delivered while the app is in background or killed — the system default sound plays instead. Foreground delivery and **locally-scheduled notifications** (`displayNotification`, `createTriggerNotification`) are unaffected. | When a remote push arrives while the app is killed, the JavaScript layer never runs — the system tray item is drawn by the OS (Android system + Firebase SDK; iOS + APNs) before any Notifee code executes. On Android API 26+, the `NotificationChannel` sound is set once at channel creation and is immutable thereafter — `NotificationCompat.Builder.setSound()` is silently ignored when the builder has a `channelId`. On iOS, the Notification Service Extension only rewrites incoming push content when the payload contains a `notifee_options` key (see `NotifeeCoreExtensionHelper.m:43`); a plain APNs payload is delivered unmodified. | **Documentation only — the platform contract cannot be worked around at the library layer.** Recipes by platform: **(Android)** create the `NotificationChannel` with the desired sound at first-run (the channel sound is immutable; to change it the channel must be deleted and recreated under a new `channelId`), and configure `AndroidNotification.sound` in the FCM payload server-side so the system tray honors it for background pushes. As a heavier alternative, switch the backend to an FCM data-only payload and call `displayNotification()` from a headless task — the JS-side `android.sound` is then honored, but this trades simplicity for the cost of running JS on every push. **(iOS)** either set `aps.sound` directly in the APNs payload, or install the Notification Service Extension (see `docs/react-native/ios/remote-notification-support.mdx`) and ship the sound under `notifee_options.ios.sound` in the push payload. |

Both mitigations are intentionally additive to the existing reboot-recovery and foreground-service code paths and do not replace the consumer's responsibility to prompt the user for battery-optimization exemption when the use case warrants it. For a complete vendor-by-vendor reference of autostart, battery-saver, and background-restriction behavior, see [dontkillmyapp.com](https://dontkillmyapp.com/).

## Behavior changes from upstream

In addition to bug fixes, the fork makes a few opinionated default changes vs `@notifee/react-native` to improve reliability and reduce footguns. These are intentional behavioral differences that you should be aware of when migrating:

- **Trigger notifications use AlarmManager by default** instead of WorkManager (since 9.1.12). WorkManager is battery-friendly but unreliable for time-sensitive notifications — Android may defer or drop WorkManager tasks based on Doze mode and OEM power management. Opt out per-trigger with `alarmManager: false` in the trigger config if you need battery-friendly scheduling where exact timing is not critical.

- **`AlarmType` defaults to `SET_EXACT_AND_ALLOW_WHILE_IDLE`** (since 9.1.12) instead of upstream's `SET_EXACT`, for better Doze mode compatibility.

- **`ongoing` defaults to `true` when `asForegroundService: true`** (since 9.1.14), preventing foreground service notifications from being dismissed by the user on Android 13+. This matches pre-Android 13 platform behavior. Override by setting `ongoing: false` explicitly.

- **Foreground service notifications dismissed on Android 14+ are auto re-posted** (since 9.1.14) while the service is still running. Android 14 ignores `FLAG_ONGOING_EVENT` for most foreground service types (except `mediaPlayback`, `phoneCall`, and enterprise DPC); the library detects the dismissal and immediately re-displays the notification.

- **`pressAction.launchActivity` defaults to `'default'` at the native layer when `pressAction.id === 'default'`** (since 9.1.19). The TypeScript validator already applied this default since upstream PR #141 (Sept 2020), but native code paths bypassing the validator (e.g., trigger notifications restored from the Room database after reboot, headless tasks) could miss it. The fork closes the gap at the native layer as defense-in-depth — eliminates an entire class of "tap doesn't open app" bugs in Android task management edge cases.

- **`pressAction` defaults to `{ id: 'default', launchActivity: 'default' }` when omitted from the notification payload** (since 9.3.0). Upstream Notifee required an explicit `pressAction` for tap-to-open behavior — without it, the notification displayed but tapping did nothing (only the internal transparent `NotificationReceiverActivity` would launch and finish). The fork injects the default at both the TypeScript validator layer and the native `NotificationManager` layer (defense-in-depth for code paths bypassing the validator, such as trigger notifications rehydrated from Room DB after app kill). Opt out with `pressAction: null` for intentionally non-tappable notifications.

- **Library no longer hardcodes `foregroundServiceType` in its manifest** (since 9.1.13 — **BREAKING vs upstream**). Apps using `asForegroundService: true` on Android 14+ must declare their own `foregroundServiceType` on `app.notifee.core.ForegroundService` in their app manifest. See [Foreground Service Setup](#foreground-service-setup-android-14) below for migration instructions. Upstream hardcoded `shortService`, which caused a manifest merger failure ([#1108](https://github.com/invertase/notifee/issues/1108)) and a 3-minute timeout ANR crash ([#703](https://github.com/invertase/notifee/issues/703)).

- **Foreground service notifications use `FOREGROUND_SERVICE_IMMEDIATE` by default** (since 9.4.0 — **BREAKING vs upstream**). Upstream Notifee never called `setForegroundServiceBehavior()`, causing Android 12+ to defer foreground service notification display by up to 10 seconds unless the notification qualified for a system exemption. The fork now sets `FOREGROUND_SERVICE_IMMEDIATE` by default when `asForegroundService: true`, eliminating the delay. Opt out per-notification with `foregroundServiceBehavior: AndroidForegroundServiceBehavior.DEFERRED`. Additionally, the library now pre-loads critical foreground service classes and Binder proxies on a background thread during app startup (`InitProvider.onCreate`), reducing first-display cold-start latency by ~50–100 ms. Opt out of the warmup via `<meta-data android:name="notifee_init_warmup_enabled" android:value="false" />` in your app's `AndroidManifest.xml`.

- **iOS `EventType.DELIVERED` now emitted for all foreground notifications** (since 9.3.0 — **BREAKING vs upstream**). Upstream Notifee had a guard in `willPresentNotification:` that suppressed DELIVERED for notifications created via `displayNotification()` (immediate display), emitting it only for trigger notifications. Android always emitted DELIVERED in both cases. The fork removes the guard so iOS matches Android. If you registered `onForegroundEvent` listeners that did heavy work on DELIVERED assuming the event would only fire for trigger notifications, audit them — you may now receive an event per `displayNotification()` call while in foreground. **Known limitation**: trigger notifications that fire while the app is in background or killed still do not emit DELIVERED on iOS — this is a platform limitation (`willPresentNotification:` is only invoked in foreground, and iOS provides no delegate callback for background-delivered triggers). If you need delivery confirmation for background trigger notifications on iOS, check the notification's presence via `getDisplayedNotifications()` after the app returns to foreground.

These changes are documented in the [CHANGELOG](CHANGELOG.md) under the release that introduced them. If you rely on any of the upstream defaults, you can either pin to the specific behavior via the opt-out flags listed above, or open an issue to discuss.

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

### Foreground service use case guide

Choosing the right `foregroundServiceType` matters — the wrong choice can cause Doze-driven CPU suspension with the screen off, Google Play policy rejection, or premature kills by the Android 14+ type-specific timeouts. This matrix maps common use cases to the recommended type and calls out the caveats you need to know before shipping:

| Use case | Recommended type | Doze CPU exempt? | Type timeout | Key caveat |
| --- | --- | --- | --- | --- |
| Silent rest / workout / cooking timer | **`SET_ALARM_CLOCK` trigger — not an FGS** | N/A | N/A | See the ["Timers: foreground service or `SET_ALARM_CLOCK`?"](#timers-foreground-service-or-set_alarm_clock) decision guide below. |
| Timer with audio cue (metronome, guided set) | `mediaPlayback` | Yes | None | Must actually play audio — silent `mediaPlayback` is a Play Store policy violation. |
| Short operation (< 3 min) | `shortService` | No | **3 min** | Library's `onTimeout()` stops cleanly and emits `TYPE_FG_TIMEOUT` to JS. |
| Long-running data sync | `dataSync` | No | 6 h (API 34); stricter on API 35+ | Pair with `openBatteryOptimizationSettings()` for reliability on OEM devices. |
| Location / navigation / fitness GPS | `location` | Yes | None | Requires `ACCESS_FINE_LOCATION` runtime permission. |
| Music / podcast / audiobook playback | `mediaPlayback` | Yes | None | Must be real playback — see policy callout below. |
| Bluetooth / USB device sync | `connectedDevice` | No | None | Requires companion-device or Bluetooth permission. |
| Enterprise / DPC / system-critical | `specialUse` or `systemExempted` | Varies | None | `specialUse` requires a `<property>` element and Play Store justification review. |
| Arbitrary deferrable background work | **None — use `WorkManager` directly, not an FGS.** | N/A | N/A | FGS is not the right abstraction for deferrable work. |

> **Warning:** **`mediaPlayback` requires active audio playback.** [Google Play's Foreground Service Types policy](https://support.google.com/googleplay/android-developer/answer/13392821) explicitly prohibits declaring `mediaPlayback` for services that do not play audio. A silent timer, stopwatch, or rest-timer declared as `mediaPlayback` will be rejected during Play Store review. For silent long-running timers, prefer the `SET_ALARM_CLOCK` trigger path (see the decision guide below).

### Android 15+ additional FGS restrictions

Android 15 (API 35) tightens foreground service restrictions further:

- **`dataSync` cumulative 6-hour limit per 24-hour window.** Apps that previously started a fresh `dataSync` FGS repeatedly will hit the new cap.
- **`mediaProcessing` is a new dedicated type** for short media transcode / processing operations, with its own timeout.
- **`specialUse` requires a `<property>` element** on the `<service>` tag with `android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"` and a user-visible justification string. Play Store review uses this property to evaluate the declaration.
- **Type-specific timeouts fire `onTimeout(int startId, int fgsType)`.** This fork already implements the API 35+ overload — at timeout the service stops cleanly and the library emits `TYPE_FG_TIMEOUT` to JS with both `startId` and `fgsType` in the event payload.

If you target API 35+, audit your `foregroundServiceType` choice against the matrix above before shipping. The canonical reference is the [Android 15 foreground service behavior changes](https://developer.android.com/about/versions/15/behavior-changes-15#fgs-changes) documentation.

### OEM Background Restrictions

Some Android vendors (Xiaomi/Redmi MIUI, Huawei/Honor EMUI, Oppo/Realme ColorOS, Vivo/iQOO FuntouchOS and OriginOS, Samsung OneUI) apply aggressive autostart and battery-saver restrictions that affect **both scheduled trigger notifications and running foreground services**:

- **Trigger notifications** — the vendor OS suppresses the `BOOT_COMPLETED` broadcast to apps the user has not explicitly whitelisted, so `AlarmManager`-backed triggers never re-arm after a device reboot until the user opens the app.
- **Foreground services** — the same vendor policy pauses or terminates a running foreground service as soon as the app is backgrounded. Symptoms reported in [invertase/notifee#410](https://github.com/invertase/notifee/issues/410) include the service pausing after ~6 seconds with the screen off on Samsung OneUI on battery, and immediate kill on Xiaomi MIUI when the app moves to the background.

This is platform-level behavior imposed by the vendor — no library can make `AlarmManager` deliver an alarm to, or a foreground service survive inside, an app the OEM has explicitly paused.

The fork mitigates this with two layers that work together:

**1. Automatic cold-start recovery.** On every app init, the library compares `Settings.Global.BOOT_COUNT` against the value recorded on the previous run. If a reboot has occurred since the last run — whether or not `BOOT_COMPLETED` was delivered to your app — the library re-arms every persisted trigger on a background thread. This means that on an OEM device where `BOOT_COMPLETED` was suppressed, simply opening your app (or having it cold-started by any other entry point: push notification, geofence, share intent) recovers all missed and upcoming alarms. Previously, opening the app alone did not recover them. This recovery runs unconditionally — it is not gated by the `notifee_init_warmup_enabled` metadata flag, because it is a correctness fix rather than a startup optimization.

**2. Vendor settings helper APIs.** The existing `getPowerManagerInfo()` and `openPowerManagerSettings()` APIs let your app guide the user directly to the correct vendor settings screen (Xiaomi Autostart, Huawei Protected Apps, Oppo Startup Manager, and 13 more vendors) to whitelist the app. Once whitelisted, `BOOT_COMPLETED` is delivered normally on every reboot and exact alarm timing is preserved without waiting for the next app cold-start. The same whitelist also prevents the OS from killing your foreground service when the app is backgrounded — so this helper is the primary mitigation path for **both** trigger-notification reliability and foreground-service reliability on OEM devices.

A typical integration that combines both layers looks like this:

```typescript
import notifee from 'react-native-notify-kit';
import { Alert, Platform } from 'react-native';

if (Platform.OS === 'android') {
  const info = await notifee.getPowerManagerInfo();
  if (info.activity) {
    // The user is on a device with a known vendor autostart activity.
    // Prompt them once (e.g. on first run, or after a scheduled notification
    // fails to fire on time), explaining why exact timing depends on this
    // permission.
    Alert.alert(
      'Allow background activity',
      'Your device restricts background apps by default. To reliably receive scheduled notifications, please enable autostart for this app.',
      [
        { text: 'Open settings', onPress: () => notifee.openPowerManagerSettings() },
        { text: 'Later', style: 'cancel' },
      ],
    );
  }
}
```

For the authoritative vendor-by-vendor matrix of autostart, battery optimization, and background-restriction behavior, see [dontkillmyapp.com](https://dontkillmyapp.com/).

> **Scope note:** the cold-start recovery path is best-effort. It runs as soon as Android invokes `InitProvider.onCreate` (before `Application.onCreate`), but may still be delayed by minutes or hours on a device where the user never opens your app after a reboot. For use cases that require guaranteed sub-second timing (alarm clocks, medication reminders, calendar events), also declare `USE_EXACT_ALARM` in your manifest (see the [note above](#bugs-fixed-from-upstream-notifee)) and prompt the user to whitelist your app via the vendor settings helper.
>
> **Defense in depth:** the cold-start BOOT_COUNT path and the traditional `RebootBroadcastReceiver` path both funnel into the same `NotifeeAlarmManager.rescheduleNotifications` entry point, which is guarded by a process-wide `AtomicBoolean` — whichever path runs first wins the reschedule cycle, and the second logs `Reschedule already in progress, skipping duplicate request` and exits cleanly. On real devices the two paths often *both* fire, for a subtle reason observed during Step 6 smoke testing: when the system force-stops your app (during an install, crash recovery, or a `pm clear` from a QA tool) and then Android re-delivers `BOOT_COMPLETED` as soon as the package is launched again, the reboot receiver runs at the same time as `InitProvider.onCreate`'s cold-start check. You get both paths for free — proof of the race guard's design. On an OEM device that suppresses `BOOT_COMPLETED` outright, only the cold-start path runs. Either way the zombie re-fire loop is broken.

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

#### AlarmType guide

When `alarmManager` is enabled (the default), the `alarmManager.type` field selects which
`android.app.AlarmManager` primitive is used to schedule the trigger. This fork supports all
five `AlarmType` values — including `SET_ALARM_CLOCK`, which upstream Notifee tracked in
[invertase/notifee#655](https://github.com/invertase/notifee/issues/655) and merged via
[#749](https://github.com/invertase/notifee/pull/749).

| AlarmType                          | Exact? | Wakes device? | Doze bypass? | Status bar icon | When to use                                                                    |
| ---------------------------------- | ------ | ------------- | ------------ | --------------- | ------------------------------------------------------------------------------ |
| `SET`                              | No     | Yes           | No           | No              | Non-critical reminders that can slip by several minutes (daily digest).        |
| `SET_AND_ALLOW_WHILE_IDLE`         | No     | Yes           | Yes          | No              | Non-critical reminders that must still fire while the device is in Doze.       |
| `SET_EXACT`                        | Yes    | Yes           | No           | No              | Time-sensitive reminders when the app is reasonably sure not to be in Doze.    |
| `SET_EXACT_AND_ALLOW_WHILE_IDLE`   | Yes    | Yes           | Yes          | No              | **Fork default.** Time-sensitive reminders that must fire even in Doze.        |
| `SET_ALARM_CLOCK`                  | Yes    | Yes           | Yes          | **Yes**         | True alarm-clock / recovery-timer use cases — highest priority, OEM-resilient. |

`SET_ALARM_CLOCK` is the strongest Android guarantee available for a scheduled notification:

- **Status-bar alarm-clock icon.** The system renders the alarm-clock glyph in the status bar
  until the trigger fires, signalling to the user that an alarm is pending.
- **Least susceptible to OEM power management.** Vendor aggressive-kill policies (Xiaomi MIUI,
  Oppo ColorOS, Huawei EMUI, Vivo FuntouchOS — documented in the "OEM Background Restrictions"
  section and on [dontkillmyapp.com](https://dontkillmyapp.com/)) generally respect
  `setAlarmClock` even when they would otherwise drop `setExactAndAllowWhileIdle`. This is the
  same mechanism the stock Clock app uses.
- **Intended for the same reliability problem as [invertase/notifee#734](https://github.com/invertase/notifee/issues/734).**
  If your use case is a medication reminder, a rest-timer between gym sets, a cooking timer,
  or any recovery-timer scenario where a missed notification is user-visible damage, prefer
  `SET_ALARM_CLOCK` over the fork default.

```typescript
import notifee, { AlarmType, TriggerType } from 'react-native-notify-kit';

await notifee.createTriggerNotification(
  {
    title: 'Rest complete',
    body: 'Next set is ready.',
    android: { channelId: 'timers' },
  },
  {
    type: TriggerType.TIMESTAMP,
    timestamp: Date.now() + 90_000,
    alarmManager: {
      type: AlarmType.SET_ALARM_CLOCK,
    },
  },
);
```

**Required permissions on Android 12+.** `SET_EXACT`, `SET_EXACT_AND_ALLOW_WHILE_IDLE`, and
`SET_ALARM_CLOCK` all require the `SCHEDULE_EXACT_ALARM` or `USE_EXACT_ALARM` permission.
If the permission is not granted, Notifee falls back to `setAndAllowWhileIdle` (inexact)
instead of crashing — see the `SecurityException` handling in `NotifeeAlarmManager`.
For use cases that must be exact on first install, declare `USE_EXACT_ALARM` in your manifest
and consider prompting the user with `openAlarmPermissionSettings()`.

### Timers: foreground service or `SET_ALARM_CLOCK`?

A common question for this fork: **should a rest / cooking / recovery timer be a foreground service, or a scheduled trigger notification?** For most timer use cases the answer is the trigger path — and specifically `SET_ALARM_CLOCK`.

| Timer characteristic | Recommended approach |
| --- | --- |
| Fires once at a known time, no live UI update while app is backgrounded | **`SET_ALARM_CLOCK` trigger** (see [AlarmType guide](#alarmtype-guide)) |
| Fires repeatedly at known intervals | **`SET_ALARM_CLOCK` trigger** with app-side scheduling of the next cycle |
| Needs a live ticking notification UI while app is backgrounded | Foreground service (`mediaPlayback` if audio, otherwise reconsider the UX) |
| Streams audio, music, or guided voice | Foreground service with `mediaPlayback` |
| Continuous background work (location, Bluetooth) | Foreground service with the matching type from the matrix above |

**Why `SET_ALARM_CLOCK` is usually the right choice for timers:**

- **OEM-resilient.** Vendor aggressive-kill policies (Xiaomi MIUI, Oppo ColorOS, Huawei EMUI, Vivo FuntouchOS, Samsung OneUI) generally respect `setAlarmClock` even when they drop `setExactAndAllowWhileIdle` and kill foreground services. This is the same primitive the stock Clock app uses.
- **No `foregroundServiceType` to pick.** You avoid the Doze / Play-policy / Android 15 timeout maze entirely.
- **No risk of Play Store rejection** for misusing `mediaPlayback` on a silent timer.
- **No wake lock to manage.** The library's foreground-service path does not acquire a wake lock on your behalf — under Doze on a non-exempt `foregroundServiceType`, the CPU can still suspend with the screen off. `SET_ALARM_CLOCK` wakes the device at fire time regardless of Doze state.

**When a foreground service *is* the right choice:**

- You need the notification to tick every second while the app is backgrounded (metronome with audio, VoIP call, active GPS track). A `SET_ALARM_CLOCK` trigger fires once at the scheduled time, not continuously.
- You need actual audio playback — use `mediaPlayback`.
- You need continuous location updates — use `location`.

For the specific use case in [invertase/notifee#410](https://github.com/invertase/notifee/issues/410) (rest timer between workout sets, screen off, OEM device), `SET_ALARM_CLOCK` is the recommended path. Pair it with `openPowerManagerSettings()` for defense in depth on OEM devices — see the [OEM Background Restrictions](#oem-background-restrictions) section above.

### Android: `pressAction` defaults to opening the app on tap

On Android, `pressAction` now defaults to `{ id: 'default', launchActivity: 'default' }` when omitted from the notification payload. This means tapping a notification opens the app's main activity by default — matching iOS behavior and eliminating a common footgun where trigger notifications appeared to work but tapping them did nothing after an app kill.

You can still provide an explicit `pressAction` to customize tap behavior:

```typescript
await notifee.displayNotification({
  title: 'Hello',
  body: 'Tap to open',
  android: {
    channelId: 'default',
    pressAction: { id: 'default', launchActivity: 'default' }, // same as the default
  },
});
```

To create a non-tappable notification (e.g. purely informative notifications from a background service), pass `pressAction: null` explicitly:

```typescript
await notifee.displayNotification({
  title: 'Sync in progress',
  body: 'Uploading files...',
  android: {
    channelId: 'default',
    pressAction: null, // notification displays but tapping does nothing
  },
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

## Advanced

### Troubleshooting

#### Custom sounds for push notifications in background or killed state

If you've set `android.sound` and `ios.sound` in `displayNotification(...)` and the custom sound plays only when the app is in foreground, this is expected platform behavior — not a library bug. When a **remote push** (FCM/APNs) arrives while the app is killed, your JavaScript code never runs, so anything you configured client-side is ignored.

The fix is to set the sound in the push payload **server-side**:

- **Android (FCM)**: set `AndroidNotification.sound` in the FCM payload to the name of a sound file bundled in `android/app/src/main/res/raw/`. Make sure the `NotificationChannel` was created with the same sound — the channel sound is immutable after creation, so changing the sound requires creating a channel under a new `channelId`.
- **iOS (APNs)**: either set `aps.sound` directly to the name of a sound file bundled in your app, or — if you need richer rewriting (image attachments, dynamic content) — install the Notification Service Extension and ship the sound under `notifee_options.ios.sound` in the push payload. See [`docs/react-native/ios/remote-notification-support.mdx`](docs/react-native/ios/remote-notification-support.mdx).

An advanced alternative on Android is to switch the backend to an FCM **data-only** payload and call `notifee.displayNotification()` from a headless task — this lets the JS-side `android.sound` win, at the cost of running JS on every push. Most apps should prefer the server-side payload approach.

**Local notifications are different.** This limitation only affects **remote pushes** delivered by FCM/APNs while the app is killed. Notifications scheduled locally via `notifee.displayNotification()` or `notifee.createTriggerNotification()` — for example, a timer firing after the user closed the app — *do* honor the JS-side `sound` parameter, because the library itself wakes up and presents the notification (via `AlarmManager` on Android or `UNUserNotificationCenter` on iOS). The usual platform rules still apply: on Android the `NotificationChannel` sound is immutable after creation and wins over the per-notification `sound`; on iOS the sound file must be bundled in the app (`.wav`/`.aiff`/`.caf`, under 30 seconds, in the main bundle). For reliable local timer notifications on OEM devices that aggressively kill background work, prefer `AlarmType.SET_ALARM_CLOCK` — see the [Timers: foreground service or `SET_ALARM_CLOCK`?](#timers-foreground-service-or-set_alarm_clock) section.

Reference: [invertase/notifee#927](https://github.com/invertase/notifee/issues/927).

### Manual warmup control

The library automatically pre-warms the foreground service notification path during app startup via `InitProvider`. **Most apps do not need to do anything extra.** However, in certain edge cases the automatic warmup may not be sufficient:

- **Lazy-loaded library** — if `react-native-notify-kit` is code-split or lazy-loaded, `InitProvider` runs but the TurboModule/JS bridge side isn't initialized yet.
- **Post-splash-screen warmup** — apps that want to defer warmup to after the splash screen instead of during `Application.onCreate()`.
- **Low-end devices** — rare cases where the `InitProvider` warmup hasn't finished by the time the user triggers the first notification.

For these cases, call `prewarmForegroundService()` at a moment of your choosing:

```typescript
import notifee from 'react-native-notify-kit';

// Call after splash screen, during onboarding, or before the user
// is likely to trigger a foreground service notification.
await notifee.prewarmForegroundService();
```

**Key facts:**

- **Idempotent** — safe to call multiple times; class loading after the first call is a no-op from ART's perspective.
- **iOS no-op** — resolves immediately on iOS (Android-only optimization).
- **Does NOT start a foreground service** — it only performs class loading and Binder proxy warming. No Google Play policy risk.
- **Best-effort** — internal failures are logged and swallowed; the promise always resolves.

To verify whether calling this method provides a measurable benefit for your app, capture a Perfetto trace with the `notifee:*` trace sections enabled and compare the `notifee:displayNotification` duration with and without the prewarm call.

### Regenerating the Baseline Profile

The library ships a Baseline Profile (`packages/react-native/android/src/main/baseline-prof.txt`) that instructs ART to AOT-compile the notification hot path at install time. This profile should be regenerated after significant changes to the notification display code path.

**Prerequisites:**

- A physical device connected via adb (Pixel 9 Pro XL with Android 16+ recommended) or a running emulator with API 33+
- The smoke app must be buildable (`yarn install` in the repo root)

**Command:**

```bash
bash scripts/generate-baseline-profile.sh
```

The script runs the macrobenchmark test in `apps/smoke/android/baselineprofile/`, captures the profile on the connected device, filters it to library-only rules, and copies it to the library's `src/main/baseline-prof.txt`. Review the generated file for unexpected entries, then commit it.

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
