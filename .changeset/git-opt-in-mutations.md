---
"@overmux/git": patch
---

Add independent, opt-in Git operation handlers for staging saved files, unstaging, permanently discarding unstaged selections, and applying supplied index-only patches. Require explicit allowed roots and per-operation permissions, validate selected paths, and serialize mutations by canonical repository within the server process. Resources remain read-only and refresh through repository watchers.

Export `createGitPatch` from `@overmux/git/shared` to create text patches from complete diffs or selected hunks, preserving line endings and supporting index patch reversal.
