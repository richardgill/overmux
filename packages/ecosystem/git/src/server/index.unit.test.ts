import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import * as chokidar from "chokidar";
import { afterEach, describe, expect, it, test as testCases, vi } from "vitest";

import { gitDiffResource, gitStatusResource } from "./index";
import { gitDiffSchema, gitStatusSchema, type GitComparison } from "../shared";

vi.mock("chokidar", { spy: true });
const watch = vi.mocked(chokidar.watch);
const exec = promisify(execFile);
const roots: string[] = [];
const disposers: (() => void | Promise<void>)[] = [];
const testRoot = fileURLToPath(
  new URL("../../../../../.test-tmp/", import.meta.url),
);
const context = (signal = new AbortController().signal) => ({
  instance: {
    getInstanceId: () => "test",
    getDeepLinkPrefix: () => "overmux://test",
  },
  invalidate: vi.fn(),
  signal,
});
const git = (root: string, args: string[]) =>
  exec("git", ["-C", root, ...args], {
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  });
const createRepository = async (committed = true) => {
  await mkdir(testRoot, { recursive: true });
  const root = await mkdtemp(join(testRoot, "git-"));
  roots.push(root);
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "Overmux Test"]);
  await git(root, ["config", "commit.gpgsign", "false"]);
  if (committed) {
    await writeFile(join(root, "file.txt"), "one\n");
    await git(root, ["add", "file.txt"]);
    await git(root, ["commit", "-m", "initial"]);
  }
  return root;
};
const indexToWorktree: GitComparison = {
  base: { kind: "index" },
  target: "workingTree",
};
const headToIndex: GitComparison = {
  base: { kind: "commit", ref: "HEAD" },
  target: "index",
};
const readStatus = (repoRoot: string) =>
  gitStatusResource({ allowedRoots: [repoRoot] }).read({ repoRoot }, context());
const readDiff = (
  repoRoot: string,
  file: string,
  comparison = indexToWorktree,
) =>
  gitDiffResource({ allowedRoots: [repoRoot] }).read(
    { repoRoot, file, comparison },
    context(),
  );

// Each test releases subscriptions before deleting repositories; otherwise the
// deliberate deletion would itself generate live invalidations for later tests.
afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("public Git resources against real repositories", () => {
  it("separates summaries from selected staged and working-tree contents", async () => {
    const repoRoot = await createRepository();
    await writeFile(join(repoRoot, "file.txt"), "two\r\n");
    await git(repoRoot, ["add", "file.txt"]);
    await writeFile(join(repoRoot, "file.txt"), "three");
    await writeFile(join(repoRoot, "empty.txt"), "");
    await writeFile(join(repoRoot, "binary"), Buffer.from([0, 1]));
    await writeFile(join(repoRoot, ":(glob)*\tname\n.txt"), "literal\n");

    const status = gitStatusSchema.parse(await readStatus(repoRoot));
    expect(status).toEqual({
      repoRoot,
      branch: {
        name: "main",
        upstream: null,
        ahead: 0,
        behind: 0,
        unborn: false,
      },
      changes: expect.arrayContaining([
        { path: "file.txt", status: "modified", area: "staged", binary: false },
        {
          path: "file.txt",
          status: "modified",
          area: "unstaged",
          binary: false,
        },
        {
          path: "empty.txt",
          status: "untracked",
          area: "unstaged",
          binary: false,
        },
        { path: "binary", status: "untracked", area: "unstaged", binary: true },
      ]),
    });
    expect(
      gitDiffSchema.parse(await readDiff(repoRoot, "file.txt", headToIndex)),
    ).toMatchObject({ oldContent: "one\n", newContent: "two\r\n" });
    expect(await readDiff(repoRoot, "file.txt")).toMatchObject({
      oldContent: "two\r\n",
      newContent: "three",
    });
    expect(await readDiff(repoRoot, "empty.txt")).toMatchObject({
      oldContent: null,
      newContent: "",
      hunks: [],
    });
    expect(await readDiff(repoRoot, "binary")).toMatchObject({
      binary: true,
      oldContent: null,
      newContent: null,
      hunks: [],
    });
    expect(await readDiff(repoRoot, ":(glob)*\tname\n.txt")).toMatchObject({
      oldContent: null,
      newContent: "literal\n",
    });
    await rm(join(repoRoot, "file.txt"));
    expect(await readDiff(repoRoot, "file.txt")).toMatchObject({
      oldContent: "two\r\n",
      newContent: null,
    });
    await git(repoRoot, ["add", "-u"]);
    expect(await readDiff(repoRoot, "file.txt", headToIndex)).toMatchObject({
      oldContent: "one\n",
      newContent: null,
    });
    await expect(readDiff(repoRoot, "missing")).rejects.toThrow(
      "absent on both sides",
    );
  });

  it("treats a replaced parent directory as a missing working-tree side", async () => {
    const repoRoot = await createRepository();
    await mkdir(join(repoRoot, "directory"));
    await writeFile(join(repoRoot, "directory", "child.txt"), "child\n");
    await git(repoRoot, ["add", "directory"]);
    await rm(join(repoRoot, "directory"), { recursive: true });
    await writeFile(join(repoRoot, "directory"), "now a file\n");

    expect(await readDiff(repoRoot, "directory/child.txt")).toMatchObject({
      oldContent: "child\n",
      newContent: null,
    });
  });

  it("keeps summaries bounded and binary classification faithful", async () => {
    const repoRoot = await createRepository();
    await writeFile(join(repoRoot, "large"), "text");
    await truncate(join(repoRoot, "large"), 20_000_000);
    await writeFile(join(repoRoot, "utf8-boundary"), `${"a".repeat(8191)}é`);
    await writeFile(join(repoRoot, "invalid-utf8"), Buffer.from([0xff]));

    expect((await readStatus(repoRoot)).changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "large", binary: true }),
        expect.objectContaining({ path: "utf8-boundary", binary: false }),
        expect.objectContaining({ path: "invalid-utf8", binary: true }),
      ]),
    );
    await expect(readDiff(repoRoot, "large")).rejects.toThrow(
      "exceeded 16000000 bytes",
    );
    expect(await readDiff(repoRoot, "invalid-utf8")).toMatchObject({
      binary: true,
      oldContent: null,
      newContent: null,
      hunks: [],
    });
  });

  it("does not run external diff, textconv or filesystem-monitor helpers", async () => {
    const repoRoot = await createRepository();
    await writeFile(join(repoRoot, ".gitattributes"), "*.txt diff=unsafe\n");
    await git(repoRoot, ["config", "diff.external", "/does-not-exist"]);
    await git(repoRoot, ["config", "diff.unsafe.textconv", "/does-not-exist"]);
    await git(repoRoot, ["config", "core.fsmonitor", "/does-not-exist"]);
    await writeFile(join(repoRoot, "file.txt"), "changed\n");

    expect((await readStatus(repoRoot)).changes).toContainEqual(
      expect.objectContaining({ path: "file.txt" }),
    );
    expect(await readDiff(repoRoot, "file.txt")).toMatchObject({
      oldContent: "one\n",
      newContent: "changed\n",
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      gitStatusResource({ allowedRoots: [repoRoot] }).read(
        { repoRoot },
        context(controller.signal),
      ),
    ).rejects.toThrow();
  });

  it("uses ordinary similarity-based renames independently for each comparison", async () => {
    const repoRoot = await createRepository();
    const original = Array.from(
      { length: 20 },
      (_, index) => `line ${index}\n`,
    ).join("");
    await writeFile(join(repoRoot, "file.txt"), original);
    await git(repoRoot, ["commit", "-am", "longer"]);
    await git(repoRoot, ["mv", "file.txt", "renamed.txt"]);
    const staged = original.replace("line 5\n", "edited five\n");
    await writeFile(join(repoRoot, "renamed.txt"), staged);
    await git(repoRoot, ["add", "renamed.txt"]);
    await writeFile(join(repoRoot, "renamed.txt"), `${staged}working\n`);

    expect((await readStatus(repoRoot)).changes).toEqual([
      {
        path: "renamed.txt",
        previousPath: "file.txt",
        area: "staged",
        status: "renamed",
        binary: false,
      },
      {
        path: "renamed.txt",
        area: "unstaged",
        status: "modified",
        binary: false,
      },
    ]);
    expect(await readDiff(repoRoot, "renamed.txt", headToIndex)).toMatchObject({
      previousPath: "file.txt",
      oldContent: original,
      newContent: staged,
    });
    expect(await readDiff(repoRoot, "file.txt", headToIndex)).toMatchObject({
      oldContent: original,
      newContent: null,
    });
    const unstaged = await readDiff(repoRoot, "renamed.txt");
    expect(unstaged).toMatchObject({
      oldContent: staged,
      newContent: `${staged}working\n`,
    });
    expect(unstaged.previousPath).toBeUndefined();
    expect(
      await readDiff(repoRoot, "renamed.txt", {
        base: { kind: "commit", ref: "main" },
        target: "workingTree",
      }),
    ).toMatchObject({
      previousPath: "file.txt",
      oldContent: original,
      newContent: `${staged}working\n`,
    });
  });

  it("handles unborn HEAD but never substitutes an empty base for other invalid refs", async () => {
    const repoRoot = await createRepository(false);
    await writeFile(join(repoRoot, "new.txt"), "new\n");
    await git(repoRoot, ["add", "new.txt"]);
    expect((await readStatus(repoRoot)).branch).toEqual({
      name: "main",
      upstream: null,
      ahead: 0,
      behind: 0,
      unborn: true,
    });
    expect(await readDiff(repoRoot, "new.txt", headToIndex)).toMatchObject({
      oldContent: null,
      newContent: "new\n",
    });
    expect(
      await readDiff(repoRoot, "new.txt", {
        ...headToIndex,
        target: "workingTree",
      }),
    ).toMatchObject({ oldContent: null, newContent: "new\n" });
    await expect(
      readDiff(repoRoot, "new.txt", {
        base: { kind: "commit", ref: "no-such-branch" },
        target: "index",
      }),
    ).rejects.toThrow("Git command failed");
    await git(repoRoot, ["commit", "-m", "first"]);
    await git(repoRoot, ["checkout", "--detach"]);
    expect((await readStatus(repoRoot)).branch).toMatchObject({
      name: null,
      unborn: false,
    });
  });

  it("retains upstream divergence and refuses conflicted/submodule diffs explicitly", async () => {
    const repoRoot = await createRepository();
    await git(repoRoot, ["branch", "upstream"]);
    await git(repoRoot, ["branch", "--set-upstream-to=upstream"]);
    await writeFile(join(repoRoot, "file.txt"), "main\n");
    await git(repoRoot, ["commit", "-am", "main"]);
    expect((await readStatus(repoRoot)).branch).toMatchObject({
      upstream: "upstream",
      ahead: 1,
      behind: 0,
    });
    await git(repoRoot, ["checkout", "upstream"]);
    await writeFile(join(repoRoot, "file.txt"), "other\n");
    await git(repoRoot, ["commit", "-am", "other"]);
    await git(repoRoot, ["checkout", "main"]);
    await expect(git(repoRoot, ["merge", "upstream"])).rejects.toThrow();
    expect((await readStatus(repoRoot)).changes).toContainEqual({
      path: "file.txt",
      area: "conflict",
      status: "modified",
      binary: false,
    });
    await expect(readDiff(repoRoot, "file.txt")).rejects.toThrow("conflicted");
    await git(repoRoot, ["merge", "--abort"]);
    const oid = (await git(repoRoot, ["rev-parse", "HEAD"])).stdout.trim();
    await git(repoRoot, [
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${oid},module`,
    ]);
    expect((await readStatus(repoRoot)).changes).toContainEqual(
      expect.objectContaining({ path: "module", binary: true }),
    );
    await expect(readDiff(repoRoot, "module", headToIndex)).rejects.toThrow(
      "submodules",
    );
  });

  it("canonicalizes access, refuses child roots and symlink traversal, but reads link target text", async () => {
    const repoRoot = await createRepository();
    const outside = await createRepository();
    const denied = gitStatusResource({ allowedRoots: [outside] });
    await expect(denied.read({ repoRoot }, context())).rejects.toThrow(
      "not authorized",
    );
    await mkdir(join(repoRoot, "child"));
    await expect(readStatus(join(repoRoot, "child"))).rejects.toThrow(
      "not a child directory",
    );
    await symlink(outside, join(repoRoot, "escape"));
    await symlink(join(outside, "file.txt"), join(repoRoot, "link"));
    expect(await readDiff(repoRoot, "link")).toMatchObject({
      oldContent: null,
      newContent: join(outside, "file.txt"),
    });
    await expect(readDiff(repoRoot, "escape/file.txt")).rejects.toThrow(
      "symlink directory",
    );
    await expect(
      gitStatusResource({ allowedRoots: [repoRoot] }).read(
        { repoRoot: join(repoRoot, "escape") },
        context(),
      ),
    ).rejects.toThrow("not authorized");
    await symlink(repoRoot, join(outside, "alias"));
    expect(
      (
        await gitStatusResource({ allowedRoots: [repoRoot] }).read(
          { repoRoot: join(outside, "alias") },
          context(),
        )
      ).repoRoot,
    ).toBe(repoRoot);
    // Ambient overrides cannot redirect authorized commands into the other repo.
    vi.stubEnv("GIT_DIR", join(outside, ".git"));
    vi.stubEnv("GIT_WORK_TREE", outside);
    expect((await readStatus(repoRoot)).changes).toContainEqual(
      expect.objectContaining({ path: "link" }),
    );
  });

  testCases.each([
    "../secret",
    "/absolute",
    ".git/config",
    "a/../../secret",
    "a/./b",
    "a//b",
  ])("rejects unsafe file %s before capture", async (file) => {
    const resource = gitDiffResource({ allowedRoots: [testRoot] });
    await expect(
      resource.read(
        { repoRoot: testRoot, file, comparison: indexToWorktree },
        context(),
      ),
    ).rejects.toThrow("repository-relative");
  });

  it("rejects unsupported comparisons and invalid allowed-root policies", () => {
    expect(() => gitStatusResource({ allowedRoots: [] })).toThrow();
    expect(() => gitStatusResource({ allowedRoots: ["relative"] })).toThrow();
    expect(
      gitDiffResource({ allowedRoots: [testRoot] }).contract.input.safeParse({
        repoRoot: testRoot,
        file: "file",
        comparison: { base: { kind: "index" }, target: "index" },
      }).success,
    ).toBe(false);
  });
});

describe("shared subscription lifecycle", () => {
  it("shares one watcher, refreshes after file/index/ref changes, and independently releases subscribers", async () => {
    const repoRoot = await createRepository();
    const status = gitStatusResource({ allowedRoots: [repoRoot] });
    const diff = gitDiffResource({ allowedRoots: [repoRoot] });
    const statusInvalidated = vi.fn();
    const diffInvalidated = vi.fn();
    const stopStatus = status.subscribe(
      { repoRoot },
      statusInvalidated,
      context(),
    );
    const stopDiff = diff.subscribe(
      { repoRoot, file: "file.txt", comparison: indexToWorktree },
      diffInvalidated,
      context(),
    );
    disposers.push(stopStatus, stopDiff);
    await vi.waitFor(() => {
      expect(statusInvalidated).toHaveBeenCalled();
      expect(diffInvalidated).toHaveBeenCalled();
    });
    expect(watch).toHaveBeenCalledTimes(1);
    const watcher = watch.mock.results[0]!.value as chokidar.FSWatcher;
    const close = vi.spyOn(watcher, "close");
    statusInvalidated.mockClear();
    diffInvalidated.mockClear();

    // Atomic replacement, followed by a new directory, both need native coverage.
    await writeFile(join(repoRoot, "replacement"), "two\n");
    await rename(join(repoRoot, "replacement"), join(repoRoot, "file.txt"));
    await vi.waitFor(() => {
      expect(statusInvalidated).toHaveBeenCalled();
      expect(diffInvalidated).toHaveBeenCalled();
    });
    expect(
      await diff.read(
        { repoRoot, file: "file.txt", comparison: indexToWorktree },
        context(),
      ),
    ).toMatchObject({ newContent: "two\n" });
    await stopStatus();
    expect(close).not.toHaveBeenCalled();
    statusInvalidated.mockClear();
    diffInvalidated.mockClear();
    await git(repoRoot, ["add", "file.txt"]);
    await vi.waitFor(() => expect(diffInvalidated).toHaveBeenCalled());
    expect(statusInvalidated).not.toHaveBeenCalled();
    diffInvalidated.mockClear();
    await mkdir(join(repoRoot, "new-directory"));
    await writeFile(join(repoRoot, "new-directory", "new.txt"), "new\n");
    await vi.waitFor(() => expect(diffInvalidated).toHaveBeenCalled());
    diffInvalidated.mockClear();
    await git(repoRoot, ["branch", "new-ref"]);
    await vi.waitFor(() => expect(diffInvalidated).toHaveBeenCalled());
    await stopDiff();
    expect(close).toHaveBeenCalledTimes(1);
    expect(watcher.closed).toBe(true);
  });

  it("watches linked-worktree HEAD/index and common refs outside allowedRoots", async () => {
    const main = await createRepository();
    const repoRoot = join(main, "linked");
    await git(main, ["worktree", "add", "-b", "linked", repoRoot]);
    const resource = gitStatusResource({ allowedRoots: [repoRoot] });
    const invalidate = vi.fn();
    disposers.push(resource.subscribe({ repoRoot }, invalidate, context()));
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect((await resource.read({ repoRoot }, context())).branch.name).toBe(
      "linked",
    );
    invalidate.mockClear();
    await git(main, ["branch", "shared-ref"]);
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    invalidate.mockClear();
    await writeFile(join(repoRoot, "file.txt"), "linked content\n");
    await git(repoRoot, ["add", "file.txt"]);
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(await readDiff(repoRoot, "file.txt", headToIndex)).toMatchObject({
      newContent: "linked content\n",
    });
    invalidate.mockClear();
    await git(repoRoot, ["checkout", "--detach"]);
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
  });

  it("does not attach after immediate disposal or abort, including a pending watcher traversal", async () => {
    const repoRoot = await createRepository();
    const resource = gitStatusResource({ allowedRoots: [repoRoot] });
    const invalidate = vi.fn();
    const aborted = new AbortController();
    const stop = resource.subscribe({ repoRoot }, invalidate, context());
    await stop();
    disposers.push(
      resource.subscribe({ repoRoot }, invalidate, context(aborted.signal)),
    );
    aborted.abort();
    // A successful read waits for the same authorization I/O the disposed
    // subscriptions started, without relying on a timer-based startup guess.
    await resource.read({ repoRoot }, context());
    expect(watch).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();

    const stopStarting = resource.subscribe(
      { repoRoot },
      invalidate,
      context(),
    );
    disposers.push(stopStarting);
    await vi.waitFor(() => expect(watch).toHaveBeenCalledTimes(1));
    const watcher = watch.mock.results[0]!.value as chokidar.FSWatcher;
    await stopStarting();
    invalidate.mockClear();
    watcher.emit("ready");
    expect(invalidate).not.toHaveBeenCalled();
    expect(watcher.closed).toBe(true);
  });

  it("surfaces watcher errors through reads and keeps denied policies out of the shared registry", async () => {
    const repoRoot = await createRepository();
    const outside = await createRepository();
    const resource = gitStatusResource({ allowedRoots: [repoRoot] });
    const invalidate = vi.fn();
    const stop = resource.subscribe({ repoRoot }, invalidate, context());
    disposers.push(stop);
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    const denied = gitStatusResource({ allowedRoots: [outside] });
    const deniedInvalidation = vi.fn();
    disposers.push(
      denied.subscribe({ repoRoot }, deniedInvalidation, context()),
    );
    await vi.waitFor(() => expect(deniedInvalidation).toHaveBeenCalled());
    await expect(denied.read({ repoRoot }, context())).rejects.toThrow(
      "not authorized",
    );
    expect((await resource.read({ repoRoot }, context())).repoRoot).toBe(
      repoRoot,
    );
    expect(watch).toHaveBeenCalledTimes(1);

    const watcher = watch.mock.results[0]!.value as chokidar.FSWatcher;
    invalidate.mockClear();
    watcher.emit("error", new Error("ENOSPC"));
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(watcher.closed).toBe(true);
    await expect(resource.read({ repoRoot }, context())).rejects.toThrow(
      "watcher failed",
    );
    await stop();
    const recovered = vi.fn();
    disposers.push(resource.subscribe({ repoRoot }, recovered, context()));
    await vi.waitFor(() => expect(recovered).toHaveBeenCalled());
    expect(watch).toHaveBeenCalledTimes(2);
    expect((await resource.read({ repoRoot }, context())).repoRoot).toBe(
      repoRoot,
    );
  });

  it("fails explicitly when the environment forces polling", async () => {
    const repoRoot = await createRepository();
    vi.stubEnv("CHOKIDAR_USEPOLLING", "true");
    const resource = gitStatusResource({ allowedRoots: [repoRoot] });
    const invalidate = vi.fn();
    disposers.push(resource.subscribe({ repoRoot }, invalidate, context()));
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    await expect(resource.read({ repoRoot }, context())).rejects.toThrow(
      "watcher failed",
    );
    expect(watch.mock.results[0]!.value.closed).toBe(true);
  });

  it("releases a subscription aborted reentrantly by a startup-error invalidation", async () => {
    const repoRoot = await createRepository();
    watch.mockImplementationOnce(() => {
      throw new Error("watch unavailable");
    });
    const resource = gitStatusResource({ allowedRoots: [repoRoot] });
    const controller = new AbortController();
    const invalidate = vi.fn(() => controller.abort());
    disposers.push(
      resource.subscribe({ repoRoot }, invalidate, context(controller.signal)),
    );
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect((await resource.read({ repoRoot }, context())).repoRoot).toBe(
      repoRoot,
    );
  });

  it("retains synchronous watcher-start failures until subscription release", async () => {
    const repoRoot = await createRepository();
    watch.mockImplementationOnce(() => {
      throw new Error("watch unavailable");
    });
    const resource = gitStatusResource({ allowedRoots: [repoRoot] });
    const invalidate = vi.fn();
    disposers.push(resource.subscribe({ repoRoot }, invalidate, context()));
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    await expect(resource.read({ repoRoot }, context())).rejects.toThrow(
      "watcher failed",
    );
    expect(await readFile(join(repoRoot, "file.txt"), "utf8")).toBe("one\n");
  });
});
