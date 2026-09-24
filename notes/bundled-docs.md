# Bundled documentation

## Goal

Package-owned Markdown is the authoritative documentation for its exact installed version. The same hand-authored files are available offline in npm packages and the standalone Overmux runtime, and are rendered by the Fumadocs website.

## Source ownership

Each documented package owns portable Markdown in its `docs/` directory. `README.md` remains a package entry point. Documentation is hand-authored, including the Overmux CLI pages. Use CommonMark with Fumadocs-compatible frontmatter by default, and MDX only when a page needs an interactive component.

`apps/www` does not own copies of package documentation. `docs.config.ts` lists documentation source directories, their website paths, and website-only navigation metadata. It does not describe publishing status or package names.

## Distribution and CLI

Publishable packages retain `docs` and `README.md` in their `files` entries. The Overmux build copies `docs` to `dist/docs`, allowing npm and standalone layouts to expose the same Markdown corpus.

`overmux docs path` prints the absolute installed documentation directory. It resolves the directory from the package or standalone runtime layout, rather than the current working directory.

## Website staging

Website content generation walks the configured source directories, copies Markdown and MDX byte-for-byte to `apps/www/generated/package-docs`, and copies other files to `apps/www/public/docs`. It generates Fumadocs-validated `meta.json` files from `docs.config.ts`.

Fumadocs serves the staged documentation through nested routes, search, Markdown responses, `llms.txt`, and `llms-full.txt`. Restart website development after changing package docs or the configuration.

## Checks

`pnpm generate-content` runs website content generation. Focused tests cover Markdown copying, asset copying, and ordered nested metadata. The repository does not generate CLI references, validate local links or destination collisions, or inspect package archives and installed artifacts.
