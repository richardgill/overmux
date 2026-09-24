#!/usr/bin/env sh
set -eu

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if command -v bwrap >/dev/null 2>&1 && [ "$(uname -s)" = "Linux" ]; then
  exec bwrap \
    --die-with-parent \
    --new-session \
    --ro-bind / / \
    --bind "$repo_root" "$repo_root" \
    --dev-bind /dev /dev \
    --proc /proc \
    --tmpfs /tmp \
    --chdir "$repo_root" \
    --setenv CI true \
    -- pnpm run local-ci
fi

exec env CI=true pnpm run local-ci
