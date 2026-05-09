# NotifyKit Expo Smoke

Manual Expo CNG fixture for validating `react-native-notify-kit` package resolution, Expo config, prebuild, development builds, and the basic local notification runtime path.

This app is intentionally separate from `apps/smoke`, which remains the full React Native bare smoke app. This fixture is for Expo CNG, prebuild, and development builds; it is not intended for Expo Go.

## Scope

- Expo SDK 55 development build flow.
- Local workspace dependency: `react-native-notify-kit: workspace:*`.
- Manual runtime checks for `getNotificationSettings`, `requestPermission`, Android channel creation/readback, `displayNotification`, `getDisplayedNotifications`, foreground `DELIVERED`/`PRESS`, `cancelNotification`, and `cancelAllNotifications`.
- Config plugin resolution with iOS Notification Service Extension config validation and EAS `appExtensions` metadata.
- Opt-in iOS and Android FCM runtime checks with RNFirebase, local Firebase config files, token capture, foreground FCM handling, background message handling, and tap marker validation.
- No deep links, callback HTTP server, trigger stress, exact alarms, reboot recovery, Android killed-state guarantee, or advanced Android action suite.

## Commands

Run from the repository root:

```sh
yarn smoke:expo:config
yarn smoke:expo:prebuild:ios
yarn smoke:expo:prebuild:android
yarn smoke:expo:start
```

Run app-local commands from this workspace when needed:

```sh
yarn workspace react-native-notify-kit-expo-smoke config
yarn workspace react-native-notify-kit-expo-smoke prebuild:ios
yarn workspace react-native-notify-kit-expo-smoke prebuild:android
yarn workspace react-native-notify-kit-expo-smoke start
```

The generated `ios/`, `android/`, and `.expo/` directories are ignored because this fixture follows Expo Continuous Native Generation. The source of truth is `app.config.ts` plus the JS/TS files in this directory.

## Opt-In FCM Runtime

FCM runtime is not required for the base Expo smoke. Enable it only for Firebase-backed development build testing with:

```sh
EXPO_PUBLIC_NOTIFYKIT_EXPO_SMOKE_FCM=1
```

Place the local Firebase config files at:

```txt
apps/expo-smoke/firebase/GoogleService-Info.plist
apps/expo-smoke/firebase/google-services.json
```

Both files are required when the FCM gate is enabled because the Expo config is shared by iOS and Android prebuild paths. They are ignored and must not be committed. `firebase-notifykittest.json`, service accounts, `.env.local`, and FCM tokens must also stay local.

The Android app registered in Firebase must use this package name:

```txt
com.notifykit.exposmoke
```

Firebase and RNFirebase setup are fixture and consumer responsibilities. The NotifyKit Expo config plugin does not install Firebase, copy `google-services.json`, or patch Gradle for Firebase.

Run the FCM iOS flow from the repository root:

```sh
EXPO_PUBLIC_NOTIFYKIT_EXPO_SMOKE_FCM=1 yarn smoke:expo:config
EXPO_PUBLIC_NOTIFYKIT_EXPO_SMOKE_FCM=1 yarn smoke:expo:prebuild:ios
(cd apps/expo-smoke && EXPO_PUBLIC_NOTIFYKIT_EXPO_SMOKE_FCM=1 npx expo run:ios --device)
```

Start the dev client, press `Request permission`, then press `Register FCM`. Copy the token from the `SMOKE:FCM_TOKEN` log line.

Send test payloads from the repository root:

```sh
yarn build:rn:server
IOS_FCM_TOKEN=<token> yarn send:test:fcm minimal
IOS_FCM_TOKEN=<token> yarn send:test:fcm ios-attachment
```

For visible iOS background tap validation, background the app, send a visible FCM payload, tap the delivered notification, and confirm `SMOKE:BACKGROUND_EVENT_PRESS`. The validated smoke run correlated the tap through the notification id.

Run the FCM Android flow from the repository root:

```sh
EXPO_PUBLIC_NOTIFYKIT_EXPO_SMOKE_FCM=1 yarn smoke:expo:config
EXPO_PUBLIC_NOTIFYKIT_EXPO_SMOKE_FCM=1 yarn smoke:expo:prebuild:android
(cd apps/expo-smoke && EXPO_PUBLIC_NOTIFYKIT_EXPO_SMOKE_FCM=1 npx expo run:android)
```

Start the dev client, press `Request permission`, then press `Register FCM`. Copy the token from the `SMOKE:FCM_TOKEN` log line. On Android 13 and newer, notification permission must be granted before display can be verified.

Send the Android data-only smoke payload from the repository root:

```sh
yarn build:rn:server
ANDROID_FCM_TOKEN=<token> yarn send:test:fcm android-expo-smoke
```

Foreground Android checks:

- Keep the app open.
- Send `android-expo-smoke`.
- Confirm `SMOKE:FCM_ON_MESSAGE`, `SMOKE:FCM_ANDROID_CHANNEL_READY`, `SMOKE:FCM_FOREGROUND_HANDLE_OK`, and `SMOKE:FOREGROUND_EVENT_DELIVERED`.
- Confirm a notification is shown through `notifee.handleFcmMessage(remoteMessage)`.
- Optional tap check: tap the foreground notification and confirm `SMOKE:FOREGROUND_EVENT_PRESS`.

Background Android checks:

- Open the app once, register FCM, then send it to the background.
- Send `android-expo-smoke`, which uses Android data-only and high priority.
- Confirm `SMOKE:FCM_BACKGROUND_MESSAGE`, `SMOKE:FCM_ANDROID_CHANNEL_READY`, and `SMOKE:FCM_BACKGROUND_HANDLE_OK`.
- Confirm the notification is visible.
- Tap the notification and confirm the app opens, the notification is removed, and `SMOKE:BACKGROUND_EVENT_PRESS` includes the expected `correlationId` and `pressActionId=default`.

Killed-state Android is best-effort only. A normally killed process can be tested after the app has been launched at least once, for example with `adb shell am kill`. `adb shell am force-stop` is not covered because Android and FCM do not guarantee wake from force-stop.

## Runtime Markers

The app writes short `SMOKE:*` markers to the Metro/device console and a readable summary to the on-screen log:

- `SMOKE:APP_STARTED`
- `SMOKE:NOTIFEE_IMPORTED`
- `SMOKE:SETTINGS_OK`
- `SMOKE:PERMISSION_OK`
- `SMOKE:CHANNEL_CREATED`
- `SMOKE:CHANNELS_COUNT`
- `SMOKE:DISPLAY_LOCAL_OK`
- `SMOKE:DISPLAYED_COUNT`
- `SMOKE:FOREGROUND_EVENT_DELIVERED`
- `SMOKE:FOREGROUND_EVENT_PRESS`
- `SMOKE:CANCEL_OK`
- `SMOKE:CANCEL_ALL_OK`
- `SMOKE:FCM_REGISTERED`
- `SMOKE:FCM_TOKEN`
- `SMOKE:FCM_ON_MESSAGE_REGISTERED`
- `SMOKE:FCM_BACKGROUND_HANDLER_REGISTERED`
- `SMOKE:FCM_ANDROID_CHANNEL_READY`
- `SMOKE:FCM_ON_MESSAGE`
- `SMOKE:FCM_HANDLE_OK`
- `SMOKE:FCM_FOREGROUND_HANDLE_OK`
- `SMOKE:FCM_FOREGROUND_HANDLE_ERROR`
- `SMOKE:FCM_BACKGROUND_MESSAGE`
- `SMOKE:FCM_BACKGROUND_HANDLE_OK`
- `SMOKE:FCM_BACKGROUND_HANDLE_ERROR`
- `SMOKE:FCM_TOKEN_REFRESH`
- `SMOKE:INITIAL_NOTIFICATION_PRESS`
- `SMOKE:BACKGROUND_EVENT_PRESS`
- `SMOKE:FCM_ERROR`
- `SMOKE:ERROR`

The 10.4.0 temporary Android `shortService` runtime gate also used these markers:

- `SMOKE:FGS_SHORT_DISPLAY_OK`
- `SMOKE:FGS_SHORT_STOP_OK`
- `SMOKE:FGS_SHORT_CANCEL_OK`

## Manual iOS Check

1. Run `yarn smoke:expo:prebuild:ios`.
2. Start the development client with `yarn smoke:expo:start`, then open the app in the iOS development build.
3. Confirm `SMOKE:APP_STARTED` and `SMOKE:NOTIFEE_IMPORTED` appear.
4. Press `Get notification settings`, `Request permission`, `Display local notification`, `Get displayed notifications`, `Cancel last notification`, and `Cancel all notifications`.
5. Confirm the on-screen log shows concise results and Metro/device logs contain the expected `SMOKE:*` markers.

## Manual Android Check

Android smoke base verifies runtime package resolution, autolinking, Android channels, and local notifications. FCM checks are opt-in through the FCM runtime flow above.

1. Run `yarn smoke:expo:prebuild:android`.
2. From `apps/expo-smoke`, run `npx expo run:android` against an emulator or device.
3. Start Metro with `yarn smoke:expo:start` if the run command does not start it.
4. Confirm startup markers, then press `Ensure Android channel`, `Display local notification`, `Get displayed notifications`, `Cancel last notification`, and `Cancel all notifications`.
5. Confirm `SMOKE:CHANNEL_CREATED`, `SMOKE:CHANNELS_COUNT`, `SMOKE:DISPLAY_LOCAL_OK`, `SMOKE:DISPLAYED_COUNT`, and cancel markers appear in logs.
