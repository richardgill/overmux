# Overmux website

Run `pnpm --filter @overmux/www dev` to stage package-owned documentation and start the Fumadocs website.

Hand-authored package Markdown stays canonical under each package's `docs/` directory. Website staging copies configured Markdown and assets, while `docs.config.ts` defines website paths and navigation metadata. Restart the development server after changing either source.
