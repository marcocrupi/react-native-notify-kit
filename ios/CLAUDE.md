# iOS Native Core (NotifeeCore)

Standalone iOS library providing notification functionality. Distributed as source files copied into the React Native package during build.

## Source Organization

All files in `NotifeeCore/`:

- `NotifeeCore.h/.m` — Main public interface (notification CRUD, permissions, categories)
- Categories extend `NotifeeCore` using `NotifeeCore+FrameworkName` pattern:
  - `+UNUserNotificationCenter` — UNUserNotificationCenterDelegate handling
  - `+NSNotificationCenter` — App lifecycle event observation (UIApplication notifications)
  - `+NSURLSession` — HTTP downloads for notification attachments
- `NotifeeCoreDelegateHolder` — Delegate pattern for event forwarding to consuming framework (RN/Flutter)
- `NotifeeCoreDownloadDelegate` — NSURLSession download delegate
- `NotifeeCoreExtensionHelper` — Notification Service Extension support (modify notifications before display)
- `NotifeeCoreUtil` — Utility functions

## Architecture

### Callback Blocks

All async operations use typed blocks:

```objc
typedef void (^notifeeMethodVoidBlock)(NSError *_Nullable);
typedef void (^notifeeMethodNSDictionaryBlock)(NSError *_Nullable, NSDictionary *_Nullable);
typedef void (^notifeeMethodNSArrayBlock)(NSError *_Nullable, NSArray *_Nullable);
```

### Delegate Holder

`NotifeeCoreDelegateHolder` forwards notification events from the core library to the consuming framework. The RN bridge registers as delegate to receive events and forward them to JavaScript.

## Build

```bash
# From repo root:
yarn build:core:ios     # Runs ./build_ios_core.sh
```

`build_ios_core.sh` is a simple copy: deletes `packages/react-native/ios/NotifeeCore/` and copies fresh sources from `ios/NotifeeCore/`.

### CocoaPods Configuration

Two podspecs consume this code (in `packages/react-native/`):

- `RNNotifee.podspec` — Main pod (includes NotifeeCore as subspec by default)
- `RNNotifeeCore.podspec` — Extension-only pod for Notification Service Extension targets

Podfile flags (set in consuming app's Podfile):

- `$NotifeeCoreFromSources=true` — Link directly to `ios/NotifeeCore/` sources (bypasses copy step, use for development)
- `$NotifeeExtension=true` — Use `RNNotifeeCore` pod for Notification Service Extension support

## Configuration

- **Deployment Target**: iOS 10.0+
- **Language**: Objective-C
- **Distribution**: Source files via CocoaPods (static framework)

## Code Style

MUST use **clang-format** with Google style:

```bash
yarn format:core:ios        # Format all .h/.m/.mm/.cpp files
yarn format:core:ios:check  # Check formatting (CI)
```

## Naming Conventions

- Classes: `Notifee` prefix (NotifeeCore, NotifeeCoreUtil)
- Constants: `kReactNativeNotifee` prefix for event names
- Enums: `NS_ENUM` with `NotifeeCore` prefix (NotifeeCoreEventType, NotifeeCoreNotificationType)
- Categories: `NotifeeCore+FrameworkName` pattern
