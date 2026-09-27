import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, test as testCases } from "vitest";

import { buildFileDiff } from "../server/diff";
import { createGitPatch, type GitDiff } from "./index";

const exec = promisify(execFile);
const testRoot = fileURLToPath(
  new URL("../../../../../.test-tmp/", import.meta.url),
);
const roots: string[] = [];
const git = async (root: string, args: string[]) => {
  const { stdout, stderr } = await exec("git", ["-C", root, ...args], {
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  });
  // A successful content search can hide incorrect coordinates in repeated lines.
  if (args[0] === "apply") {
    expect(stderr).not.toContain("offset");
  }
  return stdout;
};

const compare = (
  oldContent: string | null,
  newContent: string | null,
  file = "file.txt",
  contextLines = 0,
) =>
  buildFileDiff({
    contextLines,
    contents: {
      file,
      oldBytes: oldContent === null ? null : Buffer.from(oldContent),
      newBytes: newContent === null ? null : Buffer.from(newContent),
    },
  });

const createRepository = async () => {
  await mkdir(testRoot, { recursive: true });
  const root = await mkdtemp(join(testRoot, "patch-"));
  roots.push(root);
  await git(root, ["init", "-b", "main"]);
  return root;
};

const setIndex = async (root: string, file: string, content: string | null) => {
  await git(root, ["read-tree", "--empty"]);
  if (content !== null) {
    await writeFile(join(root, file), content);
    await git(root, ["add", "--", file]);
  }
};

const expectIndex = async (
  root: string,
  file: string,
  content: string | null,
) => {
  if (content === null) {
    expect(await git(root, ["ls-files", "-z"])).toBe("");
  } else {
    expect(await git(root, ["show", `:${file}`])).toBe(content);
  }
};

const applyBothWays = async ({
  diff,
  patch,
  forward,
  reverse,
}: {
  diff: GitDiff;
  patch: string;
  forward: string | null;
  reverse: string | null;
}) => {
  const root = await createRepository();
  const patchPath = join(root, "change.patch");
  await writeFile(patchPath, patch);
  await setIndex(root, diff.file, diff.oldContent);
  await git(root, [
    "apply",
    "--verbose",
    "--cached",
    "--unidiff-zero",
    patchPath,
  ]);
  await expectIndex(root, diff.file, forward);

  // Reverse starts from the complete target, not from our partially staged index.
  await setIndex(root, diff.file, diff.newContent);
  await git(root, [
    "apply",
    "--verbose",
    "--cached",
    "--unidiff-zero",
    "--reverse",
    patchPath,
  ]);
  await expectIndex(root, diff.file, reverse);
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("createGitPatch through git apply", () => {
  testCases.each([
    {
      name: "CRLF, context and no final newline",
      old: "same\r\nbefore\r\nlast",
      next: "same\r\nafter\r\nlast",
    },
    { name: "terminal newline only", old: "same", next: "same\n" },
    { name: "line ending only", old: "same\r\n", next: "same\n" },
    { name: "addition", old: null, next: "new\r\nlast" },
    { name: "deletion", old: "old\nlast", next: null },
    { name: "empty file insertion", old: "", next: "new\n" },
    { name: "empty file replacement", old: "old\n", next: "" },
  ])("preserves $name and quoted UTF-8 paths", async ({ old, next }) => {
    const diff = compare(
      old,
      next,
      'space tab\tnewline\nquote"slash\\café.txt',
      3,
    );
    await applyBothWays({
      diff,
      patch: createGitPatch({ diff }),
      forward: next,
      reverse: old,
    });
  });

  it("preserves captured context around a selected shifted hunk", async () => {
    const old = Array.from(
      { length: 24 },
      (_, index) => `line ${index + 1}\n`,
    ).join("");
    const next = old
      .replace("line 2\n", "early\nextra\n")
      .replace("line 20\n", "selected\n");
    const diff = compare(old, next, "file.txt", 3);
    expect(diff.hunks).toHaveLength(2);
    await applyBothWays({
      diff,
      patch: createGitPatch({ diff, hunks: [diff.hunks[1]!] }),
      forward: old.replace("line 20\n", "selected\n"),
      reverse: old.replace("line 2\n", "early\nextra\n"),
    });
  });

  testCases.each([
    {
      name: "omitted earlier insertion with repeated old and new lines",
      old: "start\nx\ny\nx\ny\nx\ny\nend\n",
      next: "start\nextra\nextra\nx\ny\ny\ny\nx\ny\nend\n",
      selected: [1, 2],
      forward: "start\nx\ny\ny\ny\nx\ny\nend\n",
      reverse: "start\nextra\nextra\nx\ny\nx\ny\nx\ny\nend\n",
    },
    {
      name: "omitted deletion before selected insertion and deletion",
      old: "start\nomit\nomit\na\nb\nc\nd\ne\nf\nend\n",
      next: "start\na\ninsert\nb\nc\nd\nf\nend\n",
      selected: [1, 2],
      forward: "start\nomit\nomit\na\ninsert\nb\nc\nd\nf\nend\n",
      reverse: "start\na\nb\nc\nd\ne\nf\nend\n",
    },
    {
      name: "selected insertion before omitted insertion and selected replacement",
      old: "start\na\nb\nc\nd\ne\nf\nend\n",
      next: "start\nselected\na\nb\nomitted\nc\nd\nE\nf\nend\n",
      selected: [0, 2],
      forward: "start\nselected\na\nb\nc\nd\nE\nf\nend\n",
      reverse: "start\na\nb\nomitted\nc\nd\ne\nf\nend\n",
    },
  ])("handles $name", async ({ old, next, selected, forward, reverse }) => {
    const diff = compare(old, next);
    expect(diff.hunks).toHaveLength(Math.max(...selected) + 1);
    // Copied hunks in caller order still emit in captured source order.
    const hunks = structuredClone(
      diff.hunks.filter((_, index) => selected.includes(index)),
    ).reverse();
    await applyBothWays({
      diff,
      patch: createGitPatch({ diff, hunks }),
      forward,
      reverse,
    });
  });
});

describe("createGitPatch validation", () => {
  testCases.each([
    {
      name: "binary",
      diff: { ...compare("a", "b"), binary: true },
      error: "binary",
    },
    {
      name: "absent",
      diff: { ...compare("a", "b"), oldContent: null, newContent: null },
      error: "absent on both sides",
    },
    {
      name: "rename",
      diff: { ...compare("a", "b"), previousPath: "before.txt" },
      error: "renamed files",
    },
    { name: "identical", diff: compare("a", "a"), error: "text changes" },
    { name: "empty addition", diff: compare(null, ""), error: "text changes" },
    { name: "empty deletion", diff: compare("", null), error: "text changes" },
  ])("rejects $name", ({ diff, error }) => {
    expect(() => createGitPatch({ diff })).toThrow(error);
  });

  it("rejects an empty, duplicate or foreign selection", () => {
    const diff = compare("before\n", "after\n");
    expect(() => createGitPatch({ diff, hunks: [] })).toThrow("text changes");
    expect(() =>
      createGitPatch({ diff, hunks: [diff.hunks[0]!, diff.hunks[0]!] }),
    ).toThrow("distinct hunks");
    expect(() =>
      createGitPatch({ diff, hunks: [{ ...diff.hunks[0]!, oldStart: 100 }] }),
    ).toThrow("supplied Git diff");
  });
});
