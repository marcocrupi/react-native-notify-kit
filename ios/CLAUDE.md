# iOS Native Core (NotifeeCore)

Standalone iOS library providing notification functionality. Distributed as source files copied into the React Native package during build.

## Source Structure

```
NotifeeCore/
├── NotifeeCore.h/.m                              # Main public interface and implementation
├── NotifeeCore+UNUserNotificationCenter.h/.m     # UNUserNotificationCenter delegate handling
├── NotifeeCore+NSNotificationCenter.h/.m         # App lifecycle event observation
├── NotifeeCore+NSURLSession.h/.m                 # HTTP downloads (notification attachments)
├── NotifeeCoreDelegateHolder.h/.m                # Delegate pattern for event forwarding
├── NotifeeCoreDownloadDelegate.h/.m              # NSURLSession download delegate
├── NotifeeCoreExtensionHelper.h/.m               # Notification Service Extension support
├── NotifeeCoreUtil.h/.m                          # Utility functions
└── Info.plist
```

## Architecture

### Category Pattern
iOS core uses Objective-C categories to organize `NotifeeCore` functionality:
- Base class: core notification CRUD operations
- `+UNUserNotificationCenter`: handles all UNUserNotificationCenterDelegate methods
- `+NSNotificationCenter`: observes UIApplication lifecycle notifications
- `+NSURLSession`: manages attachment downloads

### Callback Blocks
All async operations use typed blocks:
```objc
typedef void (^notifeeMethodVoidBlock)(NSError *_Nullable);
typedef void (^notifeeMethodNSDictionaryBlock)(NSError *_Nullable, NSDictionary *_Nullable);
typedef void (^notifeeMethodNSArrayBlock)(NSError *_Nullable, NSArray *_Nullable);
```

### Delegate Holder
`NotifeeCoreDelegateHolder` implements the delegate pattern to forward notification events from the core library to the consuming framework (React Native bridge or Flutter).

### Extension Helper
`NotifeeCoreExtensionHelper` provides functionality for Notification Service Extensions (modifying notifications before display, e.g., adding images).

## Build

```bash
# From repo root:
yarn build:core:ios     # Runs ./build_ios_core.sh - copies sources to packages/react-native/ios/

# For development with live sources (skip copy step):
# Set $NotifeeCoreFromSources=true in packages/react-native/RNNotifee.podspec
```

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
