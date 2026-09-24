import getReleasePlan from "@changesets/get-release-plan";
import assert from "node:assert/strict";
import { resolve } from "node:path";

// Changesets cannot ignore a workspace dependency without also ignoring its public
// consumers. Preserve that graph (and desktop's private versioning), but stop the
// standard release before it can change the fork's independently managed version.
const root = resolve(import.meta.dirname, "..");
const plan = await getReleasePlan(root);
assert.ok(
  !plan.releases.some((release) => release.name === "@overmux/xterm-fork"),
  "The xterm fork must never be versioned by standard Changesets. Move its note to packages/ecosystem/xterm-fork/.changeset and use that package's release command.",
);
