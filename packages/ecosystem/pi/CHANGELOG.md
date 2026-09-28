# @overmux/pi

## 0.0.9

### Patch Changes

- [#17](https://github.com/richardgill/overmux/pull/17) [`405ec4c`](https://github.com/richardgill/overmux/commit/405ec4c250415a168766b7192dbb7c9c2e991ea9) Thanks [@richardgill](https://github.com/richardgill)! - Replace legacy Git source-control resources with independent read-only status and selected-file diff resources. Remove the Git React UI, including its views, navigation commands, stylesheet, and browser exports. Pi now owns the patch renderer it uses directly.

  Preserve resource invalidations received during an active client read so subscribed views refresh after that read settles.

- Updated dependencies [[`26b2b78`](https://github.com/richardgill/overmux/commit/26b2b789932813bea670cfcc35d9c5fdbbfac193), [`405ec4c`](https://github.com/richardgill/overmux/commit/405ec4c250415a168766b7192dbb7c9c2e991ea9)]:
  - overmux@0.0.9

## 0.0.8

### Patch Changes

- [#15](https://github.com/richardgill/overmux/pull/15) [`ab776b6`](https://github.com/richardgill/overmux/commit/ab776b659a54877a82af52d2150c14942457839c) Thanks [@richardgill](https://github.com/richardgill)! - Use Zod 4.6.5 throughout the workspace and rebuild dependent packages. Packages exposing Zod schemas now share the application's installation through a ^4.6.5 peer dependency so public schemas remain type-compatible. Newly initialized applications explicitly depend on Zod ^4.6.5.

- Updated dependencies [[`a73f207`](https://github.com/richardgill/overmux/commit/a73f20729477037e0d779c181e79d04d5c55af71), [`ab776b6`](https://github.com/richardgill/overmux/commit/ab776b659a54877a82af52d2150c14942457839c)]:
  - overmux@0.0.8
  - @overmux/git@0.0.8

## 0.0.7

### Patch Changes

- [`76e3195`](https://github.com/richardgill/overmux/commit/76e319576de46181b76a2c812f7f12f7eb6f36c0) Thanks [@richardgill](https://github.com/richardgill)! - Declare MIT licensing for original Overmux code, include distribution licenses and third-party notices, and establish current-version changelog baselines for public source releases.

- Updated dependencies [[`76e3195`](https://github.com/richardgill/overmux/commit/76e319576de46181b76a2c812f7f12f7eb6f36c0), [`76e3195`](https://github.com/richardgill/overmux/commit/76e319576de46181b76a2c812f7f12f7eb6f36c0)]:
  - overmux@0.0.7
  - @overmux/git@0.0.7

## 0.0.6

Current-version baseline: Pi agent integration, session resources, conversation views, and messaging for Overmux.
