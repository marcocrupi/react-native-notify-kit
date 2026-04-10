# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **Android**: Foreground service notifications on Android 12+ (API 31+) were subject to a system-imposed display delay of up to 10 seconds because the library never called `setForegroundServiceBehavior(FOREGROUND_SERVICE_IMMEDIATE)`. This is now set by default when `asForegroundService: true`, eliminating the delay. Upstream issues: [invertase/notifee#272](https://github.com/invertase/notifee/issues/272), [invertase/notifee#1242](https://github.com/invertase/notifee/issues/1242). Opt out by setting `foregroundServiceBehavior: AndroidForegroundServiceBehavior.DEFERRED` on the notification's `android` config.

- **Android**: ANR-proofed the foreground service STOP path. When a `ForegroundService` instance receives a STOP intent (or null intent) without `startForeground()` having been called on that instance — possible when Android recreates the service after a process kill, or when a cancellation alarm races with the display path — the service now calls a defensive `startForeground()` with a minimal placeholder notification before `stopSelf()`, preventing `ForegroundServiceDidNotStartInTimeException` (ANR). The placeholder is immediately torn down via `stopForeground(STOP_FOREGROUND_REMOVE)` and is not visible to the user.

- **Android**: Reset stale `mCurrentNotification`, `mCurrentHashCode`, and `mCurrentForegroundServiceType` on the foreground service NONE early return path (API 34+, no `foregroundServiceType` declared in manifest). Previously, these fields retained values from a prior invocation when the same service instance was reused, potentially causing incorrect notification updates or mismatched hash codes on subsequent valid invocations.

- **Android**: Empty `foregroundServiceTypes` arrays that bypass the TypeScript validator (e.g., trigger notifications restored from the Room database after a library upgrade) are now treated as absent at the native layer in `NotificationAndroidModel.getForegroundServiceType()`, with a diagnostic log message. The TypeScript validator already rejects empty arrays at validation time.

- **TypeScript**: Numeric enum validators now correctly reject reverse-mapped string keys across all numeric enum types (`AndroidBadgeIconType`, `AndroidDefaults`, `AndroidFlags`, `AndroidGroupAlertBehavior`, `AndroidImportance`, `AndroidVisibility`, `AndroidForegroundServiceType`, `AndroidForegroundServiceBehavior`, `RepeatFrequency`, `AlarmType`). Previously, passing a string like `importance: "HIGH"` instead of `importance: AndroidImportance.HIGH` passed validation but was silently ignored by the native `Bundle.getInt()` call, causing the default value to be used. TypeScript consumers were not affected because the type system already rejected this at compile time. JavaScript consumers passing string keys will now receive a clear validation error and should use the numeric enum values instead.

- **Tests**: `setPlatform` test helper no longer fails silently on repeated calls within a single test block. Added `configurable: true` and `writable: true` to the `Object.defineProperty` calls.

- **Android**: `ForegroundService` defensive STOP path now fails fast with a clear error message and documentation URL when the consumer's manifest is missing required `foregroundServiceType` declarations on API 34+, instead of silently ANRing with a cryptic framework stack trace.

- **Android**: `ForegroundService` NONE early return path now honors Android's 5-second `startForeground()` contract via the same tracked-boolean defensive pattern as the STOP path, preventing edge-case ANRs during service recreation after process kill.

- **Android**: `ForegroundService.stop()` now logs a warning (via `Logger.w`) when `startService()` throws `IllegalStateException` and falls back to `stopService()`, instead of silently swallowing the exception. The fallback behavior is unchanged.

- **Android**: `getLights()` and `cancelAllNotificationsWithIds()` now preserve exception stack traces in their error logs, making production failures diagnosable in bugreports.

- **iOS**: `didReceiveNotificationResponse:withCompletionHandler:` now calls the completion handler immediately after emitting the PRESS/ACTION_PRESS event, instead of delaying it by 15 seconds via `dispatch_after`. The delay was a placeholder from 2020 (upstream Invertase) that was never revisited. Apple's contract requires prompt invocation; the 15-second delay could cause iOS to consider the handler lost, block subsequent notification tap deliveries, or trigger process termination if the app was suspended during the wait.

- **iOS**: `requestPermission:` now propagates the `NSError` from `requestAuthorizationWithOptions:completionHandler:` to the JS promise. Previously, the error was silently swallowed (with a TODO comment acknowledging the gap since day 1), and `getNotificationSettings:` was called unconditionally — resolving the promise with settings data even when the authorization request failed. Apps under MDM restrictions or system-level notification policies could not detect or report the failure.

- **iOS**: `displayNotification:` and `createTriggerNotification:` now capture and log errors from `contentByUpdatingWithProvider:error:` (communication notification intent) instead of passing `nil` for the error parameter. On failure, the notification is displayed with the original content (without communication styling) rather than potentially receiving nil content. This mirrors the error-handling pattern already present in the Notification Service Extension helper (`NotifeeCoreExtensionHelper`).

- **iOS**: `getBadgeCount:` now calls the completion block with `(nil, 0)` when running in an app extension, instead of returning without calling the block. This matches the fallthrough pattern used by `setBadgeCount:`, `incrementBadgeCount:`, and `decrementBadgeCount:`, and prevents the JS promise from hanging indefinitely if `getBadgeCount()` is called from a Notification Service Extension.

- **iOS**: Fixed a race condition in `NotifeeCoreDelegateHolder.didReceiveNotifeeCoreEvent:` where a notification event could be silently dropped (neither delivered nor buffered) if the weak delegate reference was zeroed (e.g., during JS reload in dev mode) while the `delegateRespondsTo` bitfield still indicated the delegate was available. The locked path now checks the resolved delegate for nil and falls back to buffering, ensuring events are preserved for the next `setDelegate:` call to flush.

- **iOS**: Added `@synchronized(self)` guards around all access to `hasListeners` and `pendingCoreEvents` in `NotifeeApiModule.mm`. Previously, `didReceiveNotifeeCoreEvent:` (called from arbitrary UNUserNotificationCenter callback threads) could mutate `pendingCoreEvents` concurrently with `startObserving` (main thread), risking an NSMutableArray concurrent-mutation crash or silent event loss. The synchronization pattern matches `NotifeeCoreDelegateHolder`.

- **iOS**: Replaced placeholder `// update me with logic` comment on the empty `messaging_didReceiveRemoteNotification:` handler (`NotifeeCore+NSNotificationCenter.m`) with documentation explaining that remote notifications are handled via `UNUserNotificationCenterDelegate` and the observer registration is preserved intentionally.

- **iOS**: Notification Service Extension attachment downloads now cap the `NSURLSession` request and resource timeouts at 25 seconds, leaving a 5-second margin before iOS's ~30-second NSE budget expires. Previously, the default 60-second timeout could cause the extension process to be killed mid-download by `serviceExtensionTimeWillExpire` before `contentHandler` was called, resulting in the notification being lost entirely. This is a defense-in-depth fix — consumers should still implement their own `serviceExtensionTimeWillExpire` as a safety net, per the README's NSE guidance.

### Added

- **Android**: New `AndroidForegroundServiceBehavior` enum (`DEFAULT`, `IMMEDIATE`, `DEFERRED`) and `foregroundServiceBehavior` property on `NotificationAndroid`. Controls whether foreground service notifications are shown immediately or deferred on Android 12+. Defaults to `IMMEDIATE` when `asForegroundService: true` and the property is omitted.

- **Android**: `android.os.Trace` instrumentation on the foreground service notification path. Custom trace sections (`notifee:displayNotification`, `notifee:buildNotification`, `notifee:startForegroundService`, `notifee:ForegroundService.onStartCommand`, `notifee:startForeground`, `notifee:InitProvider.onCreate`, `notifee:warmup`) are visible in Perfetto traces for profiling notification display latency.

- **Android**: `notifee.prewarmForegroundService()` opt-in API for manual warmup control. Pre-warms the foreground service notification path by eagerly loading critical classes and warming the `INotificationManager` Binder proxy on a background thread. Most apps do not need this — the library handles warmup automatically via `InitProvider`. This is an escape hatch for edge cases: lazy-loaded libraries, post-splash-screen warmup, or low-end devices where the automatic warmup hasn't completed by the first notification. Idempotent, safe to call multiple times. Resolves immediately as a no-op on iOS.

- **Android**: Baseline Profile shipped in the library AAR covering the foreground service notification cold-start path. Instructs ART to AOT-compile notification hot-path methods at install time, eliminating JIT penalty on first invocation (estimated 20-40% reduction in JIT cost on first `displayNotification()` call). Fully transparent to consumers — AGP 8.3+ automatically merges the profile at APK build time.

### Changed

- **Android**: `InitProvider` now pre-loads critical foreground service classes (`ForegroundService`, `NotificationManager`, `NotificationCompat.Builder`, etc.) and pre-warms the `INotificationManager` Binder proxy on a low-priority background thread during app startup. This moves ~50–100 ms of ART class loading and verification cost from the first `displayNotification()` call to app initialization, where it has zero UI impact. Opt out via `<meta-data android:name="notifee_init_warmup_enabled" android:value="false" />` in your app's `AndroidManifest.xml`.

- **Android**: `androidx.profileinstaller:profileinstaller:1.4.1` is now a transitive (`api`) dependency of the library. Consumers do not need to add it manually, but apps with custom dependency resolution may need to be aware of the new transitive dependency. This enables baseline profile installation on non-Play-Store distributions.

- Added AGP version (8.12.0) to `CLAUDE.md` platform requirements.

- Minor version bump recommended (e.g., `9.5.0`) due to the numeric enum validator strictness change. While the previous behavior (accepting reverse-mapped string keys) was always a bug, it is technically an observable behavior change for JavaScript consumers. TypeScript consumers are unaffected.

## [9.3.0] - 2026-04-09

### Changed

- **Android**: `pressAction` now defaults to `{ id: 'default', launchActivity: 'default' }` when omitted from the notification payload. Previously, notifications without an explicit `pressAction` would display correctly but tapping them did nothing — a silent footgun, especially for trigger notifications where the "tap doesn't open app" symptom only manifested after an app kill (the internal `NotificationReceiverActivity` would launch, post the sticky `InitialNotificationEvent` to EventBus, and immediately finish, leaving the user with no app visible). Apps that intentionally want a non-tappable notification can pass `pressAction: null` explicitly to opt out. Opt-out via `pressAction: null` is implemented using a reserved sentinel id (`__NOTIFEE_OPT_OUT__`) at the TS→native boundary to survive Bundle serialization reliably.

- **iOS**: **Behavior change** — `EventType.DELIVERED` is now emitted to `onForegroundEvent` for **all** Notifee-owned notifications displayed while the app is in foreground, not just trigger notifications. Previously, the iOS implementation in `willPresentNotification:` had a `if (notifeeTrigger != nil)` guard inherited from upstream Notifee that suppressed DELIVERED for notifications created via `displayNotification()` (immediate display, no trigger). The notification was shown to the user but no event was emitted, breaking analytics, badge counters, and any other code relying on a global DELIVERED listener. Android always emitted DELIVERED in both cases, so this also resolves a long-standing iOS/Android asymmetry. To avoid duplicate events, the DELIVERED emission in `displayNotification:withBlock:` (which fires from the `addNotificationRequest:` completion handler) is now gated to non-foreground states — `willPresentNotification:` handles the foreground case, and the completion handler handles background/inactive. **Potential impact**: apps that registered `onForegroundEvent` listeners on iOS may now receive DELIVERED events they did not before (one per `displayNotification()` call while in foreground). If your handler does heavy work per DELIVERED event, audit it. There is no opt-out flag — the previous behavior was a bug, and the new behavior matches Android. **Known limitation**: trigger notifications that fire while the app is in background or killed still do not emit DELIVERED on iOS. This is a platform limitation — `willPresentNotification:` is only invoked when the app is in foreground, and iOS does not provide a delegate callback for trigger notifications presented by the system in background. Android does not have this limitation (it emits DELIVERED unconditionally from `displayNotification()` for both immediate and trigger notifications). If you need delivery confirmation for background trigger notifications on iOS, check the notification's presence via `getDisplayedNotifications()` after the app returns to foreground.

### Fixed

- **Android**: Fixed `NotificationManager.displayNotification()` producing a tap-less PendingIntent when `pressAction` is absent from the notification bundle. The native path now synthesizes the default press action bundle and routes through the same `createLaunchActivityIntent(...)` code path used for explicit `pressAction` payloads — extending the defense-in-depth approach of 9.1.19 to the "pressAction entirely absent" case. Protects trigger notifications rehydrated from the Room database after reboot/kill, headless tasks, and any other code path that bypasses the TS validator. **Known limitation**: on pre-Android 12 devices, the `ReceiverService` code path does not benefit from the native defense-in-depth synthesis — only the TS validator default applies. This affects trigger notifications stored in Room DB before the fix was deployed on devices running Android 11 and below.

- **iOS**: Fixed potential loss of notification events at cold start when the React Native bridge takes longer than 1 second to initialize. The previous implementation in `NotifeeCoreDelegateHolder` used a `dispatch_after(1 sec)` + `dispatch_once` combo to drain `_pendingEvents` (PRESS, DELIVERED, etc. emitted by iOS before `NotifeeApiModule` was ready). On large apps or slow devices where the bridge init exceeded 1 second, the flush could run before the delegate was connected, and the `dispatch_once` prevented any retry — events were permanently lost. The same `dispatch_once` also prevented re-flushing after a JS reload in dev mode, since the static token had already fired. Replaced with an event-driven synchronous flush triggered when `setDelegate:` installs a valid delegate: pending events are drained in FIFO order immediately, and any future delegate re-assignment (JS reload) flushes again. The second-level buffer in `NotifeeApiModule.pendingCoreEvents` (drained by `startObserving`) continues to handle the "delegate set but JS listeners not yet attached" window, so events are never dropped regardless of bridge or JS timing. Added `@synchronized(self)` around `_pendingEvents` mutations for thread safety. No public API change.

- **iOS**: Corrected error message in `validateIOSPermissions` — the validator for the `badge` field threw `"'alert' badge a boolean value."` (wrong property name and ungrammatical) instead of `"'badge' expected a boolean value."`. Dev-only, surfaces only when passing a non-boolean to `requestPermission({ badge })`.

### Removed

- Removed unused `.buckconfig` (Buck is no longer used by React Native since 0.74; file was stale since 2019).
- Removed unused `.flowconfig` (project is TypeScript-only; Flow config was a leftover from the original Invertase fork). Verified no references in `package.json`, CI workflows, or scripts.
- **Android**: Removed unused EventBus annotation processor (`org.greenrobot:eventbus-annotation-processor`) and its `eventBusIndex` build option from the Gradle configuration. The generated `EventBusIndex` class was never referenced at runtime — `EventBus.builder().build()` is called without `.addIndex()`. This eliminates the confusing build warning `The following options were not recognized by any processor: '[eventBusIndex]'` reported in some configurations. No functional change — EventBus runtime dependency is unchanged.

## [9.2.1] - 2026-04-08

### Fixed

- **iOS**: PRESS events from notification taps while the app was in background were incorrectly routed to `onForegroundEvent` instead of `onBackgroundEvent`. Three issues were addressed in `sendNotifeeCoreEvent:` (`NotifeeApiModule.mm`): (1) a `dispatch_after(1 second)` delay introduced during the TurboModule migration (9.1.0, commit 7082401) caused `UIApplication.applicationState` to be checked 1 second after the delegate callback — by which time iOS had already transitioned the app to Active, making the background branch unreachable; (2) the condition `== UIApplicationStateBackground` was incorrect because iOS reports `Inactive` (not `Background`) at the moment of a notification tap from background — changed to `!= UIApplicationStateActive`; (3) `applicationState` was being read on a background thread (`UNUserNotificationServiceConnection` queue), violating UIKit's main-thread requirement — wrapped in `dispatch_async(dispatch_get_main_queue())`. The existing two-tier event queue (`NotifeeCoreDelegateHolder._pendingEvents` + `pendingCoreEvents`) already handles the "JS not ready" case, so the delay was redundant. Known limitation: non-tap events (DELIVERED, TRIGGER_NOTIFICATION_CREATED, DISMISSED) emitted while the app is momentarily in Inactive state for unrelated reasons — Control Center open, incoming call — will be routed to the background handler. In practice this is uncommon because these events originate from contexts where the app is typically Active. If you rely on strict foreground delivery for non-tap events, check `AppState.currentState` in your handler. (#5)

## [9.2.0] - 2026-04-08

### Changed

- **Android**: **Internal architecture change** — collapsed the standalone NotifeeCore AAR into the React Native bridge as a single Android library module. The bundled local Maven repo at `packages/react-native/android/libs/` and the frozen coordinate `app.notifee:core:202108261754` (a 2021 timestamp inherited from upstream Invertase) are gone. Core Java sources now live at `packages/react-native/android/src/main/java/app/notifee/core/` and are compiled from source by the consumer app on every build.

  **No public API changes.** The TypeScript surface is unchanged. Migration from 9.1.x requires zero code changes — upgrade the package and rebuild.

  Verified end-to-end on a Pixel 9 Pro XL (Android 16): local notification display, AlarmManager-backed trigger notifications with the app killed, foreground service with `shortService` 3+ minute timeout (the 9.1.13 `onTimeout()` fix is preserved), and FCM push notifications.

### Fixed

- **Android**: `FAIL_ON_PROJECT_REPOS` rejection on React Native 0.74+. The library no longer injects a Maven repository into the consumer's `rootProject.allprojects { repositories { ... } }` block. React Native 0.74+ ships `settings.gradle` with `dependencyResolutionManagement { repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS }`, which rejected the previous pattern at Gradle sync time. The merged module no longer needs to inject any repository because the core sources are part of the bridge module.

- **Android**: Stale Gradle cache serving outdated bytecode after `yarn upgrade`. Previously, the Maven coordinate `app.notifee:core:202108261754` was reused across all releases with different AAR contents — Gradle's cache assumes Maven coordinates are immutable and could serve a stale AAR from `~/.gradle/caches/modules-2/files-2.1/app.notifee/core/202108261754/` even after a successful npm upgrade. This was a silent, intermittent bug that affected only consumers who had previously installed any version of the library on the same machine. With the coordinate gone, the bytecode is rebuilt from source on every consumer build, making this bug structurally impossible.

## [9.1.22] - 2026-04-08

### Fixed

- **iOS**: Fixed duplicate symbols linker error when using Notification Service Extension (`$NotifeeExtension = true`) with static frameworks (`use_frameworks! :linkage => :static`). `NotifeeExtensionHelper.{h,m}` was compiled by both `RNNotifee` and `RNNotifeeCore` pods; added `s.exclude_files` in the `$NotifeeExtension` branch of `RNNotifee.podspec` so the files are only compiled by `RNNotifeeCore`.

## [9.1.21] - 2026-04-07

### Changed

- Updated README (root and npm) to reflect upstream archival: the original `invertase/notifee` repository was officially archived on April 7, 2026, and its README now recommends `react-native-notify-kit` as a community-maintained drop-in replacement

## [9.1.20] - 2026-04-07

### Fixed

- **iOS**: `willPresentNotification:` fallback no longer silently drops foreground notifications when no original `UNUserNotificationCenterDelegate` was captured. The fallback path (taken when the incoming notification is not Notifee-owned and `_originalDelegate == nil`) previously called `completionHandler(UNNotificationPresentationOptionNone)`, which told iOS to display nothing — no banner, no sound, no badge, no Notification Center entry. It now returns the platform default presentation options (banner, sound, list, badge on iOS 14+; alert, sound, badge on earlier), matching what iOS would do if Notifee had not installed a delegate at all. This affects apps using `react-native-notify-kit` without a library that also sets a `UNUserNotificationCenter` delegate — for example, apps without `@react-native-firebase/messaging`, or apps using a different push provider (OneSignal, AWS SNS, etc.). Apps using RN Firebase are unaffected: Firebase's delegate is captured as `_originalDelegate` at `+load` time and the forwarding branch is taken instead of the fallback. Note: this is **not** a duplicate of the v9.1.12 fix — v9.1.12 addressed a separate bug where the `completionHandler` was not called at all in that branch (causing handler leaks). v9.1.12 added the call with a value of `None`, which fixed the leak but left notifications silently dropped. This release changes the value passed to `completionHandler`, not whether it is called.
- **iOS**: Resolved upstream issue [invertase/notifee#828](https://github.com/invertase/notifee/issues/828) — "All notifications are dismissed when the app is opened". Verified on a real iOS device with `react-native-notify-kit`: with the app killed, four FCM push notifications were sent in sequence, all four appeared in Notification Center, the app was opened by tapping its icon (not by tapping a notification), and after backgrounding the app all four notifications were still present and intact. The bug was likely addressed incrementally by the cumulative iOS fixes in this fork — the delegate hijacking and capture work, the v9.1.12 `completionHandler` fixes in `willPresentNotification:` and `didReceiveNotificationResponse:`, the iOS 16+ badge management via `setBadgeCount:`, and the most recent fix to the `willPresentNotification:` fallback path that previously returned `UNNotificationPresentationOptionNone`. The original upstream `@notifee/react-native@9.1.8` has not received updates since December 2024; users affected by #828 can resolve it by switching to `react-native-notify-kit`.

## [9.1.19] - 2026-04-07

### Fixed

- **Android**: `pressAction.launchActivity` now defaults to `'default'` at the
  native layer when `pressAction.id === 'default'` and `launchActivity` is not
  explicitly set. The TypeScript validator has applied this default since
  upstream PR #141 (Sept 2020), but native code paths that bypass the JS
  validator (trigger notifications restored from the Room database after
  reboot, headless tasks, future bridge changes) could reach native code with
  `launchActivity` unset, causing "tap doesn't open app" bugs in certain
  Android task management edge cases. This defense-in-depth fix closes the
  gap at the native layer.

  No user-facing behavior change for apps using the standard JS API — the
  validator already handled this case. Safe to upgrade.

- **Android**: Fixed a pre-existing upstream bug in `NotificationPendingIntent`
  where String comparisons on line 155-157 used `!=` (reference equality)
  instead of `.equals()` (value equality). The bug was dormant before this
  release because the buggy code path was never reached for the
  `id === 'default'` case — the null guard above it always short-circuited.
  The new native layer default for `launchActivity` would have routed the
  default press action through the buggy comparison for the first time,
  unnecessarily overwriting the `getLaunchIntentForPackage()` intent with
  a manually constructed one with different task stack flags. Both fixes
  ship together because they are logically coupled.

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

## [9.1.11] - 2026-04-04

### Fixed

- Fixed Maven metadata checksums for published Android artifacts

### Added

- Added compatibility section to README documenting supported React Native versions

## [9.1.10] - 2026-04-04

### Fixed

- Fixed Maven metadata checksums for published Android artifacts
- Aligned package LICENSE with root repository LICENSE

## [9.1.9] - 2026-04-04

### Changed

- Renamed package from `@notifee/react-native` to `react-native-notify-kit` across all source, configs, and documentation
- **Android**: Replaced deprecated Kotlin APIs with current equivalents — `currentActivity` → `getCurrentActivity()`, `TurboReactPackage` → `BaseReactPackage`, `hasActiveCatalystInstance()` → `hasActiveReactInstance()`
- Moved Jest tests from `tests_react_native/` into `packages/react-native/__tests__/` and removed the legacy test directory
- Renamed `tests_react_native_new/` to `apps/smoke/` to clarify its role as a smoke-test app
- Simplified GitHub Actions CI by removing stale workflows

### Fixed

- Removed `--provenance` flag from `publishConfig` to allow local `npm publish`
- Excluded test files from root `tsconfig.json` and fixed lint formatting

### Removed

- Removed `notifee_platform_interface` package and its associated tests and dependencies (Flutter support dropped)

## [9.1.8-rn084.0] - 2026-03-30

Initial fork release targeting React Native 0.84 with TurboModule (JSI) architecture.

### Added

- **Android**: Migrated React Native bridge from legacy NativeModule to Kotlin TurboModule with JSI bindings
- **iOS**: Migrated React Native bridge from legacy NativeModule to TurboModule with JSI bindings
- Added React Native 0.84 smoke-test app with updated Jest configuration

### Fixed

- Fixed workspace-level lint and typecheck validation errors

### Changed

- Updated README to clarify maintained-fork positioning and project scope
