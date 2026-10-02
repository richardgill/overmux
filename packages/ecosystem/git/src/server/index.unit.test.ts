import { execFile } from "node:child_process";
import * as fs from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
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
import { afterEach, describe, expect, it, test as testCases, vi } from "vitest";
import { gitChangesResource, gitDiffResource } from "./index";
import {
  gitChangesSchema,
  gitFileChangeSchema,
  type GitComparison,
} from "../shared";

vi.mock("node:fs", { spy: true });
const watch = vi.mocked(fs.watch);
const exec = promisify(execFile);
const roots: string[] = [];
const disposers: (() => void | Promise<void>)[] = [];
const testRoot = fileURLToPath(
  new URL("../../../../../.test-tmp/", import.meta.url),
);
const context = (signal = new AbortController().signal) => ({
  logger: {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  },
  instance: {
    getInstanceId: () => "test",
    getDeepLinkPrefix: () => "overmux://test",
  },
  invalidate: vi.fn(),
  signal,
});

const watchCount = (path: string) =>
  watch.mock.calls.filter(([watchedPath]) => watchedPath === path).length;

const waitForDirectoryWatch = async (
  path: string,
  previousCount = 0,
  settle = true,
) => {
  await vi.waitFor(() =>
    expect(watchCount(path)).toBeGreaterThan(previousCount),
  );
  if (settle) {
    await new Promise<void>((resolve) => setTimeout(resolve, 400));
  }
};

const watcherFor = (path: string) => {
  const matches = watch.mock.results.filter(
    (_, index) => watch.mock.calls[index]?.[0] === path,
  );
  return matches[matches.length - 1]!.value as fs.FSWatcher;
};

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
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "initial"]);
  }
  return root;
};

const unstaged: GitComparison = {
  base: { kind: "index" },
  target: { kind: "workingTree" },
};
const staged: GitComparison = {
  base: { kind: "commit", ref: "HEAD" },
  target: { kind: "index" },
};
const combined: GitComparison = {
  base: { kind: "commit", ref: "HEAD" },
  target: { kind: "workingTree" },
};
const comparisons = { staged, unstaged, combined };

const input = (repoRoot: string) => ({ repoRoot, comparisons });

const readChanges = (repoRoot: string) =>
  gitChangesResource().read(input(repoRoot), context());
const readDiff = async (
  repoRoot: string,
  file: string,
  comparison: GitComparison = unstaged,
) => {
  const resource = gitDiffResource();
  return resource.read(
    resource.contract.input.parse({ repoRoot, file, comparison }),
    context(),
  );
};

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

describe("public named Git resources", () => {
  it("separates named comparisons, preserves cancellation, and hands live diffParams directly to the independent resource", async () => {
    const repoRoot = await createRepository();
    await writeFile(join(repoRoot, "file.txt"), "two\r\n");
    await git(repoRoot, ["add", "."]);
    await writeFile(join(repoRoot, "file.txt"), "one\n");
    const result = gitChangesSchema.parse(await readChanges(repoRoot));
    expect(result).not.toHaveProperty("changes");
    expect(
      gitChangesSchema.safeParse({ ...result, changes: result.comparisons })
        .success,
    ).toBe(false);
    const obsoleteInput = { ...input(repoRoot), detail: "full" };

    expect(() =>
      gitChangesResource().contract.input.parse(obsoleteInput),
    ).toThrow();

    expect(result.branch).toEqual({
      name: "main",
      upstream: null,
      ahead: 0,
      behind: 0,
      unborn: false,
    });
    expect(Object.keys(result.comparisons)).toEqual(Object.keys(comparisons));
    expect(result.comparisons.combined).toEqual([]);
    expect(result.comparisons.staged).toHaveLength(1);
    expect(result.comparisons.unstaged).toHaveLength(1);
    const change = result.comparisons.unstaged![0]!;
    expect(change).toMatchObject({
      path: "file.txt",
      lineStats: { added: 1, deleted: 1 },
    });
    expect(change).not.toHaveProperty("diff");
    expect(
      await gitDiffResource().read(change.diffParams, context()),
    ).toMatchObject({ oldContent: "two\r\n", newContent: "one\n" });
    await writeFile(join(repoRoot, "file.txt"), "latest");
    expect(
      await gitDiffResource().read(change.diffParams, context()),
    ).toMatchObject({ newContent: "latest" });
    await git(repoRoot, ["rm", "--cached", "-f", "file.txt"]);
    await writeFile(join(repoRoot, "file.txt"), "one\n");
    await git(repoRoot, ["config", "core.splitIndex", "true"]);
    const metadataBefore = await readdir(join(repoRoot, ".git"));
    const indexBefore = await readFile(join(repoRoot, ".git", "index"));
    const recreated = await readChanges(repoRoot);
    expect(await readdir(join(repoRoot, ".git"))).toEqual(metadataBefore);
    expect(await readFile(join(repoRoot, ".git", "index"))).toEqual(
      indexBefore,
    );
    expect(recreated.comparisons.combined).toEqual([]);
    expect(recreated.comparisons.staged![0]?.status).toBe("deleted");
    expect(recreated.comparisons.unstaged![0]?.status).toBe("untracked");
    expect((await git(repoRoot, ["ls-files"])).stdout).toBe("");
    const labels = ["__proto__", "constructor"];
    const named = await gitChangesResource().read(
      {
        repoRoot,
        comparisons: Object.fromEntries(
          labels.map((label) => [label, unstaged]),
        ),
      },
      context(),
    );
    expect(Object.keys(named.comparisons)).toEqual(labels);
    await expect(
      gitChangesResource().read(input(repoRoot), context(AbortSignal.abort())),
    ).rejects.toThrow();
  });

  testCases.each(["summary", "hunks", "full"] as const)(
    "returns only requested %s detail and preserves context zero",
    async (detailLevel) => {
      const repoRoot = await createRepository();
      await writeFile(join(repoRoot, "file.txt"), "one\ntwo\nthree\n");
      await git(repoRoot, ["add", "."]);
      await writeFile(join(repoRoot, "file.txt"), "one\nchanged\nthree\n");
      const result = await gitChangesResource().read(
        {
          repoRoot,
          comparisons: { custom: unstaged },
          detailLevel,
          contextLines: 0,
        },
        context(),
      );
      const change = result.comparisons.custom![0]!;
      expect(change.lineStats).toEqual({ added: 1, deleted: 1 });
      expect(change.diffParams.contextLines).toBe(0);
      if (detailLevel === "summary") {
        expect(change).not.toHaveProperty("diff");
      } else {
        expect(change.diff?.hunks[0]?.lines.map((line) => line.kind)).toEqual([
          "removed",
          "added",
        ]);
        if (detailLevel === "hunks") {
          expect(change.diff).not.toHaveProperty("oldContent");
        } else {
          expect(change.diff).toMatchObject({
            oldContent: "one\ntwo\nthree\n",
            newContent: "one\nchanged\nthree\n",
          });
        }
      }
      expect(
        (await readDiff(repoRoot, "file.txt")).hunks[0]?.lines.filter(
          (line) => line.kind === "context",
        ),
      ).toHaveLength(2);
    },
  );

  it("reads remote-tracking, tags, explicit merge bases and historical renames independently of index conflicts", async () => {
    const repoRoot = await createRepository();
    const original = Array.from(
      { length: 20 },
      (_, index) => `line ${index}\n`,
    ).join("");
    await writeFile(join(repoRoot, "file.txt"), original);
    await git(repoRoot, ["commit", "-am", "longer"]);
    await git(repoRoot, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    await git(repoRoot, ["tag", "base"]);
    await git(repoRoot, ["mv", "file.txt", "renamed.txt"]);
    const edited = original.replace("line 5\n", "edited five\n");
    await writeFile(join(repoRoot, "renamed.txt"), edited);
    await git(repoRoot, ["commit", "-am", "rename"]);
    const historical: GitComparison = {
      base: { kind: "commit", ref: "origin/main" },
      target: { kind: "commit", ref: "HEAD" },
    };
    const merge: GitComparison = {
      base: { kind: "mergeBase", refs: ["origin/main", "HEAD"] },
      target: { kind: "workingTree" },
    };
    const result = await gitChangesResource().read(
      { repoRoot, comparisons: { historical, merge }, detailLevel: "full" },
      context(),
    );
    expect(result.comparisons.historical![0]).toMatchObject({
      path: "renamed.txt",
      previousPath: "file.txt",
      status: "renamed",
      lineStats: { added: 1, deleted: 1 },
      diff: { oldContent: original, newContent: edited },
    });
    expect(result.comparisons.merge![0]?.previousPath).toBe("file.txt");
    expect(await readDiff(repoRoot, "file.txt", historical)).toMatchObject({
      oldContent: original,
      newContent: null,
    });
    expect(
      await readDiff(repoRoot, "file.txt", {
        base: { kind: "commit", ref: "base" },
        target: { kind: "commit", ref: "HEAD~1" },
      }),
    ).toMatchObject({ oldContent: original, newContent: original, hunks: [] });
    await git(repoRoot, ["checkout", "-b", "other", "base"]);
    await writeFile(join(repoRoot, "file.txt"), "other\n");
    await git(repoRoot, ["commit", "-am", "other"]);
    await git(repoRoot, ["checkout", "main"]);
    await expect(git(repoRoot, ["merge", "other"])).rejects.toThrow();
    expect((await readChanges(repoRoot)).comparisons.unstaged).toContainEqual(
      expect.objectContaining({ status: "conflicted", lineStats: null }),
    );
    expect(await readDiff(repoRoot, "renamed.txt", historical)).toMatchObject({
      newContent: edited,
    });
    await expect(
      gitChangesResource().read(
        { ...input(repoRoot), detailLevel: "hunks" },
        context(),
      ),
    ).rejects.toThrow("conflicted");
  });

  it("handles unborn and detached HEAD, rejects invalid refs and unavailable merge bases", async () => {
    const repoRoot = await createRepository(false);
    await writeFile(join(repoRoot, "new.txt"), "new\n");
    await git(repoRoot, ["add", "."]);
    expect((await readChanges(repoRoot)).branch).toMatchObject({
      name: "main",
      unborn: true,
    });
    expect(await readDiff(repoRoot, "new.txt", staged)).toMatchObject({
      oldContent: null,
      newContent: "new\n",
    });
    await expect(
      readDiff(repoRoot, "new.txt", {
        base: { kind: "commit", ref: "missing" },
        target: { kind: "index" },
      }),
    ).rejects.toThrow();
    await expect(
      readDiff(repoRoot, "new.txt", {
        base: { kind: "mergeBase", refs: ["HEAD", "HEAD"] },
        target: { kind: "index" },
      }),
    ).rejects.toThrow("existing commits");
    await git(repoRoot, ["commit", "-m", "first"]);
    await git(repoRoot, ["checkout", "--detach"]);
    expect((await readChanges(repoRoot)).branch).toMatchObject({
      name: null,
      unborn: false,
    });
    await git(repoRoot, ["checkout", "--orphan", "unrelated"]);
    await git(repoRoot, ["commit", "-m", "unrelated"]);
    await expect(
      readDiff(repoRoot, "new.txt", {
        base: { kind: "mergeBase", refs: ["main", "unrelated"] },
        target: { kind: "index" },
      }),
    ).rejects.toThrow();
  });

  it("keeps summary usable for binary, oversized and submodule entries, but fails unsupported detail", async () => {
    const repoRoot = await createRepository();
    await writeFile(join(repoRoot, "empty"), "");
    await writeFile(join(repoRoot, "binary"), Buffer.from([0, 1]));
    await writeFile(join(repoRoot, "invalid-utf8"), Buffer.from([255]));
    await writeFile(join(repoRoot, "large"), "text");
    await truncate(join(repoRoot, "large"), 20_000_000);
    const result = await readChanges(repoRoot);
    expect(result.comparisons.unstaged).toContainEqual(
      expect.objectContaining({ path: "large", binary: true, lineStats: null }),
    );
    expect(await readDiff(repoRoot, "empty")).toMatchObject({
      oldContent: null,
      newContent: "",
      hunks: [],
    });
    expect(await readDiff(repoRoot, "invalid-utf8")).toMatchObject({
      binary: true,
      oldContent: null,
      newContent: null,
      hunks: [],
    });
    await expect(readDiff(repoRoot, "large")).rejects.toThrow(
      "exceeded 16000000 bytes",
    );
    await expect(
      gitChangesResource().read(
        { ...input(repoRoot), detailLevel: "full" },
        context(),
      ),
    ).rejects.toThrow("exceeded 16000000 bytes");
    await git(repoRoot, ["add", "large"]);
    await expect(readDiff(repoRoot, "large", staged)).rejects.toThrow(
      "exceeded 16000000 bytes",
    );
    const gitObjectId = (
      await git(repoRoot, ["rev-parse", "HEAD"])
    ).stdout.trim();
    await git(repoRoot, [
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${gitObjectId},module`,
    ]);
    expect((await readChanges(repoRoot)).comparisons.staged).toContainEqual(
      expect.objectContaining({ path: "module", lineStats: null }),
    );
    await expect(readDiff(repoRoot, "module", staged)).rejects.toThrow(
      "submodules",
    );
    await expect(readDiff(repoRoot, "missing")).rejects.toThrow(
      "absent on both sides",
    );
  });

  it("authorizes canonical directories before discovery, excludes metadata and preserves final link text", async () => {
    const repoRoot = await createRepository();
    const outside = await createRepository();
    await expect(
      gitChangesResource({ allowedRoots: [outside] }).read(
        input(repoRoot),
        context(),
      ),
    ).rejects.toThrow("not authorized");
    await mkdir(join(repoRoot, "child"));
    await expect(readChanges(join(repoRoot, "child"))).rejects.toThrow(
      "not a child directory",
    );
    await symlink(outside, join(repoRoot, "escape"));
    await symlink(join(outside, "file.txt"), join(repoRoot, "link"));
    expect(await readDiff(repoRoot, "link")).toMatchObject({
      newContent: join(outside, "file.txt"),
    });
    await expect(readDiff(repoRoot, "escape/file.txt")).rejects.toThrow(
      "symlink directory",
    );
    await symlink(repoRoot, join(outside, "alias"));
    expect(
      (
        await gitChangesResource({ allowedRoots: [repoRoot] }).read(
          input(join(outside, "alias")),
          context(),
        )
      ).repoRoot,
    ).toBe(repoRoot);
    // Ambient overrides cannot redirect authorized commands into the other repo.
    vi.stubEnv("GIT_DIR", join(outside, ".git"));
    vi.stubEnv("GIT_WORK_TREE", outside);
    await git(repoRoot, ["config", "diff.external", "/does-not-exist"]);
    expect((await readChanges(repoRoot)).repoRoot).toBe(repoRoot);
    vi.unstubAllEnvs();
    const bare = join(testRoot, `bare-${Date.now()}`);
    roots.push(bare);
    await exec("git", ["init", "--bare", bare]);
    await expect(readChanges(bare)).rejects.toThrow();
  });

  testCases.each([
    "../secret",
    "/absolute",
    ".git/config",
    "a/../../secret",
    "a/./b",
    "a//b",
  ])("rejects unsafe path %s", async (file) => {
    await expect(readDiff(testRoot, file)).rejects.toThrow(
      "repository-relative",
    );
  });

  it("rejects empty comparisons, invalid roots, unsupported comparisons and partial full variants", () => {
    const entry = {
      path: "file",
      status: "modified",
      binary: false,
      lineStats: null,
      diffParams: { repoRoot: testRoot, file: "file", comparison: unstaged },
      diff: { hunks: [], oldContent: "partial" },
    };
    expect(gitFileChangeSchema.safeParse(entry).success).toBe(false);
    expect(() => gitChangesResource({ allowedRoots: [] })).toThrow();
    expect(() => gitChangesResource({ allowedRoots: ["relative"] })).toThrow();
    expect(
      gitChangesResource().contract.input.safeParse({
        repoRoot: testRoot,
        comparisons: {},
      }).success,
    ).toBe(false);
    expect(
      gitDiffResource().contract.input.safeParse({
        repoRoot: testRoot,
        file: "file",
        comparison: { base: { kind: "index" }, target: { kind: "index" } },
      }).success,
    ).toBe(false);
  });
});

describe("shared subscription lifecycle", () => {
  it("shares native handles, covers working files/index/refs, and closes only after the last subscriber", async () => {
    const repoRoot = await createRepository();
    const changes = gitChangesResource();
    const diff = gitDiffResource();
    const changed = vi.fn();
    const diffChanged = vi.fn();
    const stopChanges = await changes.subscribe(
      input(repoRoot),
      changed,
      context(),
    );
    const stopDiff = await diff.subscribe(
      { repoRoot, file: "file.txt", comparison: unstaged },
      diffChanged,
      context(),
    );
    disposers.push(stopChanges, stopDiff);
    await vi.waitFor(() => {
      expect(changed).toHaveBeenCalled();
      expect(diffChanged).toHaveBeenCalled();
    });
    expect(watch).toHaveBeenCalled();
    expect(watch.mock.calls.map(([path]) => path)).toContain(repoRoot);
    expect(watch.mock.calls.map(([path]) => path)).toContain(
      join(repoRoot, ".git"),
    );
    expect(watch.mock.calls.filter(([path]) => path === repoRoot)).toHaveLength(
      1,
    );
    const close = watch.mock.results.map((result) =>
      vi.spyOn(result.value as fs.FSWatcher, "close"),
    );
    changed.mockClear();
    diffChanged.mockClear();
    // Atomic replacement, followed by a new directory, both need native coverage.
    await writeFile(join(repoRoot, "replacement"), "two\n");
    await rename(join(repoRoot, "replacement"), join(repoRoot, "file.txt"));
    await vi.waitFor(() => {
      expect(changed).toHaveBeenCalled();
      expect(diffChanged).toHaveBeenCalled();
    });
    await stopChanges();
    expect(close.flatMap((spy) => spy.mock.calls)).toHaveLength(0);
    changed.mockClear();
    diffChanged.mockClear();
    await git(repoRoot, ["add", "."]);
    await vi.waitFor(() => expect(diffChanged).toHaveBeenCalled());
    expect(changed).not.toHaveBeenCalled();
    diffChanged.mockClear();
    await mkdir(join(repoRoot, "new-directory"));
    await vi.waitFor(() => expect(diffChanged).toHaveBeenCalled());
    await waitForDirectoryWatch(join(repoRoot, "new-directory"));
    diffChanged.mockClear();
    await mkdir(join(repoRoot, "new-directory", "deep"));
    await waitForDirectoryWatch(join(repoRoot, "new-directory", "deep"));
    diffChanged.mockClear();
    await writeFile(join(repoRoot, "new-directory", "deep", "new"), "new\n");
    await vi.waitFor(() => expect(diffChanged).toHaveBeenCalled());
    diffChanged.mockClear();
    const incoming = `${repoRoot}-incoming`;
    roots.push(incoming);
    await mkdir(join(incoming, "deep"), { recursive: true });
    await writeFile(join(incoming, "deep", "file"), "initial\n");
    await rename(incoming, join(repoRoot, "moved-in"));
    await vi.waitFor(() => expect(diffChanged).toHaveBeenCalled());
    await waitForDirectoryWatch(join(repoRoot, "moved-in", "deep"));
    diffChanged.mockClear();
    await writeFile(join(repoRoot, "moved-in", "deep", "file"), "later\n");
    await vi.waitFor(() => expect(diffChanged).toHaveBeenCalled());
    diffChanged.mockClear();
    await git(repoRoot, ["branch", "new-ref"]);
    await vi.waitFor(() => expect(diffChanged).toHaveBeenCalled());
    await stopDiff();
    expect(close.flatMap((spy) => spy.mock.calls)).toHaveLength(close.length);
  });

  it("updates native scope as ignore and tracked-directory rules change", async () => {
    const repoRoot = await createRepository();
    const ignored = join(repoRoot, "ignored", "nested");
    await mkdir(ignored, { recursive: true });
    await writeFile(join(repoRoot, ".gitignore"), "ignored/\n");
    await writeFile(join(ignored, "tracked.txt"), "one\n");
    const resource = gitChangesResource();
    const invalidate = vi.fn();
    disposers.push(
      await resource.subscribe(input(repoRoot), invalidate, context()),
    );
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(watchCount(join(repoRoot, "ignored"))).toBe(0);

    invalidate.mockClear();
    await git(repoRoot, ["add", "-f", "ignored/nested/tracked.txt"]);
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    await waitForDirectoryWatch(join(repoRoot, "ignored"));
    await waitForDirectoryWatch(ignored);
    invalidate.mockClear();
    await writeFile(join(ignored, "tracked.txt"), "two\n");
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());

    const ignoredWatcher = watcherFor(join(repoRoot, "ignored"));
    const closeIgnored = vi.spyOn(ignoredWatcher, "close");
    invalidate.mockClear();
    await git(repoRoot, ["rm", "--cached", "-f", "ignored/nested/tracked.txt"]);
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    await vi.waitFor(() => expect(closeIgnored).toHaveBeenCalled());

    const previousIgnoredWatches = watchCount(join(repoRoot, "ignored"));
    invalidate.mockClear();
    await rm(join(repoRoot, ".gitignore"));
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    await waitForDirectoryWatch(
      join(repoRoot, "ignored"),
      previousIgnoredWatches,
    );
    const deepWatcher = watcherFor(ignored);
    const closeDeep = vi.spyOn(deepWatcher, "close");
    invalidate.mockClear();
    await writeFile(join(ignored, "tracked.txt"), "three\n");
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());

    await rm(join(repoRoot, "ignored"), { force: true, recursive: true });
    await vi.waitFor(() => expect(closeDeep).toHaveBeenCalled());
  });

  it("does not catch up late subscribers after watcher readiness", async () => {
    const repoRoot = await createRepository();
    const resource = gitChangesResource();
    const firstInvalidated = vi.fn();
    const stopFirst = await resource.subscribe(
      input(repoRoot),
      firstInvalidated,
      context(),
    );
    disposers.push(stopFirst);
    await vi.waitFor(() => expect(firstInvalidated).toHaveBeenCalled());

    firstInvalidated.mockClear();

    const lateInvalidated = vi.fn();
    const stopLate = await resource.subscribe(
      input(repoRoot),
      lateInvalidated,
      context(),
    );
    disposers.push(stopLate);
    await Promise.resolve();
    expect(lateInvalidated).not.toHaveBeenCalled();

    await writeFile(join(repoRoot, "file.txt"), "changed\n");
    await vi.waitFor(() => expect(lateInvalidated).toHaveBeenCalled());
    expect(firstInvalidated).toHaveBeenCalled();
  });

  it("invalidates repeated same-size edits while Git status stays modified", async () => {
    const repoRoot = await createRepository();
    const resource = gitChangesResource();
    await writeFile(join(repoRoot, "Cargo.lock"), "first\n");
    await git(repoRoot, ["add", "Cargo.lock"]);
    await git(repoRoot, ["commit", "-m", "add lockfile"]);
    const invalidate = vi.fn();
    disposers.push(
      await resource.subscribe(input(repoRoot), invalidate, context()),
    );
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());

    invalidate.mockClear();
    await writeFile(join(repoRoot, "Cargo.lock"), "other\n");
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(
      (await resource.read(input(repoRoot), context())).comparisons.unstaged,
    ).toEqual([
      expect.objectContaining({ path: "Cargo.lock", status: "modified" }),
    ]);

    invalidate.mockClear();
    await writeFile(join(repoRoot, "Cargo.lock"), "third\n");
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(
      (await resource.read(input(repoRoot), context())).comparisons.unstaged,
    ).toEqual([
      expect.objectContaining({ path: "Cargo.lock", status: "modified" }),
    ]);
    expect(await readDiff(repoRoot, "Cargo.lock")).toMatchObject({
      newContent: "third\n",
    });
  });

  it("covers linked-worktree metadata outside the allowed root and reports current branch divergence", async () => {
    const main = await createRepository();
    const repoRoot = join(main, "linked");
    await git(main, ["worktree", "add", "-b", "linked", repoRoot]);
    const resource = gitChangesResource({ allowedRoots: [repoRoot] });
    const invalidate = vi.fn();
    disposers.push(
      await resource.subscribe(input(repoRoot), invalidate, context()),
    );
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect((await resource.read(input(repoRoot), context())).branch.name).toBe(
      "linked",
    );
    invalidate.mockClear();
    await git(main, ["branch", "shared-ref"]);
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    invalidate.mockClear();
    await writeFile(join(repoRoot, "file.txt"), "linked\n");
    await git(repoRoot, ["add", "."]);
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(await readDiff(repoRoot, "file.txt", staged)).toMatchObject({
      newContent: "linked\n",
    });
    await git(repoRoot, ["branch", "--set-upstream-to=main"]);
    await git(repoRoot, ["commit", "-m", "linked"]);
    expect((await readChanges(repoRoot)).branch).toMatchObject({
      upstream: "main",
      ahead: 1,
      behind: 0,
    });
  });

  it("prevents late attachment after cancellation during authorization", async () => {
    const repoRoot = await createRepository();
    const resource = gitChangesResource();
    const invalidate = vi.fn();
    const controller = new AbortController();
    const stopped = resource.subscribe(
      input(repoRoot),
      invalidate,
      context(controller.signal),
    );
    controller.abort();
    const stoppedCleanup = await stopped;
    await stoppedCleanup();
    // A successful read waits for the same authorization I/O the cancelled
    // subscriptions started, without relying on a timer-based startup guess.
    await resource.read(input(repoRoot), context());
    expect(watch).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    const stop = await resource.subscribe(
      input(repoRoot),
      invalidate,
      context(),
    );
    disposers.push(stop);
    await vi.waitFor(() => expect(watch).toHaveBeenCalled());
    await stop();
    invalidate.mockClear();
    await Promise.resolve();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("advances one periodic scan timer without postponing a pending event scan", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const schedule = vi.spyOn(globalThis, "setTimeout");
    try {
      const repoRoot = await createRepository();
      const invalidate = vi.fn();
      const stop = await gitChangesResource().subscribe(
        input(repoRoot),
        invalidate,
        context(),
      );
      disposers.push(stop);
      await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
      expect(vi.getTimerCount()).toBe(1);
      schedule.mockClear();

      // Deliver native notifications directly so their clock ordering is deterministic.
      watcherFor(repoRoot).emit("change", "rename", "new-directory");
      watcherFor(repoRoot).emit("change", "rename", "another-directory");
      expect(schedule.mock.calls.map(([, delay]) => delay)).toEqual([75, 250]);
      expect(vi.getTimerCount()).toBe(2);

      await stop();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      schedule.mockRestore();
      vi.useRealTimers();
    }
  });

  it("reconciles external excludes and missed same-status content events", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const repoRoot = await createRepository();
      const excludes = `${repoRoot}-global-excludes`;
      const includedConfig = `${repoRoot}-included-config`;
      roots.push(excludes, includedConfig);
      await mkdir(join(repoRoot, "externally-ignored"));
      await writeFile(excludes, "externally-ignored/\n");
      await writeFile(includedConfig, `[core]\n\texcludesFile = ${excludes}\n`);
      await git(repoRoot, ["config", "include.path", includedConfig]);
      const resource = gitChangesResource();
      const invalidate = vi.fn();
      disposers.push(
        await resource.subscribe(input(repoRoot), invalidate, context()),
      );
      await vi.waitFor(() => expect(watchCount(repoRoot)).toBe(1));
      expect(watchCount(join(repoRoot, "externally-ignored"))).toBe(0);

      watcherFor(repoRoot).close();
      await writeFile(excludes, "");
      await writeFile(join(repoRoot, "file.txt"), "two\n");
      await vi.advanceTimersByTimeAsync(30_000);
      await waitForDirectoryWatch(
        join(repoRoot, "externally-ignored"),
        0,
        false,
      );
      await vi.advanceTimersByTimeAsync(75);
      expect(
        (await resource.read(input(repoRoot), context())).comparisons.unstaged,
      ).toEqual([
        expect.objectContaining({ path: "file.txt", status: "modified" }),
      ]);

      await writeFile(join(repoRoot, "file.txt"), "one\n");
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.advanceTimersByTimeAsync(75);
      expect(await readDiff(repoRoot, "file.txt")).toMatchObject({
        newContent: "one\n",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  testCases.each(["error", "close"] as const)(
    "reinstalls a native handle after unexpected %s during shared reconciliation",
    async (event) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const repoRoot = await createRepository();
        const resource = gitChangesResource();
        const invalidate = vi.fn();
        disposers.push(
          await resource.subscribe(input(repoRoot), invalidate, context()),
        );
        await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
        const initialRootWatches = watchCount(repoRoot);
        const watcher = watcherFor(repoRoot);

        if (event === "error") {
          watcher.emit("error", new Error("ENOSPC"));
        } else {
          watcher.close();
        }
        await vi.advanceTimersByTimeAsync(30_000);
        await vi.waitFor(() =>
          expect(watchCount(repoRoot)).toBe(initialRootWatches + 1),
        );
        expect((await resource.read(input(repoRoot), context())).repoRoot).toBe(
          repoRoot,
        );
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("keeps authorization failures terminal until subscription cleanup", async () => {
    const repoRoot = await createRepository();
    const missingAllowedRoot = join(repoRoot, "missing-allowed-root");
    const resource = gitChangesResource({
      allowedRoots: [repoRoot, missingAllowedRoot],
    });
    const invalidate = vi.fn();
    const stop = await resource.subscribe(
      input(repoRoot),
      invalidate,
      context(),
    );
    disposers.push(stop);
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    await mkdir(missingAllowedRoot);
    await expect(resource.read(input(repoRoot), context())).rejects.toThrow(
      "resubscribe",
    );
    await stop();
    expect((await resource.read(input(repoRoot), context())).repoRoot).toBe(
      repoRoot,
    );
  });
});
