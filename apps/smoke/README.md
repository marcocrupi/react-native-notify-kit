# NotifyKit Bare Smoke

Bare React Native smoke app for `react-native-notify-kit`.

## Scope

- Current target: React Native 0.85.3 with React 19.2.3.
- Uses `@react-native/*` tooling and `@react-native/jest-preset` 0.85.3.
- Used to validate package resolution, autolinking, New Architecture startup, Android/iOS native builds, local notification basics, and selected runtime checks.
- Android fixture target: `compileSdk = 36`, `targetSdk = 36`, and Gradle wrapper 9.3.1 for the React Native 0.85.3 smoke app.
- This is not the Expo CNG fixture. Expo validation lives in `apps/expo-smoke`.

## Commands

Run from the repository root:

```sh
yarn smoke:start
yarn smoke:android
yarn smoke:ios
```

Run app-local commands from this workspace when needed:

```sh
yarn start
yarn android
yarn ios
```

## Notes

This README documents the fixture only. It is not a consumer installation guide and does not set universal Android SDK or Gradle requirements for apps installing the package.

## Physical iOS FCM qualification

The ordinary app and `scripts/smoke-ios-device-e2e.sh fcm-token` retain standard
RNFirebase integration. Finding a registration token does not qualify its APNs route.

Physical qualification uses a generated driver in an isolated `/tmp` copy:

```sh
# Default callback: a development-signed Release artifact stops before token acquisition.
node scripts/ios-fcm-qualification.js --configuration Release

# Explicit smoke-only correction for the signed APNs environment.
node scripts/ios-fcm-qualification.js --configuration Release \
  --apns-association signed-entitlement --scenario minimal

# Default RNFirebase callback with a Debug artifact.
node scripts/ios-fcm-qualification.js --configuration Debug --scenario minimal

node --test scripts/__tests__/*.test.js
```

`aps-environment` extracted from the **signed app** determines sandbox/production.
The qualifier also inspects the actual compiled RNFirebase callback. Missing or
unverifiable evidence stops the run. The opt-in correction disables swizzling in
the temporary app and controls the first APNs association through public APIs;
it then deletes the cached FCM token and requests a token after APNs readiness.

One minimal real T0 push must return an FCM message ID and produce matching device
delivery with installed NSE execution evidence before any requested scenario.
T0/configuration failures leave downstream scenarios `NOT_RUN` and return nonzero.
Reports retain token hashes/lengths/times and redacted diagnostics, never full tokens
or credentials. The qualifier removes its generated workspace and stops its drivers
and callback/log processes at closure.
After a device run it reinstalls the signed, unlaunched standard fixture preserved
before diagnostic generation, then removes both temporary artifacts. The restored
fixture uses standard RNFirebase wiring and carries no qualification authorization.
It also restores the fixture's configured auto-init setting through the public API;
the diagnostic setting is not left persisted on the device.

The device wrapper's `fcm-qualify`, `fcm-minimal`, `fcm-ios-attachment`, and F4 `send/all`
use this controller and the existing `send-test-fcm.js` sender. Set
`IOS_FCM_CONFIGURATION=Debug|Release` and, explicitly for the correction,
`IOS_FCM_APNS_ASSOCIATION=signed-entitlement`. Use `IOS_DEVICE_ID` and
`SMOKE_CALLBACK_HOST` when automatic selection is insufficient. NSE attachment
delivery readback does not establish visual attachment rendering.
These automated scenarios verify NSE content delivery with the main app stopped;
they do not certify foreground callbacks, interactions, or visual rendering.

The qualifier embeds its fresh diagnostic JS bundle for both configurations, so
runtime identity does not depend on a separately running Metro server. This affects
only the generated qualification driver; the normal fixture keeps its usual wiring.
