import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { upstream } from "../upstream.ts";
import { validateVersionBase } from "./versioning.mts";
import { root, runOutput } from "./shared.mts";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
assert.equal(pkg.name, "@overmux/xterm-fork");
assert.equal(
  pkg.repository?.url,
  "git+https://github.com/richardgill/overmux.git",
);
assert.equal(process.env.GITHUB_REPOSITORY, "richardgill/overmux");
assert.equal(process.env.GITHUB_EVENT_NAME, "workflow_dispatch");
assert.equal(process.env.GITHUB_REF, `refs/tags/xterm-fork-v${pkg.version}`);
assert.equal(pkg.repository?.directory, "packages/ecosystem/xterm-fork");
assert.equal(
  runOutput("git", ["status", "--porcelain"], root).trim(),
  "",
  "Release checkout must be clean",
);
assert.equal(
  runOutput("git", ["rev-parse", "HEAD"], root).trim(),
  runOutput(
    "git",
    ["rev-parse", `refs/tags/xterm-fork-v${pkg.version}^{commit}`],
    root,
  ).trim(),
  "Release tag must identify HEAD",
);
assert.equal(pkg.private, true, "Recipe root must remain private");
validateVersionBase(pkg.version, upstream.tag);
assert.ok(
  readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8").includes(
    `\n## ${pkg.version}\n`,
  ),
  "Release version missing from changelog",
);
assert.equal(
  readdirSync(new URL("../.changeset", import.meta.url)).filter(
    (name) => name.endsWith(".md") && name !== "README.md",
  ).length,
  0,
  "Prepare pending changesets before release",
);
