# @notifee/react-native Package

Main NPM package published as `@notifee/react-native` (v9.1.8).

## Source Structure

```
src/
├── NotifeeApiModule.ts         # Main API class - ALL public methods live here
├── NotifeeNativeModule.ts      # Base class handling native bridge communication
├── NotifeeJSEventEmitter.ts    # JS event emission wrapper
├── NotifeeNativeError.ts       # Custom error type for native errors
├── index.ts                    # Public exports (re-exports types + default module)
├── types/                      # TypeScript interfaces and enums
│   ├── Notification.ts         # Core: Notification, Event, DisplayedNotification
│   ├── NotificationAndroid.ts  # Android-specific interfaces (channels, styles, actions)
│   ├── NotificationIOS.ts      # iOS-specific interfaces (attachments, categories)
│   ├── NotificationWeb.ts      # Web platform support
│   ├── Trigger.ts              # TimestampTrigger, IntervalTrigger, CronTrigger
│   ├── Module.ts               # Module type definitions
│   └── Library.ts              # Library-level types
├── validators/                 # Input validation (runs before native calls)
│   ├── validateNotification.ts
│   ├── validateAndroidNotification.ts
│   ├── validateIOSNotification.ts
│   ├── validateAndroidChannel.ts
│   ├── validateAndroidAction.ts
│   ├── validateAndroidStyle.ts
│   ├── validateIOSCategory.ts
│   └── validateTrigger.ts
└── utils/
    └── validate.ts             # Type guards: isString, isObject, isValidColor, etc.
```

## Build

```bash
yarn build          # genversion + tsc (generates version.ts then compiles)
yarn build:watch    # tsc --watch for development
yarn build:clean    # Removes dist/, android/libs/, android/build/, ios/build/
```

Output goes to `dist/` (configured in tsconfig.json). Entry point: `dist/index.js`.

## Key Patterns

### Module Export
`NotifeeApiModule` is instantiated as singleton and exported as default with static methods attached. Consumer usage: `import notifee from '@notifee/react-native'`.

### Validation Pattern
Every public method that accepts notification data MUST validate inputs before passing to native:
```typescript
// Pattern: validate → transform → call native
async displayNotification(notification: Notification): Promise<string> {
  const validated = validateNotification(notification);
  return this.native.displayNotification(validated);
}
```

### Type Guard Utilities
Use utilities from `src/utils/validate.ts`:
- Type checks: `isNull`, `isObject`, `isFunction`, `isString`, `isNumber`, `isBoolean`, `isArray`, `isUndefined`
- Specialized: `isArrayOfStrings`, `objectKeyValuesAreStrings`, `isAlphaNumericUnderscore`, `isValidUrl`, `isValidEnum`, `isValidColor`, `isValidTimestamp`, `isValidVibratePattern`

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
- `NotifeeApiModule.java` - React Native module (`@ReactMethod` annotations)
- `NotifeePackage.java` - Package registration
- `HeadlessTask.java` - Background JS execution
- `NotifeeReactUtils.java` - Conversion utilities

### iOS (`ios/RNNotifee/`)
- `NotifeeApiModule.m` - React Native module (`RCT_EXPORT_METHOD` macros)
- `NotifeeExtensionHelper.m` - Notification service extension support

## Expo Plugin

Located in `plugin/` directory. Expo config plugin for managed workflow integration. Tests in `plugin/__tests__/`.
