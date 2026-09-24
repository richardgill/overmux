# Missing npm license sources

`@stricli/core@1.3.0` publishes only `dist`, its manifest and README, omitting its Apache-2.0 license and trademark text. `stricli-core-1-3-0/` preserves those upstream files byte-for-byte, including Bloomberg's 2024 copyright. The source tree at the recorded revision has no separate NOTICE file.

`provenance.json` records the published npm artifact's `gitHead`, integrity, and SHA-256 hashes of the original files retrieved from that exact GitHub revision. The release tag points at a different commit; the npm artifact's revision is intentional. Build-time recovery is local, hash-checked and restricted to this exact package/version. No build downloads are performed.

On a Stricli upgrade, prefer the installed license if npm includes it. Otherwise retrieve the legal files from the new published artifact's source revision, review its LICENSE/NOTICE/trademark requirements, and add a version-specific recovery with provenance and tests. Never reuse this copy for another version or replace it with generic license prose.

Both Vite builds discover bundled packages from emitted chunk modules (including transitive inputs and bundler helpers) and emit `THIRD_PARTY_NOTICES.md` in their output directories. Thus npm ships `dist/THIRD_PARTY_NOTICES.md` for the CLI and `dist/auth/THIRD_PARTY_NOTICES.md` for the authentication UI; these generated files remain ignored with `dist`. The auth build also retains the notices in its JavaScript after minification, so browser recipients receive them without opening a new public asset route.
