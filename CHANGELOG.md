# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **iOS**: Added `setNotificationConfig({ ios: { handleRemoteNotifications: false } })` opt-out flag to prevent Notifee from intercepting remote notification tap handlers — restores `onNotificationOpenedApp()` and `getInitialNotification()` for React Native Firebase Messaging (upstream: [invertase/notifee#912](https://github.com/invertase/notifee/issues/912))
- **iOS**: Fixed `completionHandler` not being called on notification dismiss path in `didReceiveNotificationResponse:`, preventing potential handler leaks
- **iOS**: Fixed `completionHandler` not being called in `willPresentNotification:` fallback path when no original delegate is available
- **iOS**: Added missing `return` after forwarding to `_originalDelegate` in `didReceiveNotificationResponse:` default path, preventing potential fall-through to `parseUNNotificationRequest`
