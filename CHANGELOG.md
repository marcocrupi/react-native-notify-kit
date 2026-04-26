# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **React Native**: `TimestampTrigger.repeatInterval` for calendar-based custom repeat intervals on timestamp triggers. Timestamp triggers now support custom repeat intervals such as every 2 days, every 2 weeks, and every 3 months from the selected start timestamp.
- **React Native**: `RepeatFrequency.MONTHLY` for monthly timestamp trigger recurrence. Yearly recurrence is not supported.
- **iOS**: custom repeat intervals are implemented with a bounded rolling schedule of one-shot local notifications, with top-up when the app becomes active, when the user interacts with a notification, or when a rolling notification is delivered in foreground.

### Changed

- **iOS**: migrated deprecated SiriKit call intent identifiers to Apple's unified `INStartCallIntentIdentifier`. The public `IOSIntentIdentifier.START_CALL` should be used for notification category intent identifiers. Legacy `START_AUDIO_CALL` and `START_VIDEO_CALL` values remain accepted for compatibility, but now map to the unified call intent identifier. `getNotificationCategories()` can return `START_CALL` when reading back call intent categories from iOS.
- **iOS**: deprecated announcement and notification-summary options are now treated as compatibility no-ops on supported iOS versions. Explicit announcement authorization requests are no longer needed because announcement authorization is included by iOS on supported versions, while notification summary arguments are ignored by iOS 15+. The JS fields remain available for backward compatibility and are marked as deprecated in the TypeScript reference.
- **iOS behavior change**: repeating `TimestampTrigger` notifications now use a bounded rolling schedule of one-shot local notifications instead of a native repeating `UNCalendarNotificationTrigger`. This makes custom repeat intervals (`repeatInterval`) and `RepeatFrequency.MONTHLY` possible, respects the selected start timestamp, and rebalances the rolling pending-notification budget across active series. Apps that relied on iOS native repeating calendar triggers being scheduled indefinitely should review the new iOS rolling-window behavior: the library keeps upcoming occurrences scheduled and tops them up when the app becomes active, when the user interacts with a notification, or when a rolling notification is delivered in foreground. iOS does not wake an app merely because a local notification was delivered while the app is killed or suspended, so the rolling window cannot be extended indefinitely unless the app runs again.
- **Android**: timestamp trigger recurrence now advances by `repeatFrequency * repeatInterval` using calendar-aware scheduling. Existing triggers without `repeatInterval` keep the previous behavior with interval `1`.

### Fixed

- **iOS**: rolling timestamp triggers now rebalance the bounded pending-notification window across all active rolling series. This prevents earlier recurring triggers from consuming the entire iOS pending budget and blocking later triggers such as `DAILY + repeatInterval: 2`, `WEEKLY + repeatInterval: 2`, and `MONTHLY + repeatInterval: 3` from coexisting.

### Notes

- **Android**: `RepeatFrequency.MONTHLY` is supported with AlarmManager. It is not supported with `alarmManager: false`, because WorkManager uses duration-based intervals and does not provide calendar-month recurrence semantics.
- **iOS**: custom repeat intervals cannot be extended indefinitely while the app remains killed/suspended and the user never interacts with notifications, because iOS does not wake the app merely when a local notification is delivered.

## [10.1.0] - 2026-04-17

### Added

- **Android**: `ResourceUtils.getFallbackSmallIconId(Context)` — new public static helper that returns a resource ID guaranteed to be valid for a smallIcon. Three-layer fallback: `applicationInfo.icon` → `applicationInfo.logo` → `android.R.drawable.ic_dialog_info`. Never returns `0`, never throws, catches any exception and falls through to the system default. Reusable from any code path that needs an emergency icon.

- **Tests**: `ResourceUtilsFallbackIconTest` — six Robolectric + Mockito unit tests covering each of the three fallback tiers, the exception-swallow branch, the null-context branch, and a "never returns 0" invariant guard across all five paths. `NotificationAndroidModelSmallIconFallbackTest` — three Robolectric unit tests covering the `getSmallIcon()` return contract when the `smallIcon` key is missing, unresolvable, or empty.

- **Tests**: `validateTrigger.test.ts` cases covering the three new small-timestamp error paths and a regression guard for the existing "must be in the future" message on valid-but-past epoch-ms values.

- **Tests**: new instrumented `RebootRecoveryTest` case covering the non-repeating future TIMESTAMP happy path (trigger with `repeatFrequency: -1` and `timestamp > now` must survive a simulated reboot with its fire time preserved and the `AlarmManager` PendingIntent re-registered at the original timestamp). Complements existing coverage of past-stale non-repeating (within/beyond grace) and DAILY/WEEKLY repeating paths.

- **Docs**: new "Small icon not showing in Android release builds" subsection in the Troubleshooting section of both root `README.md` and `packages/react-native/README.md`, documenting the three common causes (asset only in `src/debug/res/`, R8 resource shrinking, naming mismatch) with recipes for each. New bullet in the "Behavior changes from upstream" section covering the fallback. New row in the "Bugs Fixed from Upstream Notifee" table referencing upstream [invertase/notifee#733](https://github.com/invertase/notifee/issues/733).

- **Docs**: New README subsection under "Quick Start > Handle events" clarifying iOS event-handler routing — tap from foreground fires `onForegroundEvent`, tap from background/killed fires `onBackgroundEvent` (because iOS reports `UIApplication.applicationState == Inactive` at the moment of the tap delivery, not `Active`). Resolves the confusion reported in upstream [invertase/notifee#1155](https://github.com/invertase/notifee/issues/1155). New Troubleshooting subsection "Silent pushes and background fetch — handled by Firebase, not by this library" clarifying that the library does not hook `application:didReceiveRemoteNotification:fetchCompletionHandler:` and that silent-push JS execution in killed state is Firebase's responsibility, referencing upstream [invertase/notifee#597](https://github.com/invertase/notifee/issues/597). New callout at the top of `docs/fcm-mode.mdx` pointing users hitting upstream [invertase/notifee#1133](https://github.com/invertase/notifee/issues/1133) ("onBackgroundEvent not triggered on iOS for remote notifications") to FCM Mode as the end-to-end resolution. Added explicit iOS tap-routing note (foreground/background) to `docs/react-native/events.mdx`; added SEO cross-reference to upstream [invertase/notifee#1155](https://github.com/invertase/notifee/issues/1155) in the existing `docs/react-native/ios/interaction.mdx#foreground-vs-background-routing` section. Applied identically to root `README.md` and `packages/react-native/README.md`. Motivation: upstream repo archived April 7, 2026; README/npm/docs-site SEO is now the only discovery path for users still blocked by these upstream issues.

### Changed

- **Android**: **Behavior change** — when `android.smallIcon` does not resolve to a valid resource ID at runtime (asset only in `src/debug/res/`, R8 resource shrinking, naming mismatch), the library now falls back to the app's launcher icon instead of letting `NotificationCompat.Builder.build()` throw `IllegalArgumentException: Invalid notification (no valid small icon)`. The resolution failure is logged at level `w` (previously `d`, invisible in release logcat) with the original icon name, the three typical causes, and a pointer to the README Troubleshooting section. The log stays internal to logcat — `LogEvent` is not propagated to the JS layer (pre-existing architectural choice, unchanged here). Addresses the fragile code path behind upstream [invertase/notifee#733](https://github.com/invertase/notifee/issues/733).

- **Android**: removed spurious `BOOT_COMPLETED` intent-filter from `NotificationAlarmReceiver` in `AndroidManifest.xml`. The receiver does not handle boot — reboot recovery is owned exclusively by `RebootBroadcastReceiver` (already present and correct). The removed filter previously caused no-op wakeups on every device boot with a null-extras Intent that early-returned at `NotificationAlarmReceiver.java:43`. No behavior change for notification delivery.

- **TypeScript**: `validateTrigger` now produces targeted error messages when `trigger.timestamp` is suspiciously small (< 1e12 ms). Three cases are distinguished: day-of-month values (1–31) suggest `date.getDate()` usage, values in the 1e9–1e12 range suggest seconds since epoch instead of milliseconds, and other small values produce a generic "too small" message. All three messages recommend `Date.now()` or `date.getTime()`. Addresses upstream [invertase/notifee#872](https://github.com/invertase/notifee/issues/872). Previously these cases all emitted the generic "'trigger.timestamp' date must be in the future." which did not help users diagnose the root cause — a confusion between `.getDate()` / seconds / milliseconds.

- **Docs**: Linked upstream Notifee issues [#1079](https://github.com/invertase/notifee/issues/1079), [#1226](https://github.com/invertase/notifee/issues/1226), and [#1262](https://github.com/invertase/notifee/issues/1262) to the existing 9.2.0 architectural fix entry in the "Bugs Fixed from Upstream Notifee" table (previously marked `N/A (architectural)`). All three are the same root cause — the pre-compiled AAR distributed via a bundled Maven repo at `node_modules/@notifee/react-native/android/libs/` — and are all resolved by the single-module compile-from-source architecture introduced in 9.2.0. Added a new Troubleshooting subsection ``#### `Could not resolve app.notifee:core:+` — does not apply to this fork`` to capture direct Google searches for the error string. Applied identically to the root `README.md` and `packages/react-native/README.md`. Motivation: the upstream repo was archived on April 7, 2026 and issue commenting is no longer possible, so README/npm SEO is now the only discovery path for users still blocked by these issues.

- **Docs**: Added two rows to the "Bugs Fixed from Upstream Notifee" table in both `README.md` and `packages/react-native/README.md` linking upstream issues [invertase/notifee#601](https://github.com/invertase/notifee/issues/601), [#1063](https://github.com/invertase/notifee/issues/1063), and [#991](https://github.com/invertase/notifee/issues/991) to the fork releases that resolved them (9.1.12 + 9.1.14 + 9.5.0 + 9.6.0 cumulative). Updated the "33 upstream bugs fixed" header counter to 35. Motivation: the upstream repo was archived on April 7, 2026, so README/npm SEO is now the only discovery path for users googling these issues.

## [10.0.0] - 2026-04-17

### Added

- **CLI bin wiring**: `npx react-native-notify-kit init-nse` now works out-of-the-box after `npm install react-native-notify-kit`. CLI is prepacked into the main package at publish time. CLI deps (`xcode`, `commander`, `chalk`, `plist`) ship as `optionalDependencies`. E2E tarball regression script validates the full consumer flow. Issue #129, Phase 4 of 4.

- **CLI `init-nse`**: `npx react-native-notify-kit init-nse` scaffolds an iOS Notification Service Extension target, patching `.pbxproj` and Podfile automatically. Generates Swift + `NotifyKitNSE` target using `NotifeeExtensionHelper` for push enrichment. Supports `--dry-run`, `--force`, `--target-name`, `--ios-path` options. Atomic writes with backup/restore on failure. Issue #129, Phase 3 of 4.

- **Client FCM handler**: `notifee.handleFcmMessage(remoteMessage)` — one-liner client handler for FCM messages with `notifee_options` payloads. Parses the server SDK's serialized blob, reconstructs a `Notification` object, and dispatches per platform: Android always displays (data-only), iOS foreground displays, iOS background/killed is a no-op (NSE handles it). Fallback path for non-NotifyKit payloads configurable via `setFcmConfig`. Issue #129, Phase 2 of 4.

- **Client FCM config**: `notifee.setFcmConfig(config)` — optional startup configuration for `handleFcmMessage`. Covers: `defaultChannelId`, `defaultPressAction`, `fallbackBehavior` (`'display'` or `'ignore'`), and `ios.suppressForegroundBanner`.

- **Server SDK**: new `react-native-notify-kit/server` subpath export. A zero-runtime-dependency Node.js / Firebase Cloud Functions helper that builds FCM HTTP v1 message payloads ready for `admin.messaging().send()`. Android messages are emitted data-only so the FCM SDK never auto-displays; iOS messages use alert-style APNs with `mutable-content: 1` so the Notification Service Extension always activates. Both platforms carry an identical `notifee_options` blob (`_v: 1`) that the upcoming Phase 2 client handler will consume. Issue #129, Phase 1 of 4.

  Public API: `buildNotifyKitPayload`, `buildIosApnsPayload`, `buildAndroidPayload`, `serializeNotifeeOptions`, and all `NotifyKit*` types. Shared wire-contract types live in [packages/react-native/src/internal/fcmContract.d.ts](packages/react-native/src/internal/fcmContract.d.ts) — an internal, non-public path that both the server SDK and the future client handler import from to stay in lock-step.

  Validation rejects: zero or multiple routing fields (`token` / `topic` / `condition`), non-string values in `notification.data`, the reserved keys `notifee_options` / `notifee_data` in user data, empty-string `notification.id`, non-integer or non-positive `options.ttl`, and non-https iOS attachment URLs. A `console.warn` fires when the serialized payload exceeds ~3500 UTF-8 bytes (measured with `Buffer.byteLength`, not JS code units, to correctly account for emoji / CJK content).

- **Tests**: Jest tests for the server SDK with 100% statement / branch / line / function coverage across `buildPayload.ts`, `ios.ts`, `android.ts`, `serialize.ts`, `validation.ts`. Includes a kitchen-sink snapshot asserting the canonical FCM v1 wire shape.

- **Docs**: New [docs/fcm-mode.mdx](docs/fcm-mode.mdx) — comprehensive FCM Mode guide covering architecture, server SDK reference, client API reference, iOS NSE setup, Android specifics, payload schema, migration from manual pattern, troubleshooting, and known limitations. Root README and `packages/react-native/README.md` updated with FCM Mode quick-start, Server SDK, CLI Tools, and Automated NSE setup sections. `packages/react-native/server/README.md` expanded with full API reference. `apps/smoke/NOTIFICATION_SERVICE_EXTENSION.md` updated with a CLI-recommendation header. Issue #129, Phase 5 of 5.

### Fixed

- **Client**: `handleFcmMessage` no longer throws an unhandled rejection when an iOS attachment in `notifee_options` has a missing or empty `url`. Invalid attachments are now filtered out with a `console.warn` instead of propagating to the validator.
- **Client**: `reconstructNotification` now emits a `console.warn` when a recognized Android style type (`BIG_TEXT` / `BIG_PICTURE`) is present but the required sub-field (`text` / `picture`) is missing. Previously the style was silently dropped with no diagnostic signal.
- **Client**: `setFcmConfig` and `handleFcmMessage` now deep-copy the nested `ios` sub-object, preventing caller mutation from leaking into stored config.
- **CLI**: `patchPodfile` now throws an error (triggering rollback) when it cannot locate the main app target's closing `end`, instead of silently appending the NSE block at file-end which would produce an invalid Podfile.
- **CLI**: `--bundle-suffix` is now validated against `/^\.[A-Za-z0-9\-.]+$/` to prevent pbxproj corruption from special characters.
- **CLI**: `readParentTarget` now scopes the bundle ID search to the app target's own `buildConfigurationList` instead of scanning all build configurations globally. Prevents returning a test target's bundle ID in multi-target projects.
- **CLI**: `opts.dryRun` is now forwarded to `patchPodfile` and `patchXcodeProject` calls instead of being hardcoded to `false`.
- **CLI**: `deriveBundleId` now expands `$(PRODUCT_NAME)` / `$(TARGET_NAME)` variables in the parent bundle ID using the detected target name, instead of passing the unresolved variable through to the NSE bundle ID. A warning is still logged when the parent bundle ID uses unresolved variables the CLI cannot expand (e.g. `$(PRODUCT_BUNDLE_PREFIX)`), so the user can fix the NSE bundle ID manually in Xcode.
- **CLI**: `patchXcodeProject` now strips the RNFB-style `INFOPLIST_FILE` input path from the host target's build settings after adding the NSE target, avoiding an Xcode host-extension build cycle that prevented incremental builds.
- **CLI**: Swift NSE template now uses the correct `with:` Objective-C selector label (was `withContent:`) when calling `NotifeeExtensionHelper.populateNotificationContent`, matching the ObjC method signature exposed via `NS_SWIFT_NAME`.
- **iOS**: `RNNotifeeCore.podspec` now declares `DEFINES_MODULE = YES` so the NSE target can `import RNNotifeeCore` as a Swift module without a bridging header.

### Changed

- **Package exports**: [packages/react-native/package.json](packages/react-native/package.json) now declares a formal `exports` map (previously absent). Public entries: `.`, `./server`, `./jest-mock`, `./react-native.config.js`, `./package.json`. For backward compatibility with any consumer that was importing internal paths before 10.0.0, `./src/*` and `./dist/*` are also exposed — **these are deprecated and will be removed in a future major**. Migrate to the public exports (`react-native-notify-kit` for the client, `react-native-notify-kit/server` for the server SDK).

- **NSE template**: Generated `NotificationService.swift` now emits `[NotifyKitNSE]` NSLog diagnostics on `didReceive`, `contentHandler`, and `serviceExtensionTimeWillExpire` paths. Visible in Console.app by filtering on the `NotifyKitNSE` process, making it easier to diagnose missing attachments, missing `notifee_options`, or `serviceExtensionTimeWillExpire` termination on slow networks.

## [9.7.0] - 2026-04-15

### Added

- **Android**: `getDisplayedNotifications()` now exposes custom keys from `Notification.extras` as a top-level `data` field on the result, matching the iOS shape produced by `parseDataFromUserInfo:` in `NotifeeCoreUtil.m`. The non-Notifee branch (notifications not created via `displayNotification()`) iterates `extras.keySet()` and copies every key not matching a system-prefix denylist (`android.`, `notifee`, `gcm.`, `google.`, `fcm.`) or an exact-key denylist (`from`, `collapse_key`, `message_type`, `message_id`, `aps`, `fcm_options`) into a `data` sub-bundle. Values are coerced to `String` via `toString()`. The `data` bundle is always present (possibly empty) so JS consumers can access `notification.data.foo` without null-checking `data` itself.

  **Important platform limitation — read carefully before relying on this for FCM push notifications.** When the FCM Android SDK auto-displays a `notification`+`data` push while the app is in background or killed, custom `data` fields are routed exclusively to the tap-action `PendingIntent` and are never written to `Notification.extras`. This is FCM's original architectural design (verified against `firebase-android-sdk` source: `CommonNotificationBuilder.createContentIntent` builds the launch Intent with `intent.putExtras(params.paramsWithReservedKeysRemoved())` but never calls `builder.addExtras()` on the notification itself), not a Notifee or library limitation. The PendingIntent is opaque by Android security design — there is no public API to read its extras without firing it. As a result, this fix **cannot** make custom FCM data fields appear in `getDisplayedNotifications()` for the FCM auto-display path. Firebase issue [firebase-android-sdk#2639](https://github.com/firebase/firebase-android-sdk/issues/2639) (open since 2021, no resolution as of April 2026) tracks Google's awareness of this gap.

  **Scenarios where the fix does surface custom `data` on Android:**
  - Notifications created via `notifee.displayNotification({ data: {...} })` — round-trip through the existing Notifee-owned serialization path (this branch was already correct; the fix doesn't change it, but the JSDoc clarification documents the contract)
  - FCM data-only messages handled in `onMessageReceived` where the app calls `notifee.displayNotification()` itself with the data payload
  - Notifications posted by other libraries via `NotificationCompat.Builder.addExtras(bundle)` (rare in React Native apps but supported)
  - Custom `FirebaseMessagingService.handleIntent` overrides that inject extras into the notification before display (the workaround documented in the upstream issue's comments)

  **Recommended pattern for full control over FCM push notifications on Android**: send FCM data-only messages (no `notification` field server-side), handle them in `onMessageReceived` or a headless task, and call `notifee.displayNotification()` to render the notification with full control over `data`, channel, styling, and tap behavior. This is also Firebase's official recommendation per the [2018 FCM blog post by Jingyu Shi](https://firebase.blog/posts/2018/09/handle-fcm-messages-on-android/) and the current [FCM message types documentation](https://firebase.google.com/docs/cloud-messaging/concept-options).

  Reserved top-level keys filtered from `data` (any value matching these is dropped): prefixes `android.`, `google.`, `gcm.`, `fcm.` (with trailing dot — `fcmRegion`, `googleish`, etc. survive), `notifee` (no trailing dot — the library's reserved namespace, `notifeeFoo` is also filtered), plus exact keys `from`, `collapse_key`, `message_type`, `message_id`, `aps`, `fcm_options`. The `fcm_options` exact-match achieves parity with iOS on the Firebase analytics-label key while preserving realistic custom keys. Cross-platform divergence: bare-`fcm` keys other than `fcm_options` (e.g. `fcmRegion`, `fcmToken`) are preserved on Android but filtered on iOS — rename server-side if you need strict parity. (upstream: [invertase/notifee#393](https://github.com/invertase/notifee/issues/393))

- **Tests**: `GetDisplayedNotificationsDataTest` — 17 Robolectric unit tests covering the `shouldIncludeInData` denylist filter and the `extractDataFromExtras` bundle-to-bundle helper, including edge cases for prefix precision (`androidify`, `googleish`, `fcmlike`), non-String value coercion via `toString()`, empty-extras stability, and the `fcm_options` exact-match parity.

## [9.6.0] - 2026-04-15

### Fixed

- **Android**: Fixed `ObjectAlreadyConsumedException: Map already consumed` crash in `HeadlessTask.TaskConfig` when the same `WritableMap` instance is reused across headless events or when the `taskConfig` accessor is read more than once. Root cause: `TaskConfig.init` mutated the caller's `WritableMap` directly with `putInt("taskId", ...)` without copying it first. `WritableNativeMap` is a consume-once JNI object; once React Native internally called `.copy()` on it inside `HeadlessJsTaskConfig`, any further access crashed. Latent in most apps (single events with fresh maps), but observed in production by upstream users with high-frequency headless events. The fix copies the map before mutating, matching upstream `@notifee/react-native@9.1.8`. Also eliminates a silent side-effect where the caller's map was polluted with the injected `taskId` key. (upstream: [invertase/notifee#266](https://github.com/invertase/notifee/issues/266))

- **Android**: `RebootBroadcastReceiver`, `NotificationAlarmReceiver`, and `AlarmPermissionBroadcastReceiver` now wrap their synchronous section in a try/catch/finally guard, ensuring `PendingResult.finish()` is always called even when `ContextHolder` init, `NotifeeAlarmManager` instantiation, or `displayScheduledNotification` throws before the async callback is registered. Previously, a synchronous failure would leave the broadcast unterminated and Android would kill the process after ~10s, potentially racing future reboot broadcasts and alarm deliveries. (upstream: [invertase/notifee#734](https://github.com/invertase/notifee/issues/734))

- **Android**: Stale non-repeating trigger notifications (timestamp already in the past at reboot-recovery time) are now handled correctly instead of being re-armed as "zombie" alarms that re-fire on every reboot and never clean up from Room. Within a 24-hour grace period, the trigger fires once (matching Android's own past-alarm semantics and user expectation) and the Room row is deleted. Beyond the grace period, the row is deleted silently to avoid showing stale content. `INTERVAL`-type triggers are still not rescheduled on reboot — that is a separate, pre-existing bug with its own TODO in `NotifeeAlarmManager.rescheduleNotification` and is explicitly out of scope for this fix. (upstream: [invertase/notifee#734](https://github.com/invertase/notifee/issues/734))

### Added

- **Android**: Cold-start self-healing for scheduled alarms on OEM devices that suppress `BOOT_COMPLETED` (Xiaomi MIUI, Oppo ColorOS, Huawei EMUI, Vivo FuntouchOS). `InitProvider` now reads `Settings.Global.BOOT_COUNT` on every app init and, when a boot delta is detected since the last known value persisted in `SharedPreferences`, triggers a full reschedule of persisted `AlarmManager` triggers on a background thread. When `BOOT_COUNT` is unavailable (custom ROMs, emulators, exotic vendors), falls back to a conservative reschedule on every app start; transient read failures never overwrite a real baseline. Paired with a process-wide `AtomicBoolean` race guard in `NotifeeAlarmManager.rescheduleNotifications` that prevents double-advancement of past-repeating triggers when both `RebootBroadcastReceiver` and the cold-start path race after a normal `BOOT_COMPLETED` delivery. Defense-in-depth note: during Step 6 smoke testing on a Pixel 9 Pro XL we observed Android re-delivering `BOOT_COMPLETED` to the smoke app the first time the package was launched after a `force-stop` (no real reboot), which means the reboot receiver and the cold-start path fire concurrently in practice — exactly the scenario the `AtomicBoolean` is designed for, and the second path logs `Reschedule already in progress, skipping duplicate request` and exits cleanly. On an OEM device that suppresses `BOOT_COMPLETED` outright, only the cold-start path runs; either way the zombie re-fire loop is broken. (upstream: [invertase/notifee#734](https://github.com/invertase/notifee/issues/734))

- **Android**: Regression tests for DAILY/WEEKLY/HOURLY trigger rescheduling cycle, including DST spring-forward and fall-back edge cases (upstream: [invertase/notifee#839](https://github.com/invertase/notifee/issues/839), [#875](https://github.com/invertase/notifee/issues/875)).

- **Tests**: `InitProviderBootCheckTest` — 6 Robolectric unit tests exhaustively covering the pure `shouldRescheduleAfterBoot` decision helper (first run, same boot, new boot, boot-count decrease, BOOT_COUNT unavailable on subsequent run, BOOT_COUNT unavailable on first run). `NotifeeAlarmManagerHandleStaleTest` — 3 Robolectric + Mockito unit tests covering the resilient display → delete chain in `handleStaleNonRepeatingTrigger`: an `Exception` from `displayNotification` is caught and the Room row is still deleted, an `Error` (e.g. `OutOfMemoryError`) is propagated as `ExecutionException` and the row is preserved for a real retry, and a synchronous throw from `NotificationManager.displayNotification` is intercepted via `Futures.submitAsync` so the row is still deleted via the resilience branch. `RebootRecoveryTest` extended with three new instrumented cases: stale non-repeating row within the 24-hour grace period (fire-once-then-delete), stale non-repeating row beyond the grace period (delete-silent), and a deliberately malformed bundle triggering the resilience branch so the row is still deleted when the late-fire fails.

- **Tooling**: `scripts/smoke-test-734.sh` and `scripts/smoke-test-734-scenarios.md` — composable manual smoke-test harness for #734. Subcommands cover build, Room DB dump, `Settings.Global.BOOT_COUNT` read, notifee `SharedPreferences` dump, filtered logcat capture, device reboot, state wipe, and running the destructive `RebootRecoveryTest` instrumented suite. Destructive subcommands require an explicit `--i-know` flag. Five scenarios are documented with expected logcat fingerprints and fail-mode triage.

- **Docs**: New "OEM Background Restrictions" section in `README.md` and `packages/react-native/README.md` documenting the interaction between vendor autostart policies and scheduled notifications, and how to use the existing `getPowerManagerInfo()` / `openPowerManagerSettings()` APIs to guide users through vendor-specific settings screens.

- **Docs**: Expanded "Foreground Service Setup (Android 14+)" section in `README.md` and `packages/react-native/README.md` with (1) a use-case → `foregroundServiceType` matrix with Doze exemption, type timeout, and Google Play policy caveats for each type, (2) a callout that `mediaPlayback` requires active audio playback per Play Store policy and must not be declared on silent timers, (3) a new "Android 15+ additional FGS restrictions" subsection covering the `dataSync` 6-hour-per-24h cumulative cap, the new `mediaProcessing` type, the `specialUse` `<property>` justification requirement, and the `onTimeout(int, int)` API 35+ overload, (4) clarification in "OEM Background Restrictions" that Samsung OneUI, Xiaomi MIUI, Huawei EMUI, Oppo ColorOS, and Vivo FuntouchOS aggressive-kill policies affect **both** scheduled triggers and running foreground services — `openPowerManagerSettings()` is now documented as the mitigation for both reliability problems, and (5) a new "Timers: foreground service or `SET_ALARM_CLOCK`?" decision guide recommending the `SET_ALARM_CLOCK` trigger (not a custom FGS) for silent rest, cooking, and recovery timer use cases, with an explicit note that the library does not acquire a wake lock on the FGS path so the CPU can still suspend with the screen off on non-Doze-exempt foreground service types. Addresses upstream [invertase/notifee#410](https://github.com/invertase/notifee/issues/410).

- **Docs**: New "AlarmType guide" subsection in `README.md` and `packages/react-native/README.md` (under "Trigger Notification Reliability") documenting all five `AlarmType` options — including `AlarmType.SET_ALARM_CLOCK`, which was already wired end-to-end in the TypeScript enum, validator, and `NotifeeAlarmManager` Java switch but was previously undiscoverable. `SET_ALARM_CLOCK` is the strongest reliability guarantee Android exposes for a scheduled notification: it renders the alarm-clock icon in the status bar, uses the same primitive as the stock Clock app, and is the least susceptible to OEM aggressive-kill power management policies (Xiaomi MIUI, Oppo ColorOS, Huawei EMUI, Vivo FuntouchOS) — the same class of reliability problem tracked in [invertase/notifee#734](https://github.com/invertase/notifee/issues/734). Recommended for time-sensitive reminders, recovery timers, rest timers, and similar use cases where a missed notification is user-visible damage. (upstream: [invertase/notifee#655](https://github.com/invertase/notifee/issues/655), merged via [#749](https://github.com/invertase/notifee/pull/749))

## [9.5.0] - 2026-04-14

### Fixed

- **Android**: Resolved upstream issue [invertase/notifee#549](https://github.com/invertase/notifee/issues/549) — `cancelTriggerNotifications()` and `createTriggerNotification()` JS Promises resolved before the underlying Room database write completed, causing a race where a cancel-then-create pattern could leave inconsistent state. Root cause: `WorkDataRepository.insert` / `deleteAll` / `deleteById` / `deleteByIds` / `update` were fire-and-forget `void` methods that returned immediately while the actual DAO call was still enqueued on a cached thread pool. All five mutation methods now return `ListenableFuture<Void>` and are chained into the outer future at every call site. Empirical reproduction rate on a Pixel 9 Pro XL before the fix: ~3.3% per attempt, <50ms window (Scenario B/C of `repro-549-findings.md`). Post-fix: 0 inconsistencies across 150 attempts in `post-fix-549-verification.md`.

- **Android**: Fixed a reboot-recovery data-loss bug not mentioned in upstream #549 (surfaced by the read-only caller audit in `pre-fix-549-audit.md`, Caller #8). `NotifeeAlarmManager.rescheduleNotification` — invoked from `RebootBroadcastReceiver` on `BOOT_COMPLETED` — fire-and-forgot the `WorkDataRepository.update(...)` that persists the next-fire timestamp for each recurring alarm. If Android killed the receiver's process before Room drained, the updated anchors were lost and the next reboot rescheduled from stale timestamps, causing recurring notifications to fire at the wrong time or be duplicated. The receiver now collects all per-entity update futures, combines them with `Futures.allAsList`, waits with an 8-second `Futures.withTimeout` ANR safety net, and only then calls `pendingResult.finish()`.

- **Android**: Fixed an ordering bug in `NotificationManager.doScheduledWork` where `completer.set(Result.success())` was called before the one-time trigger row was deleted from Room. WorkManager considered the work complete while the row was still pending deletion, leaving a window where a concurrent cancelAll/read could see the zombie row, and where reboot recovery could resurrect a one-shot that had already fired. After the fix, the delete future completes first, then the Worker reports success.

- **Android**: `NotifeeAlarmManager.displayScheduledNotification` now awaits the Room update (for recurring alarms) or delete (for one-shots) before calling `BroadcastReceiver.PendingResult.finish()`. Previously the writes raced against process death inside the receiver's `goAsync()` scope. Uses the same 8-second `Futures.withTimeout` safety net as the reboot-recovery fix to guarantee the receiver always finishes even if Room is wedged.

- **Android**: `WorkDataRepository.insertTriggerNotification(...)` static helper cleanup — now takes an explicit `Context` parameter and calls `getInstance(context)` instead of the implicit `mInstance` field, removing a fragile dependency on `NotifeeInitProvider` having populated the singleton before the first trigger creation.

### Changed

- **Android**: **BEHAVIOR CHANGE** — errors from `WorkDataRepository` mutations (e.g., `SQLiteFullException` from a disk-full device, SQLite corruption, schema migration failures) now propagate as rejections on the JS Promises for `cancelTriggerNotifications`, `cancelTriggerNotification`, `createTriggerNotification`, and `cancelAllNotifications(ids)`. Previously these exceptions were silently swallowed by the fire-and-forget executor, and the JS Promise resolved successfully even when the write had failed. Apps that relied on these methods "always succeeding" may now need to add error handling. This is strictly a correctness improvement — silent write failures were never safe — but it is user-observable, which is why 9.5.0 is a minor version bump.

- **Android**: **LATENCY CHANGE** — `cancelTriggerNotifications()` and `createTriggerNotification()` Promises now resolve only after the Room write has completed. On a warm database this adds roughly 5–15ms to the perceived latency on a Pixel 9 Pro XL. Apps that schedule many triggers in a tight loop may notice cumulative latency increases. A future release may add a batch API that opens a single Room transaction if this becomes a bottleneck for real apps.

### Added

- **Android**: `WorkDataRepositoryFutureContractTest` — JVM unit test (Mockito + `CountDownLatch`) verifying all five mutation methods return non-null futures that only complete after the underlying DAO call has returned, and that DAO exceptions propagate through `ExecutionException`. 13 tests. Runs in the existing `tests_junit.yml` CI workflow.

- **Android**: `WorkDataRepositoryRaceTest` — instrumented test under `androidTest/` exercising a real Room in-memory database with 100-iteration race scenarios (post-cancel consistency, post-create persistence, delete-by-id visibility, update visibility, concurrent stress). **NOT wired into CI yet** — tracked in a follow-up issue linked from the PR description. Must be run manually via `./gradlew :react-native-notify-kit:connectedDebugAndroidTest` on a connected device before merging any change that touches the Room persistence layer.

- **Tooling**: `scripts/verify-549-fix.sh` — automated 5-run harness verification script. Sed-patches `VERIFY_549_AUTO_RUN` in `apps/smoke/App.tsx`, force-stops and relaunches the smoke app five times, parses the per-scenario `RACE549:` logcat summaries, aggregates across 100 (Scenario A) and 150 (Scenarios B & C) attempts, and writes `post-fix-549-verification.md` with a strict PASS/FAIL verdict. Exit code 0 on PASS, 1 on FAIL — wire into a pre-push hook or future CI emulator job.

- **Tooling**: `TriggerRaceTestScreen.tsx` harness (originally added during the investigation phase and committed here alongside the script changes) now emits one compact JSON line per scenario plus a `-DONE` terminator, so `verify-549-fix.sh` can parse each scenario independently without hitting logcat's per-line size limit.

## [9.4.0] - 2026-04-10

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
