When you're done making changes run: `pnpm run local-ci`

Only use Effect within `tooling/infra`; do not introduce it into applications, runtime packages, or ecosystem packages.
Scale comment detail with conceptual and lifecycle complexity: define unfamiliar domain concepts and explain races, ordering, cancellation, backpressure, and cleanup invariants, while leaving straightforward code self-explanatory.
Resolve configuration defaults early where practical; defer only values that require runtime information, making that deferred resolution explicit.
Name environment variables that are safe to expose with a `PUBLIC_` prefix; keep secret-only values unprefixed.
Keep environment variable names aligned across local development, GitHub Actions, deployment tooling, and runtime bindings; only alias at a boundary when an external platform requires it, and document that exception there.
Prefer TypeScript scripts over embedding logic in GitHub Actions YAML, since we cannot run it locally.

Packages under `packages/runtime` implement the Overmux CLI, shared contracts, trusted server, and browser runtime.
User-facing plugins, integrations, and reusable building blocks belong under `packages/ecosystem`.
Use `packages/runtime/lib` (`@overmux/lib`) for small, environment-neutral foundational helpers shared across packages; keep it dependency-free and exclude domain-specific code.
The public runtime API is exposed through `overmux`, with environment-neutral exports at the root and runtime-specific APIs under `overmux/client` and `overmux/server`.
Keep all runtime implementation private inside `overmux`; only `.`, `./client`, and `./server` are public runtime entry points.
Explicitly name user-facing exports; do not use `export *` in public API entry points.
When a package exposes public subpaths, mirror them under `src/<subpath>/`; keep implementation beneath its owning export and point aliases at the same built entry rather than adding forwarding barrels.
Do not add `description` frontmatter to documentation pages unless explicitly asked.
Package-owned `docs/*.md` files are canonical and portable; `apps/www` stages them for Fumadocs rather than owning copies.
Register each documentation source and its website navigation in `docs.config.ts`; generated Fumadocs `meta.json` stays under `apps/www` and out of published packages.
All future releases must use patch bumps, including npm packages and the desktop; do not introduce minor or major changesets unless explicitly requested.
Version `overmux`, ecosystem packages, and the desktop independently; declare runtime compatibility through `overmux` peer dependency ranges and explicit protocol/bridge versions.
For entirely experimental packages, make this very clear in the documentation; use normal semver and the standard `latest` npm dist-tag without a separate release channel.
State prominently that compatibility is not guaranteed and show installation using the explicitly experimental package name.
New npm packages need an initial publish using an npm login or token, followed by per-package trusted-publisher configuration for `richardgill/overmux` and `release.yml`; only then can automated releases publish them.
Published npm packages should include `src/` through the `files` allowlist for direct inspection while keeping all package exports pointed at `dist/`.
Enable source maps with embedded sources; exclude tests, fixtures, secrets, and bulky generated files from published artifacts.

Overmux userland (UL) is user application-owned code that composes and customizes Overmux through its public APIs. It includes `overmux.config.ts`, trusted server definitions, browser UI, commands, shared schemas, optional Vite configuration, and the wiring of ecosystem integrations. It excludes Overmux's private runtime, protocols, transports, compiler, and browser/server infrastructure.

## Testing

- Put repository-local temporary test artifacts under `.test-tmp/`; the directory is gitignored.
- Collocate tests with the production code they primarily exercise. Use dedicated e2e directories only for cross-package or system-level tests.
- Prefer a few high-value e2e tests through public boundaries. Use unit tests mainly for tricky, pure logic.
- Give each behavior one clear test owner; avoid repeating coverage across test layers without a specific risk.
- Tests must read clearly as setup → action → observable result.
- Extract helpers when their names expose intent and remove mechanical setup; avoid helpers that hide behavior.
- For similar pure cases, use `const testCases = [...]` with `testCases.each` and descriptive case names.
- Cover representative happy paths and high-risk lifecycle failures, not exhaustive permutations.
- Fake only external or nondeterministic systems.
- Production code may be reshaped to accommodate tests, but only when the benefit is substantial.
