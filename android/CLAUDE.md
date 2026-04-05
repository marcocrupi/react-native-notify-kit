# Android Native Core (NotifeeCore)

Standalone Android library (`app.notifee.core`) providing all notification functionality. Compiled to AAR and consumed by the React Native bridge.

## Package Organization

All classes in `src/main/java/app/notifee/core/`:

- **Entry point**: `Notifee.java` — Public singleton facade for all operations
- **Core managers**: `NotificationManager.java` (notification CRUD), `ChannelManager.java` (channels/groups, API 26+)
- **Scheduling**: `NotifeeAlarmManager.java` (AlarmManager-based), `Worker.java` (WorkManager integration)
- **Services**: `ForegroundService.java`, `ReceiverService.java`
- **Event system**: `EventBus.java` + `EventSubscriber.java` (greenrobot-based distribution)
- **Receivers**: Follow `*Receiver.java` / `*BroadcastReceiver.java` naming — `NotificationAlarmReceiver`, `RebootBroadcastReceiver`, `AlarmPermissionBroadcastReceiver`, `BlockStateBroadcastReceiver`
- **Intent handling**: `NotificationPendingIntent.java`, `NotificationReceiverActivity.java`, `NotificationReceiverHandler.java`
- **Infrastructure**: `Logger.java`, `Preferences.java` (SharedPreferences), `ContextHolder.java`, `InitProvider.java` (ContentProvider auto-init)
- **Sub-packages**: `database/` (Room persistence), `event/` (event models), `interfaces/` (callbacks), `model/` (data models), `utility/` (helpers)

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

- **compileSdk**: 35
- **minSdk**: 24
- **targetSdk**: 35
- **Java compatibility**: 17 (source + target)
- **JVM**: 17 or 21 required
- **AGP**: 8.7.0
- **Gradle**: 8.9

## Key Dependencies

| Library             | Version | Purpose                                         |
| ------------------- | ------- | ----------------------------------------------- |
| androidx.room       | 2.5.0   | SQLite database for trigger persistence         |
| greenrobot EventBus | 3.3.1   | Internal event distribution                     |
| androidx.work       | 2.8.0   | WorkManager for background trigger scheduling   |
| Fresco              | 2.6.0   | Image loading for large icons/big picture style |
| Guava               | 33.3.1  | ListenableFuture and utilities                  |
| JUnit               | 4.13.2  | Unit testing                                    |

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
