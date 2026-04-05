# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [9.1.12] - 2026-04-05

### Changed

- **Android**: Changed default AlarmType from `SET_EXACT` to `SET_EXACT_AND_ALLOW_WHILE_IDLE` for better Doze mode compatibility (upstream: [invertase/notifee#961](https://github.com/invertase/notifee/issues/961))
- **Android**: AlarmManager is now the default backend for trigger notifications instead of WorkManager, ensuring reliable delivery when the app is killed. Developers can opt out with `alarmManager: false` in the trigger config. (upstream: [invertase/notifee#961](https://github.com/invertase/notifee/issues/961))

### Fixed

#### Android

- Fixed `getNotificationSettings()` returning `DENIED` instead of `NOT_DETERMINED` on Android 13+ before the user has responded to the `POST_NOTIFICATIONS` permission dialog — now uses `SharedPreferences` to track whether `requestPermission()` has been called (upstream: [invertase/notifee#1237](https://github.com/invertase/notifee/issues/1237))
- Fixed trigger notifications not firing on Android 14-15 when app is killed — added `goAsync()` to `NotificationAlarmReceiver`, `RebootBroadcastReceiver`, and `AlarmPermissionBroadcastReceiver` to prevent process termination before async notification display completes (upstream: [invertase/notifee#1100](https://github.com/invertase/notifee/issues/1100))
- Fixed `ContextHolder` not initialized in `NotificationAlarmReceiver`, causing potential `NullPointerException` on OEM Android 14+ implementations where `InitProvider` may not run before alarm receivers
- Fixed `SCHEDULE_EXACT_ALARM` permission denial silently dropping scheduled alarms — now falls back to inexact alarm via `setAndAllowWhileIdle` with a warning log
- Added `SecurityException` catch around `AlarmManager` scheduling calls — if exact alarm permission is revoked between check and call, falls back to inexact alarm instead of crashing
- Fixed potential NPE in alarm scheduling when `PendingIntent` creation fails
- Fixed `getInitialNotification()` returning `null` when notification has no `pressAction` configured — `InitialNotificationEvent` sticky event is now posted regardless of `pressAction` presence (upstream: [invertase/notifee#1128](https://github.com/invertase/notifee/issues/1128))
- Added event buffering in `NotifeeReactUtils` to prevent foreground press events from being silently dropped when React instance is not yet ready (upstream: [invertase/notifee#1279](https://github.com/invertase/notifee/issues/1279))
- Fixed `AlarmType.SET` using `RTC` instead of `RTC_WAKEUP`, which prevented the device from waking to show the notification (upstream: [invertase/notifee#961](https://github.com/invertase/notifee/issues/961))

#### iOS

- Fixed `getInitialNotification()` returning `null` on cold start due to deprecated `UIApplicationLaunchOptionsLocalNotificationKey` check — `_initialNoticationID` was always `nil` on iOS 10+, causing the ID comparison to fail (upstream: [invertase/notifee#1128](https://github.com/invertase/notifee/issues/1128))
- Added `setNotificationConfig({ ios: { handleRemoteNotifications: false } })` opt-out flag to prevent Notifee from intercepting remote notification tap handlers — restores `onNotificationOpenedApp()` and `getInitialNotification()` for React Native Firebase Messaging (upstream: [invertase/notifee#912](https://github.com/invertase/notifee/issues/912))
- Fixed `completionHandler` not being called on notification dismiss path in `didReceiveNotificationResponse:`, preventing potential handler leaks
- Fixed `completionHandler` not being called in `willPresentNotification:` fallback path when no original delegate is available
- Added missing `return` after forwarding to `_originalDelegate` in `didReceiveNotificationResponse:` default path, preventing potential fall-through to `parseUNNotificationRequest`
