import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { root } from "./shared.mts";
import { packageName, releaseNote } from "./versioning.mts";

const args = process.argv.slice(2);
assert.ok(
  args.length === 0 ||
    (args.length === 2 &&
      ["-m", "--message"].includes(args[0]) &&
      args[1].trim()),
  'Usage: pnpm changeset [-m "Release note"]. Only patch authoring is supported; use pnpm prepare-release, not changeset version/publish.',
);
const prompt = args.length
  ? undefined
  : createInterface({ input: process.stdin, output: process.stdout });
try {
  const summary = args[1] ?? (await prompt!.question("Patch release note: "));
  const contents = `---\n"${packageName}": patch\n---\n\n${summary.trim()}\n`;
  const file = resolve(root, ".changeset", `${randomUUID()}.md`);
  releaseNote(contents, file);
  // Write directly inside this recipe, never let workspace discovery select the root Changesets directory.
  writeFileSync(file, contents);
  console.log(file);
} finally {
  prompt?.close();
}
