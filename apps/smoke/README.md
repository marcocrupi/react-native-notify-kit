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
