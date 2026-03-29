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

- **Config file**: `jest.config.js` (at project root, rootDir: `..`)
- **Preset**: react-native
- **Transforms**: babel-jest (JS), ts-jest (TS/TSX)
- **Test pattern**: `__tests__/**/*.test.ts`
- **Setup**: `jest-mock.js` (mocks NativeModules.NotifeeApiModule)
- **Coverage**: Collects from `packages/react-native/src/` and `plugin/`

## Test Structure

```
__tests__/
├── notifeeAppModule.test.ts              # Module initialization tests
└── validators/
    ├── validateAndroidChannel.test.ts
    ├── validateAndroidAction.test.ts
    ├── validateIOSAttachment.test.ts
    └── validateIOSCategory.test.ts

specs/                                     # E2E test specs (Cavy)
├── notification.spec.ts
└── api.spec.ts
```

## Writing Tests

### Unit Tests (Validators)
Follow existing pattern - test valid inputs pass through and invalid inputs throw with descriptive messages:
```typescript
describe('validateAndroidChannel', () => {
  test('throws if channel id is not a string', () => {
    expect(() => validateAndroidChannel({ id: 123 }))
      .toThrow("'channel.id' expected a string value.");
  });
});
```

### Mocking
Native modules are mocked in `jest-mock.js`. The mock provides a `NotifeeApiModule` with all native methods stubbed. Tests validate TypeScript logic, NOT native behavior.

## E2E Tests

Use [Cavy](https://github.com/pixielabs/cavy) test framework. Specs in `specs/` directory run on real devices/emulators via `cavy-cli`.

**Important**: For E2E tests with local (unpublished) code, you may need to symlink:
```bash
cd tests_react_native/node_modules/@notifee && rm -fr react-native && ln -s ../../../packages/react-native .
```
