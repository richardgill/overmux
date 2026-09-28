# @overmux/git

## 0.0.9

### Patch Changes

- [#17](https://github.com/richardgill/overmux/pull/17) [`405ec4c`](https://github.com/richardgill/overmux/commit/405ec4c250415a168766b7192dbb7c9c2e991ea9) Thanks [@richardgill](https://github.com/richardgill)! - Replace legacy Git source-control resources with independent read-only status and selected-file diff resources. Remove the Git React UI, including its views, navigation commands, stylesheet, and browser exports. Pi now owns the patch renderer it uses directly.

  Preserve resource invalidations received during an active client read so subscribed views refresh after that read settles.

- [#26](https://github.com/richardgill/overmux/pull/26) [`7eef3aa`](https://github.com/richardgill/overmux/commit/7eef3aa4079d420a4adce3ae84466250acf33fee) Thanks [@richardgill](https://github.com/richardgill)! - Prune ignored-only directory trees before installing native Git watchers, retain tracked exceptions and untracked discovery, and reconcile subscribed repositories to recover missed events and watch failures.

- [#25](https://github.com/richardgill/overmux/pull/25) [`0105da2`](https://github.com/richardgill/overmux/commit/0105da2b4a2548ec0dc05bb4eea471cdd0c52fe8) Thanks [@richardgill](https://github.com/richardgill)! - Remove the experimental designation from the Git package documentation.

- [#17](https://github.com/richardgill/overmux/pull/17) [`405ec4c`](https://github.com/richardgill/overmux/commit/405ec4c250415a168766b7192dbb7c9c2e991ea9) Thanks [@richardgill](https://github.com/richardgill)! - Add independent, opt-in Git operation handlers for staging saved files, unstaging, permanently discarding unstaged selections, and applying supplied index-only patches. Require explicit allowed roots and per-operation permissions, validate selected paths, and serialize mutations by canonical repository within the server process. Resources remain read-only and refresh through repository watchers.

  Export `createGitPatch` from `@overmux/git/shared` to create text patches from complete diffs or selected hunks, preserving line endings and supporting index patch reversal.

- Updated dependencies [[`26b2b78`](https://github.com/richardgill/overmux/commit/26b2b789932813bea670cfcc35d9c5fdbbfac193), [`405ec4c`](https://github.com/richardgill/overmux/commit/405ec4c250415a168766b7192dbb7c9c2e991ea9)]:
  - overmux@0.0.9

## 0.0.8

### Patch Changes

- [#15](https://github.com/richardgill/overmux/pull/15) [`ab776b6`](https://github.com/richardgill/overmux/commit/ab776b659a54877a82af52d2150c14942457839c) Thanks [@richardgill](https://github.com/richardgill)! - Use Zod 4.6.5 throughout the workspace and rebuild dependent packages. Packages exposing Zod schemas now share the application's installation through a ^4.6.5 peer dependency so public schemas remain type-compatible. Newly initialized applications explicitly depend on Zod ^4.6.5.

- Updated dependencies [[`a73f207`](https://github.com/richardgill/overmux/commit/a73f20729477037e0d779c181e79d04d5c55af71), [`ab776b6`](https://github.com/richardgill/overmux/commit/ab776b659a54877a82af52d2150c14942457839c)]:
  - overmux@0.0.8
  - @overmux/ui@0.0.6

## 0.0.7

### Patch Changes

- [`76e3195`](https://github.com/richardgill/overmux/commit/76e319576de46181b76a2c812f7f12f7eb6f36c0) Thanks [@richardgill](https://github.com/richardgill)! - Declare MIT licensing for original Overmux code, include distribution licenses and third-party notices, and establish current-version changelog baselines for public source releases.

- Updated dependencies [[`76e3195`](https://github.com/richardgill/overmux/commit/76e319576de46181b76a2c812f7f12f7eb6f36c0), [`76e3195`](https://github.com/richardgill/overmux/commit/76e319576de46181b76a2c812f7f12f7eb6f36c0)]:
  - overmux@0.0.7
  - @overmux/ui@0.0.5

## 0.0.6

Current-version baseline: Git repository resources, operations, and React source-control views for Overmux.
