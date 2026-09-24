# Overmux xterm fork recipe

This package's build recipe applies three exact patches to xterm.js 6.0.0 commit
`f447274f430fd22513f6adbf9862d19524471c04`, then compiles and assembles
`@overmux/xterm-fork`. It deliberately contains no copied upstream tree.

Original Overmux modifications are Copyright (c) 2026 Richard Gill and licensed
under MIT; see the distributed [LICENSE](LICENSE) for the MIT permission text.
Upstream copyrights in that file remain unchanged.

Use Node 24.20.0 and run `pnpm install --frozen-lockfile` first. The private
recipe root is never publishable. `pnpm run local-ci` builds one fresh upstream
checkout, verifies the pinned commit,
checks and applies every patch, installs upstream with npm 10.9.4, rebuilds
native tools, compiles both browser distributions, then packs and validates the
assembled artifact. Validation checks that source maps embed the patched
`CompositionHelper`, `CoreService`, and `CoreBrowserTerminal` sources exactly
as shipped in `src/`, typechecks direct and official-addon consumers, runs the
browser behavior suite, and runs upstream tests and lint.

Without `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, the recipe installs Chromium and
its Ubuntu dependencies with the workspace-catalog Playwright CLI after
upstream npm installation. This supports Ubuntu 24's package names; the pinned
upstream Playwright runner still executes the tests against that browser. On NixOS, set it to `$(command -v chromium)` to use
the system browser. `XTERM_RECIPE_WORKDIR` selects a scratch parent directory;
the default is `~/code/noisy-files/overmux-xterm-builds`. Each build creates a
new `build-*` child. Caller directories are never deleted. Remove obsolete generated build directories manually when
no longer needed.

Assembly includes only the public package manifest, MIT `LICENSE` preserved
from upstream, recipe attribution (`FORK.md`), user release notes (`CHANGELOG.md`),
package README and user docs, CSS, runtimes and maps, public declarations, and production `src/` files. The exact tarball
entry list is checked against that allowlist; tests, fixtures, build configs,
and other upstream artifacts are excluded.

The canonical upstream declarations remain ambient during compilation. Assembly
converts the produced declaration file to a normal external module, so consumers
import only `@overmux/xterm-fork`. Official addons with historical declaration
imports may additionally need the consumer alias
`"@xterm/xterm": "npm:@overmux/xterm-fork@6.0.0-overmux.1"`; do not import that alias at
runtime.

## Releases

The canonical [release guide](https://github.com/richardgill/overmux/blob/main/packages/ecosystem/xterm-fork/CONTRIBUTING.md)
covers trusted-publisher verification/configuration, `pnpm changeset` /
`pnpm release`, versioning, confirmation, and failure recovery.
`6.0.0-overmux.1` is already published; future patch releases use that mechanism
once a human verifies it. Public source repositories receive automatic npm provenance;
private source repositories remain supported without public provenance. The private
tooling root is never publishable.
