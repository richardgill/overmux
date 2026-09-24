import assert from "node:assert/strict";
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { upstream } from "../upstream.ts";
import { root } from "./shared.mts";
import { nextVersion, packageName, releaseNote } from "./versioning.mts";

assert.equal(process.argv.length, 2, "Usage: pnpm prepare-release");
const manifestPath = resolve(root, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert.equal(manifest.name, packageName);
assert.equal(manifest.private, true, "Recipe root must remain private");
const version = nextVersion(manifest.version, upstream.tag);
const directory = resolve(root, ".changeset");
const files = readdirSync(directory)
  .filter((name) => name.endsWith(".md") && name !== "README.md")
  .sort();
const notes = files.map((name) =>
  releaseNote(readFileSync(resolve(directory, name), "utf8"), name),
);
const changelogPath = resolve(root, "CHANGELOG.md");
const changelog = readFileSync(changelogPath, "utf8");
assert.ok(
  changelog.startsWith("# Changelog\n\n"),
  "Unexpected changelog header",
);
assert.ok(
  changelog.includes(`\n## ${manifest.version}\n`),
  "Changelog must contain the current prepared version",
);
assert.ok(
  !changelog.includes(`\n## ${version}\n`),
  `Changelog already contains ${version}`,
);

// Validate the entire plan before changing any files; rejected entries remain available to fix.
if (notes.length === 0) {
  console.log("No changesets; no release prepared.");
} else {
  const entry = `## ${version}\n\n${notes.map((note) => `- ${note.replaceAll("\n", "\n  ")}`).join("\n\n")}\n\n`;
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ ...manifest, version }, null, 2)}\n`,
  );
  writeFileSync(
    changelogPath,
    `# Changelog\n\n${entry}${changelog.slice("# Changelog\n\n".length)}`,
  );
  for (const file of files) {
    unlinkSync(resolve(directory, file));
  }
  console.log(
    `Prepared ${packageName}@${version} from ${files.length} changeset(s). Review and commit before tagging.`,
  );
}
