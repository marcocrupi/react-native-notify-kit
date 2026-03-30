# react-native-notify-kit Package

Main NPM package published as `react-native-notify-kit` (v9.1.8).

## Source Organization

Core modules in `src/`:

- `NotifeeApiModule.ts` — Main API class, ALL public methods live here (singleton, exported as default)
- `NotifeeNativeModule.ts` — Base class handling native bridge communication
- `NotifeeNativeModule.web.ts` — Web stub (returns empty modules, no web functionality)
- `NotifeeJSEventEmitter.ts` — JS event emission wrapper
- `NotifeeNativeError.ts` — Custom error type for native errors
- `index.ts` — Public exports (re-exports types + default module)

Types in `src/types/` — 8 files following `Notification{Platform}.ts` naming:

- Core: `Notification.ts`, `Trigger.ts`, `Module.ts`, `Library.ts`
- Platform: `NotificationAndroid.ts`, `NotificationIOS.ts`, `NotificationWeb.ts`
- Android-specific: `PowerManagerInfo.ts` (for `getPowerManagerInfo()` / `openPowerManagerSettings()`)

Validators in `src/validators/` — 17 files + `iosCommunicationInfo/` subdirectory. Follow `validate{Platform}{Feature}.ts` naming convention. Each validates one domain concept before native bridge calls.

Utils in `src/utils/` — `validate.ts` (type guards), `id.ts` (ID generation), `index.ts` (platform constants + re-exports).

### Two `validate.ts` Files (important disambiguation)

- `src/utils/validate.ts` — Primitive type guards: `isNull`, `isObject`, `isString`, `isNumber`, `isBoolean`, `isArray`, `isFunction`, `isUndefined`
- `src/validators/validate.ts` — Domain validators: `isValidColor`, `isValidTimestamp`, `isValidVibratePattern`, `isValidEnum`, `isValidUrl`, `isAlphaNumericUnderscore`

## Build

```bash
yarn build          # genversion + tsc (generates version.ts then compiles)
yarn build:watch    # tsc --watch for development
yarn build:clean    # Removes dist/, android/libs/, android/build/, ios/build/
```

Output goes to `dist/` (configured in tsconfig.json). Entry point: `dist/index.js`.

## Key Patterns

### Module Export

`NotifeeApiModule` is instantiated as singleton and exported as default with static methods attached. Consumer usage: `import notifee from 'react-native-notify-kit'`.

### Validation Pattern

Every public method that accepts notification data MUST validate inputs before passing to native:

```typescript
// Pattern: validate -> transform -> call native
async displayNotification(notification: Notification): Promise<string> {
  const validated = validateNotification(notification);
  return this.native.displayNotification(validated);
}
```

### Error Messages

MUST include the property path in error messages:

```typescript
throw new Error("'notification.android.channelId' expected a string value.");
```

### Platform Branching

```typescript
import { Platform } from 'react-native';
const isAndroid = Platform.OS === 'android';
const isIOS = Platform.OS === 'ios';
```

## Native Bridge Code

### Android (`android/src/main/java/io/invertase/notifee/`)

6 Java files:

- `NotifeeApiModule.java` — React Native module (`@ReactMethod` annotations)
- `NotifeePackage.java` — Package registration
- `NotifeeInitProvider.java` — Auto-initialization via ContentProvider
- `NotifeeEventSubscriber.java` — Subscribes to core EventBus events
- `HeadlessTask.java` — Background JS execution
- `NotifeeReactUtils.java` — Conversion utilities

### iOS (`ios/RNNotifee/`)

- `NotifeeApiModule.m` — React Native module (`RCT_EXPORT_METHOD` macros)
- `NotifeeExtensionHelper.m` — Notification Service Extension support
