// Covers repository containment before untracked files are inspected.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";

import { untrackedStats } from "./git-worktree";

const testDirectory = resolve(".test-tmp/git-worktree");

afterEach(() => rm(testDirectory, { force: true, recursive: true }));

test("rejects outside paths before sampling oversized files", async () => {
  const root = join(testDirectory, "repository");
  await mkdir(root, { recursive: true });
  await writeFile(join(testDirectory, "outside.bin"), Buffer.alloc(8_001));

  await expect(untrackedStats(root, "../outside.bin", 1)).rejects.toThrow(
    "Git returned a path outside the repository",
  );
});
