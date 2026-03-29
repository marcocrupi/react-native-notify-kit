# Test Project (tests_react_native)

React Native test application for unit tests (Jest) and end-to-end tests (Cavy).

## Running Tests

```bash
# Unit tests (from repo root)
yarn tests_rn:test              # Run Jest once
yarn tests_rn:test-watch        # Watch mode
yarn tests_rn:test-coverage     # With coverage report

# E2E tests (requires running packager + built app)
yarn tests_rn:packager          # Start Metro bundler first
yarn tests_rn:android:test      # E2E on Android (cavy-cli)
yarn tests_rn:ios:test          # E2E on iOS (iPhone 16 simulator)
```

## Jest Configuration

- **Config file**: `tests_react_native/jest.config.js` (rootDir points to repo root `..`)
- **Preset**: react-native
- **Transforms**: babel-jest (JS), ts-jest (TS/TSX)
- **Test pattern**: `tests_react_native/__tests__/**/*.test.ts`
- **Setup**: `jest-mock.js` mocks `NativeModules.NotifeeApiModule` with stubbed methods, sets `Platform.OS` to `'android'`
- **Coverage**: Collects from `packages/react-native/src/` only (jest.config also references `plugin/` but that directory does not exist)

## Test Structure

### Unit Tests (`__tests__/`)

- `NotifeeApiModule.test.ts` — Tests public API methods (mocks native module, tests both platforms)
- `notifeeAppModule.test.ts` — Module initialization and version checks
- `testSetup.ts` — Utility: `setPlatform('android'|'ios')` to override platform detection
- `validators/` — 17 test files, one per validator, following `validate{Feature}.test.ts` naming
  - Known typo in filesystem: `validateAndriodAction.test.ts` (misspelling of "Android" — this is the actual filename on disk)

### E2E Tests (`specs/`)

- `notification.spec.ts`, `api.spec.ts` — Cavy E2E specs run on real devices/emulators

## Writing Tests

### Validator Tests

Follow existing pattern — test valid inputs pass through and invalid inputs throw with descriptive messages:

```typescript
describe('validateAndroidChannel', () => {
  test('throws if channel id is not a string', () => {
    expect(() => validateAndroidChannel({ id: 123 }))
      .toThrow("'channel.id' expected a string value.");
  });
});
```

### Platform-Specific Tests

Use `setPlatform()` from `testSetup.ts` to override platform detection:

```typescript
import { setPlatform } from './testSetup';

beforeEach(() => setPlatform('ios'));  // overrides isIOS/isAndroid for subsequent calls
```

### Mocking

Native modules are mocked in `jest-mock.js` (loaded via `setupFilesAfterSetup`). The mock provides `NotifeeApiModule` with all native methods stubbed as `jest.fn()`. Tests validate TypeScript logic, NOT native behavior.

## E2E Tests

Use [Cavy](https://github.com/pixielabs/cavy) test framework. Specs in `specs/` run on real devices/emulators via `cavy-cli`.

**Important**: For E2E tests with local (unpublished) code, you may need to symlink:

```bash
cd tests_react_native/node_modules/@notifee && rm -fr react-native && ln -s ../../../packages/react-native .
```
