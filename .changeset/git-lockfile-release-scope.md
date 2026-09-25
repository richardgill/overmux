---
---

The accompanying patch changeset releases `@overmux/git` and `overmux`. Opt out of unrelated package releases requested by the repository-wide lockfile rule: this dependency update adds Git-only `chokidar` and `diff` dependencies. The remaining lockfile changes are pnpm's normalization of existing development-only Vitest peer references, not runtime dependency upgrades for other packages.
