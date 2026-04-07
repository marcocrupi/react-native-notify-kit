# Contributing to react-native-notify-kit

Welcome! This is a community-maintained fork of [Notifee](https://github.com/invertase/notifee), officially recommended by Invertase as the drop-in replacement for `@notifee/react-native`. Contributions are welcome — but this is a single-maintainer project with no SLA, so please be patient with reviews.

## Before you contribute

- **Bugs** — open an issue using the [Bug Report template](https://github.com/marcocrupi/react-native-notify-kit/issues/new?template=bug_report.yml) first. Do not send PRs for bugs that haven't been triaged.
- **Features** — open a [Feature Request](https://github.com/marcocrupi/react-native-notify-kit/issues/new?template=feature_request.yml) first to discuss scope. Unsolicited feature PRs may be closed.
- **Questions** — use [Discussions Q&A](https://github.com/marcocrupi/react-native-notify-kit/discussions/categories/q-a), not issues.
- **Security** — use [private vulnerability reporting](https://github.com/marcocrupi/react-native-notify-kit/security/advisories/new), never public issues.

## Where changes go: bridge vs core

This fork actively develops `react-native-notify-kit` with both bug fixes and new features. Most changes — fixes, new APIs, behavior improvements — live in the React Native bridge layer (`packages/react-native/`), because that's where the public API surface and the platform-specific glue code sit.

**Rationale:** keeping NotifeeCore (the native engine in `android/` and `ios/`) minimally changed preserves API compatibility with the original `@notifee/react-native` and makes the fork easier to audit against upstream history.

**However**, since the upstream Notifee repository was archived by Invertase in April 2026, NotifeeCore will no longer receive updates from upstream. Modifications to the core are therefore **fully allowed** when the bridge layer isn't the right place — for example:

- Bug fixes in core notification logic
- New features that require native engine changes (new notification styles, new Android/iOS platform APIs, new trigger types)
- Security fixes
- Support for new Android/iOS platform requirements

PRs that modify NotifeeCore should:

- Explain in the PR description why the change belongs in the core rather than the bridge
- Be as focused as possible — one logical change per PR
- Include manual device verification (platform, OS version, device model)
- Update the relevant section of the CHANGELOG

## Project structure

- **`packages/react-native/`** — TypeScript bridge, validators, types (the npm-published package)
- **`android/`** — NotifeeCore Android (Java)
- **`ios/`** — NotifeeCore iOS (Objective-C)
- **`apps/smoke/`** — React Native 0.84 smoke test app for manual testing
- Monorepo managed with **Yarn 4 + Lerna**

## Development setup

### Prerequisites

- Node >= 22
- Yarn 4.6.0 (corepack-managed)
- Java 17
- Xcode 15+ (iOS)
- Android SDK with API 35

### Install and build

```bash
yarn install
yarn build:all          # Build everything (native core + TypeScript)
```

### Run tests

```bash
yarn test:all           # Jest + Android JUnit
```

### Smoke app

```bash
yarn smoke:start        # Start Metro bundler
yarn smoke:android      # Run on Android device/emulator
yarn smoke:ios          # Run on iOS simulator
```

### Watch mode for TypeScript development

```bash
yarn build:rn:watch
```

For local linking into a consumer app, use [yalc](https://github.com/wclr/yalc).

## Testing requirements

- All PRs must pass `yarn test:all`
- New bridge functionality requires accompanying Jest tests in `packages/react-native/__tests__/`
- For native bridge changes, manual verification on a real device is strongly preferred — note the platform and device tested in the PR description

## Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```text
<type>(<scope>): <subject>
```

**Types:** `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `build`, `ci`

**Scope** is optional but encouraged for platform-specific changes: `android`, `ios`

**Rules:** imperative mood, lowercase, no trailing period.

**Examples:**

- `fix(android): handle null context in NotificationAlarmReceiver`
- `feat(ios): add setNotificationConfig opt-out flag`
- `docs: update migration guide`

## Pull request workflow

1. Fork the repo and create a branch from `dev` (not `main`)
2. Branch naming: `fix/<short-description>` or `feat/<short-description>`
3. Keep PRs focused — one logical change per PR
4. Update `CHANGELOG.md` under the `[Unreleased]` section with a brief entry
5. Run `yarn format:all && yarn validate:all` before pushing
6. PRs must pass CI checks (lint, type check, Jest, JUnit)
7. Be patient — review may take days or weeks depending on maintainer availability

## Code style

- **TypeScript/JavaScript** — ESLint 9 flat config + Prettier 3 (single quotes, trailing commas, 100 char width, 2-space indent). Run `yarn format:all` and `yarn validate:all` before submitting.
- **Kotlin** (Android bridge) — standard Kotlin conventions, no specific linter enforced.
- **Objective-C++** (iOS bridge) — Google style via clang-format. Run `yarn format:rn:ios`.

## License

This project is licensed under [Apache-2.0](LICENSE), inherited from upstream Notifee. By contributing, you agree that your contributions are licensed under Apache-2.0.

No CLA or DCO sign-off is currently required.
