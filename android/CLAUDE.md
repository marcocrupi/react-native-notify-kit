# Android Native Core (NotifeeCore)

Standalone Android library (`app.notifee.core`) providing all notification functionality. Compiled to AAR and consumed by the React Native bridge.

## Package Structure

```
src/main/java/app/notifee/core/
├── Notifee.java                    # Public facade (singleton entry point)
├── NotificationManager.java        # Core notification creation/display/cancel
├── ChannelManager.java             # Notification channel management (API 26+)
├── NotifeeAlarmManager.java        # AlarmManager-based scheduling
├── Worker.java                     # WorkManager integration for triggers
├── ForegroundService.java          # Foreground service implementation
├── EventBus.java                   # Internal event distribution (greenrobot)
├── EventSubscriber.java            # Event subscription interface
├── Logger.java                     # Logging facility
├── Preferences.java                # SharedPreferences wrapper
├── ContextHolder.java              # Application context holder
├── InitProvider.java               # ContentProvider for auto-initialization
├── ReceiverService.java            # Service for notification actions
├── NotificationPendingIntent.java  # PendingIntent construction
├── NotificationReceiverActivity.java # Activity for notification taps
├── NotificationReceiverHandler.java  # Handler for notification actions
├── NotificationAlarmReceiver.java  # BroadcastReceiver for alarms
├── RebootBroadcastReceiver.java    # Reschedule alarms after device reboot
├── AlarmPermissionBroadcastReceiver.java # Alarm permission handling
├── BlockStateBroadcastReceiver.java # Channel block state changes
├── database/                       # Room database for trigger persistence
├── event/                          # Event model classes
├── interfaces/                     # Callback interfaces
├── model/                          # Data models (NotifeeNotification, etc.)
└── utility/                        # Utility classes
```

## Build & Test

```bash
# From repo root:
yarn build:core:android             # assembleRelease + publish AAR to packages/react-native/android/libs/
yarn test:core:android              # ./gradlew testDebugUnit

# From android/ directory:
./gradlew assembleRelease           # Build release AAR
./gradlew testDebugUnit             # Run JUnit tests
./gradlew compileDebugJavaWithJavac # Compile check only
```

## Configuration

- **compileSdk**: 34
- **minSdk**: 20
- **targetSdk**: 33
- **Java compatibility**: 1.8 (source + target)
- **JVM**: 8, 11, 17, or 21 required

## Key Dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| androidx.room | 2.5.0 | SQLite database for trigger persistence |
| greenrobot EventBus | 3.3.1 | Internal event distribution |
| androidx.work | 2.8.0 | WorkManager for background trigger scheduling |
| Fresco | 2.6.0 | Image loading for large icons/big picture style |
| Guava | 33.3.1 | ListenableFuture and utilities |
| JUnit | 4.13.2 | Unit testing |

## Key Patterns

### Async Operations
All async work uses `ListenableFuture` from Guava/AndroidX concurrent:
```java
ListenableFuture<Void> displayNotification(Bundle notification, Bundle trigger) {
    return Futures.submit(() -> { ... }, executor);
}
```

### Event System
Uses greenrobot EventBus with annotation-based index (`app.notifee.core.EventBusIndex`):
```java
@Subscribe(threadMode = ThreadMode.MAIN)
public void onNotifeeEvent(MainComponentEvent event) { ... }
```

### Database (Room)
Trigger notifications are persisted in Room database. Schema exports go to `schemas/` directory for migration testing.

### ProGuard
ProGuard rules in `proguard-rules.pro` and consumer rules in `consumer-rules.pro`. Release builds are minified.

## Code Style

MUST use **google-java-format**. Format with:
```bash
yarn format:core:android        # Format all Java files
yarn format:core:android:check  # Check formatting (CI)
```
