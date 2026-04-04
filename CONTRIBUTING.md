# Contributing

## Prerequisites

- Java 17 (bundled with Android Studio 2024+)
- Node.js >= 22
- Yarn 4.6.0 (corepack-managed)
- Xcode 16+ (for iOS development)
- Android Studio (for Android development)

## Step 1: Clone the repository

```bash
git clone https://github.com/marcocrupi/react-native-notify-kit.git
cd react-native-notify-kit/
```

## Step 2: Install dependencies

```bash
yarn
```

During this step, the `prepare` script runs `build:core:ios`, which copies the current NotifeeCore iOS source files into `packages/react-native/ios/`. If you modify iOS core code, re-run that step or temporarily set `$NotifeeCoreFromSources=true` in the consuming app's Podfile to use live sources.

The same applies to Android core code: run `yarn build:core:android` to generate a new AAR file, then rebuild the app.

## Step 3: Start TypeScript compiler in watch mode

```bash
yarn build:rn:watch
```

## Step 4: Run the smoke app

The smoke app at `apps/smoke/` (React Native 0.84, New Architecture) is used for manual testing:

```bash
yarn smoke:start      # Start Metro bundler
yarn smoke:android    # Run on Android device/emulator
yarn smoke:ios        # Run on iOS simulator
```

## Testing

### Unit tests

```bash
yarn tests_rn:test              # Run Jest tests once
yarn tests_rn:test-watch        # Run Jest tests in watch mode
yarn tests_rn:test-coverage     # Run Jest tests with coverage
```

### Android JUnit tests

```bash
yarn test:core:android          # Run ./gradlew testDebugUnit
```

### Linting & type checking

```bash
yarn validate:all:js            # ESLint
yarn validate:all:ts            # TypeScript type check
yarn validate:all               # ESLint + TypeScript + TypeDoc
```

## Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/) (enforced by semantic-release):

```text
<type>(<scope>): <subject>
```

**Types:** `fix`, `feat`, `docs`, `style`, `refactor`, `test`, `chore`, `build`

**Scopes (optional):** `android`, `ios`, `expo`

**Examples:**

- `fix(android): prevent headless task double-invocation`
- `feat: add web notification support`
- `docs: update installation guidance`

## Code Style

- **TypeScript/JavaScript**: Prettier (single quotes, trailing commas, 100 char width, 2-space indent)
- **Kotlin**: Android Studio default formatting
- **Objective-C**: clang-format Google style (`yarn format:rn:ios`)

## Publishing

### Automated Process

Release configuration is defined in `.releaserc` using semantic-release. This fork does not currently include a dedicated GitHub Actions publish workflow.

To enable fully automated publishing, add a workflow in `.github/workflows/` that runs `semantic-release` from the `main` branch with the required GitHub and npm credentials.

### Manual Process

1. Navigate to the React Native package: `cd packages/react-native`
2. Update release notes in `docs/react-native/release-notes.mdx`
3. Bump version: `npm version {major/minor/patch} --legacy-peer-deps`
4. Publish to npm: `npm publish` (generates a new core AAR; requires npm login with publish permissions for `react-native-notify-kit`)
5. Commit changes (after npm publish so new AAR files are committed)
6. Tag the repo: `react-native-notify-kit@x.y.z`
7. Push: `git push --tags`
8. Create a GitHub release:

   ```bash
   export TAGNAME=$(git tag --list | sort -r | head -1)
   gh release create ${TAGNAME} --title "${TAGNAME}" --notes "[Release Notes](https://github.com/marcocrupi/react-native-notify-kit/blob/main/docs/react-native/release-notes.mdx)"
   ```

### Verify

1. [GitHub releases](https://github.com/marcocrupi/react-native-notify-kit/releases)
2. [npm versions](https://www.npmjs.com/package/react-native-notify-kit?activeTab=versions)
3. [Changelog](https://docs.page/marcocrupi/react-native-notify-kit/react-native/release-notes)
4. [Tags](https://github.com/marcocrupi/react-native-notify-kit/tags)
