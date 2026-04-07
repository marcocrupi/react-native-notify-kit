# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [9.1.18] - 2026-04-07

### Fixed

- **Android**: Fixed `AbstractMethodError` on `RoomDatabase.createOpenHelper` when consumer apps resolved `androidx.room:room-runtime` < 2.6.0. Root cause: the core AAR's Maven POM was empty (published via raw `artifact()` instead of `from(components.release)`), so Room and all other core dependencies were invisible to Gradle dependency resolution in consumer projects. The fix:
  - Core AAR now publishes a proper POM via `from(components.release)` with `android.publishing.singleVariant("release")`, exposing all runtime dependencies including Room 2.8.4
  - React Native bridge module now declares `room-runtime:2.8.4`, `sqlite:2.6.2`, and `sqlite-framework:2.6.2` as `api` dependencies to guarantee they participate in consumer classpath resolution
  - Fixed `fresco` incorrectly scoped as `api` in core `build.gradle` — changed to `implementation` (not part of the public API)
  - Aligned `guava` (33.3.1 → 33.5.0) and `work-runtime` (2.8.0 → 2.11.1) versions between core and bridge to prevent silent downgrades

**Note for consumers with custom dependency pinning:** The core AAR POM now exposes its runtime dependencies (`room-runtime`, `guava`, `fresco`, `core`, `work-runtime`, `eventbus`, `concurrent-futures`, `annotation`). If you have `resolutionStrategy.force` or `strictly` constraints on any of these, verify compatibility after upgrading.

## [9.1.17] - 2026-04-06

### Changed

- Softened tone in "Why this fork" README section
- Added Trademark Notice section to README

## [9.1.16] - 2026-04-06

### Changed

- Synced npm README with changelog formatting updates

## [9.1.15] - 2026-04-06

### Changed

- **Android**: Update Room 2.5.0→2.8.4, WorkManager 2.8.0→2.11.1, Guava 33.3.1→33.5.0
- **Android**: Cleaned up ProGuard rules — removed redundant entries, consolidated keep rules, suppressed pre-existing build warnings with targeted `@SuppressWarnings` annotations
- **Android**: Fixed raw `Class` type usage in `NotificationManager` (now `Class<?>`)
- **iOS**: Align NotifeeCore Xcode project deployment target from iOS 10.0 to iOS 15.1, matching the podspec

### Fixed

- **Android**: Fixed ProGuard keep rules using `{ <init>(...); }` (constructor-only) instead of `{ *; }` (all members) — classes annotated with `@Keep` or `@KeepForSdk` could have non-constructor members stripped by R8
- **Android**: Fixed WakeLock leak in `PowerManagerUtils.lightUpScreenIfNeeded` — `acquire()` without timeout or `release()` prevented the device from sleeping; now uses `acquire(3000L)`
- **Android**: Fixed potential NPE in `NotificationAndroidModel.getDefaults` when the `defaults` array is present but empty — auto-unboxing null `Integer` caused a crash
- **Android**: Added `-keeppackagenames app.notifee.core.**` to ProGuard rules to prevent `-repackageclasses` from relocating `InitProvider` and sub-package classes, which could cause `ClassNotFoundException` at runtime
- **Android**: Fixed missing `return` after null context check in `IntentUtils.startActivityOnUiThread` — the lambda was still posted to the UI thread, causing NPE

## [9.1.14] - 2026-04-06

### Changed

- **Android**: `ongoing` now defaults to `true` when `asForegroundService: true` and `ongoing` is not explicitly set. This prevents foreground service notifications from being dismissed by the user on Android 13, matching pre-Android 13 platform behavior. (upstream: [invertase/notifee#1248](https://github.com/invertase/notifee/issues/1248))
- **Android**: On Android 14+, foreground service notifications are automatically re-posted when dismissed by the user. Android 14 ignores `FLAG_ONGOING_EVENT` for most foreground service types (except `mediaPlayback`, `phoneCall`, and enterprise DPC); the library now detects the dismissal and immediately re-displays the notification while the service is active. (upstream: [invertase/notifee#1248](https://github.com/invertase/notifee/issues/1248))

### Fixed

- **Android**: Fixed DST (daylight saving time) shifting repeating notifications by ±1 hour — replaced fixed-millisecond arithmetic with `Calendar.add()` which preserves local wall-clock time across DST boundaries (upstream: [invertase/notifee#875](https://github.com/invertase/notifee/issues/875))
- **Android**: Fixed repeating trigger timestamp not persisted to database after recalculation — after reboot, notifications could fire at stale times

## [9.1.13] - 2026-04-05

### Changed

- **Android**: **BREAKING** — Removed hardcoded `foregroundServiceType="shortService"` from the library's `AndroidManifest.xml`. Apps using `asForegroundService: true` on Android 14+ must now declare their own `foregroundServiceType` on `app.notifee.core.ForegroundService` in their app manifest. See the "Foreground Service Setup" section in the README for migration instructions. (upstream: [invertase/notifee#1108](https://github.com/invertase/notifee/issues/1108))

### Fixed

- **Android**: Implemented `onTimeout(int)` (API 34) and `onTimeout(int, int)` (API 35+) in `ForegroundService` to gracefully stop the service when Android's foreground service timeout fires. Previously, the missing handler caused an ANR crash when using `shortService` type. (upstream: [invertase/notifee#703](https://github.com/invertase/notifee/issues/703))
- **Android**: Added early abort with clear error logging when `foregroundServiceType` is not declared in the app manifest on Android 14+, preventing Android's cryptic `MissingForegroundServiceTypeException` crash.
- **Android**: Fixed bitwise `&` used instead of logical `&&` in `ForegroundService.onStartCommand()` null check — both operands were always evaluated, risking unintended side effects if the right side had them.
- **Android**: Replaced deprecated `stopForeground(boolean)` with `stopForeground(STOP_FOREGROUND_REMOVE)` on API 33+ via compat helper, with fallback for API 24-32.
- **Android**: Added `synchronized` blocks around `ForegroundService` static field cleanup to prevent race conditions between the STOP action handler, headless task completion callback, and `onTimeout()` paths.
- **Android**: `ForegroundService.onTimeout()` now emits a `TYPE_FG_TIMEOUT` (9) event via `EventBus` with the notification data, `startId`, and `fgsType` — previously the service died silently with no event reaching JS.

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
