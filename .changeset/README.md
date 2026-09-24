# Changesets

Add a changeset for every user-facing change to a published package:

```sh
pnpm changeset
```

Select each affected package, choose the semantic version bump, and commit the generated Markdown file with the change.

## Coverage check

`pnpm check-changesets` runs in the dedicated **Changesets** PR job and in `pnpm local-ci`. It compares against the merge base with `origin/main` locally, including staged, unstaged, deleted, and untracked nonignored files. Set `CHANGESET_BASE_REF` to check another target; CI sets it to the PR target branch. Missing refs/history and invalid Changesets configuration fail the check rather than skipping it.

Every affected published package must appear in a **new** changeset. Pending changesets already on the target branch do not count, even if edited. One changeset may cover several packages. The check does not judge release notes or whether a patch, minor, or major bump is appropriate.

Publication eligibility comes from Changesets configuration and workspace manifests: private, ignored, and versionless packages do not need their own changesets. Changes to unpublished packages follow workspace `dependencies` and `optionalDependencies` transitively to published consumers, stopping at those published packages. `devDependencies` and `peerDependencies` do not propagate coverage requirements, including build-only relationships. Changesets handles subsequent dependent bumps during release planning.

Impact rules are intentionally conservative:

- Package source (even when only generated `dist` is published), canonical docs, assets, manifests, patches, and build configuration count. Documentation fixes in published packages usually need a patch changeset.
- Recognisable test/fixture/scratch paths and `.test.*` / `.spec.*` files are excluded only when the package's `files` allowlist does not ship them. Without an allowlist, published packages are treated conservatively as shipping them. Other package files count, even outside the allowlist, because they may be build inputs.
- Shared root inputs (`package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `.npmrc`, `.node-version`, root Vite/TypeScript configuration, and non-test files in `scripts/`) affect every published package. This deliberately avoids trying to infer arbitrary build graphs. Root README/website content and changes in unpublished applications without published consumers do not require coverage.

For changes that need no release, explicitly opt out the whole PR:

```sh
pnpm changeset --empty
```

A brief reason in its body is encouraged, especially for tooling-only root input changes. An empty changeset already on the target branch does not opt out a new PR. The automated `changeset-release/main` PR skips the dedicated job; other CI checks still run.

## Releases

After changes reach `main`, successful CI triggers the release workflow. Changesets opens or updates a `chore: release` pull request containing version and changelog updates. Merging that pull request triggers a build and publishes the packages to npm through trusted publishing.

The `overmux` npm package must configure this repository's `.github/workflows/release.yml` workflow as a trusted publisher before the automated publish step can succeed.

Changesets documentation: <https://github.com/changesets/changesets>
