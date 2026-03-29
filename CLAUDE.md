# Notifee - React Native Notification Library

Fork of [invertase/notifee](https://github.com/invertase/notifee). Feature-rich local notification library for React Native (Android + iOS).

## Project Structure

Monorepo managed with **Lerna + Yarn Workspaces**.

```
notifee/
├── android/                    # Native Android core library (Java, package: app.notifee.core)
├── ios/                        # Native iOS core library (Objective-C)
├── packages/
│   └── react-native/          # @notifee/react-native NPM package (TypeScript)
│       ├── src/               # TypeScript source (API, validators, types)
│       ├── android/           # RN Android bridge (package: io.invertase.notifee)
│       └── ios/               # RN iOS bridge (Objective-C)
├── tests_react_native/        # Jest unit tests + Cavy E2E tests
├── docs/                      # Documentation (docs.page)
└── packages/flutter/          # Flutter package (separate, uses Melos)
```

## Essential Commands

### Build

```bash
yarn build:all                  # Build everything (core + RN)
yarn build:core:android         # Gradle assembleRelease + publish AAR
yarn build:core:ios             # ./build_ios_core.sh (copies to packages/react-native/ios)
yarn build:rn                   # TypeScript compilation (packages/react-native)
yarn build:rn:watch             # Watch mode for TS development
```

### Test

```bash
yarn tests_rn:test              # Jest unit tests
yarn tests_rn:test-watch        # Jest watch mode
yarn tests_rn:test-coverage     # Jest with coverage
yarn test:core:android          # Android JUnit tests (./gradlew testDebugUnit)
yarn tests_rn:android:test      # E2E Android (cavy-cli)
yarn tests_rn:ios:test          # E2E iOS (cavy-cli, iPhone 16 simulator)
```

### Lint & Validate

```bash
yarn validate:all:js            # ESLint
yarn validate:all:ts            # TypeScript type check
yarn validate:all               # ESLint + TypeScript + TypeDoc
```

### Format

```bash
yarn format:all                 # Format everything
yarn format:core:android        # Java (google-java-format)
yarn format:core:ios            # Objective-C (clang-format --style=Google)
yarn format:rn:android          # RN bridge Java
yarn format:rn:ios              # RN bridge Objective-C
```

### Run Test App

```bash
yarn tests_rn:packager          # Start Metro bundler
yarn run:android                # Run Android test app
yarn run:ios                    # Run iOS test app (iPhone 16 simulator)
```

## Architecture

### Three-Layer Design

1. **Native Core** (`android/`, `ios/`) - Platform-specific notification logic. Standalone libraries reusable by other wrappers (e.g., Flutter).
2. **React Native Bridge** (`packages/react-native/android/`, `packages/react-native/ios/`) - Thin bridge layer connecting RN to native core.
3. **TypeScript API** (`packages/react-native/src/`) - Public API surface, validation, types, event handling.

### Key Architectural Patterns

- **Validation-first**: All notification objects are validated in TypeScript before reaching native code. Validators in `src/validators/` throw descriptive errors with property paths.
- **Event-driven**: Notifications emit events (press, dismiss, deliver) via platform-specific mechanisms. Android uses headless tasks via `AppRegistry.registerHeadlessTask()`. iOS uses `RCTEventEmitter` with deferred event delivery.
- **Platform detection**: Use `Platform.OS` checks (`isAndroid`, `isIOS`, `isWeb`) for conditional logic.
- **Native core build artifacts**: Android core compiles to AAR published to `packages/react-native/android/libs/`. iOS core is copied as source files.

### Native Core Rebuild

After modifying native core code, you MUST rebuild before testing:
- **Android**: `yarn build:core:android` then rebuild the app
- **iOS**: `yarn build:core:ios` OR set `$NotifeeCoreFromSources=true` in `packages/react-native/RNNotifee.podspec` for live source inclusion

## Commit Conventions

MUST use **Conventional Commits** format (enforced by semantic-release):

```
<type>(<scope>): <subject>
```

Types: `fix`, `feat`, `docs`, `style`, `refactor`, `test`, `chore`, `build`
Scopes: `android`, `ios`, `expo` (optional)

Examples:
- `fix(android): prevent headless task double-invocation`
- `feat: add web notification support`
- `docs: update installation guidance`

## Code Style

- **TypeScript/JavaScript**: Prettier (single quotes, trailing commas, 100 char width, 2-space indent)
- **Java**: google-java-format
- **Objective-C**: clang-format with Google style
- **Line endings**: LF (enforced via .gitattributes)
- **Encoding**: UTF-8

## Platform Requirements

- **Android**: compileSdk 34, minSdk 20, targetSdk 33, Java 8/11/17/21
- **iOS**: Deployment target iOS 10.0+, Objective-C
- **React Native**: Compatible with any version (peer dependency)
- **Node/Yarn**: Yarn 1.22.19+ (pinned), no package-lock (npm disabled)

## Release Process

Fully automated via semantic-release (`.releaserc`). Manual trigger on main branch via GitHub Actions workflow `publish.yml`. NEVER manually bump versions or publish.

## Important Notes

- `version.ts` is auto-generated by `genversion` - NEVER edit manually
- The `dist/` directory is the compiled output of `packages/react-native/src/` - NEVER edit directly
- AAR files in `packages/react-native/android/libs/` are build artifacts - regenerate with `yarn build:core:android`
- Use `legacy-peer-deps=true` (configured in `.npmrc`)
