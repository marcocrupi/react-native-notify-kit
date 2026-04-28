#!/usr/bin/env bash
set -euo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Reference generation requires Git metadata. Run this command from a Git checkout/worktree; running it from a source copy without .git would remove GitHub source links from the generated reference." >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"

if ! git -C "$repo_root" remote get-url origin >/dev/null 2>&1; then
  echo "Reference generation requires a Git remote so TypeDoc can generate GitHub source links. Configure the checkout/worktree remote before regenerating reference docs." >&2
  exit 1
fi

cd "$repo_root"

yarn workspace react-native-notify-kit genversion --es6 --semi src/version.ts
yarn typedoc
yarn prettier --write docs/react-native/reference
