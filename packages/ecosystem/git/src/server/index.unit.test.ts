import { execFile } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  defineGitRepositories,
  gitOperationHandlers,
  gitSourceControlResource,
} from "./index";
import { gitChangeKey, type GitChange, type GitSourceControl } from "../shared";

const exec = promisify(execFile);
const roots: string[] = [];
const context = () => ({
  instance: {
    getInstanceId: () => "test",
    getDeepLinkPrefix: () => "overmux://test",
  },
  invalidate: vi.fn(),
  notifications: { send: async () => undefined },
  signal: new AbortController().signal,
});
const git = (root: string, args: string[]) =>
  exec("git", ["-C", root, ...args], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });

const createRepository = async () => {
  const root = await mkdtemp(join(tmpdir(), "overmux-git-"));
  roots.push(root);
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "Overmux Test"]);
  await writeFile(join(root, "file.txt"), "one\n");
  await git(root, ["add", "file.txt"]);
  await git(root, ["commit", "-m", "initial"]);
  return root;
};

const readSnapshot = async (
  repositories: ReturnType<typeof defineGitRepositories>,
  root: string,
  comparison: "base" | "uncommitted" = "uncommitted",
) =>
  gitSourceControlResource({ repositories }).read(
    { comparison, path: root },
    context(),
  );

const readPatch = ({
  change,
  changes,
}: {
  change: GitChange;
  changes: GitSourceControl;
}) => changes.diffs[gitChangeKey(change)];

const changeFor = (changes: GitSourceControl, path: string, area?: string) => {
  const change = changes.changes.find(
    (candidate) =>
      candidate.path === path &&
      (area === undefined || ("area" in candidate && candidate.area === area)),
  );
  if (!change) {
    throw new Error(`Missing Git change: ${path}`);
  }
  return change;
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
  vi.unstubAllEnvs();
});

describe("git plugin", () => {
  it("defaults watcher debounce to 75 ms and preserves overrides", () => {
    expect(
      defineGitRepositories({ allowedRoots: ["/tmp"] }).watchDebounceMs,
    ).toBe(75);
    expect(
      defineGitRepositories({
        allowedRoots: ["/tmp"],
        watch: { debounceMs: 15 },
      }).watchDebounceMs,
    ).toBe(15);
  });

  it("authorizes paths and returns complete uncommitted and base snapshots", async () => {
    const root = await createRepository();
    const base = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
    const repositories = defineGitRepositories({
      allowedRoots: [root],
      baseResolver: async () => base,
    });
    await writeFile(join(root, "file.txt"), "two\n");
    await writeFile(join(root, "untracked.txt"), "new\n");

    const uncommitted = await readSnapshot(repositories, root);
    expect(uncommitted).toMatchObject({
      changes: expect.arrayContaining([
        expect.objectContaining({
          area: "unstaged",
          deletions: 1,
          insertions: 1,
          path: "file.txt",
          status: "modified",
        }),
        expect.objectContaining({
          area: "unstaged",
          deletions: 0,
          insertions: 1,
          path: "untracked.txt",
          status: "untracked",
        }),
      ]),
      comparison: "uncommitted",
      root,
    });
    await expect(
      readPatch({
        change: changeFor(uncommitted, "file.txt"),
        changes: uncommitted,
      }),
    ).toMatchObject({
      newContent: "two\n",
      oldContent: "one\n",
      patch: expect.stringContaining("+two"),
      path: "file.txt",
    });
    await expect(
      readPatch({
        change: changeFor(uncommitted, "untracked.txt"),
        changes: uncommitted,
      }),
    ).toMatchObject({
      newContent: "new\n",
      oldContent: null,
      patch: expect.stringContaining("+new"),
      path: "untracked.txt",
    });
    const baseChanges = await readSnapshot(repositories, root, "base");
    expect(baseChanges).toMatchObject({
      changes: expect.arrayContaining([
        expect.objectContaining({ path: "file.txt", status: "modified" }),
        expect.objectContaining({ path: "untracked.txt", status: "untracked" }),
      ]),
      comparison: "base",
    });
    await expect(
      readPatch({
        change: changeFor(baseChanges, "untracked.txt"),
        changes: baseChanges,
      }),
    ).toMatchObject({
      newContent: "new\n",
      oldContent: null,
      patch: expect.stringContaining("+new"),
    });
    const denied = await createRepository();
    await expect(readSnapshot(repositories, denied)).rejects.toThrow(
      "not authorized",
    );
  });

  it("returns complete added and deleted file patches", async () => {
    const root = await createRepository();
    const repositories = defineGitRepositories({ allowedRoots: [root] });
    await rm(join(root, "file.txt"));
    await writeFile(join(root, "added.txt"), "added\n");
    await git(root, ["add", "--all"]);

    const changes = await readSnapshot(repositories, root);
    expect(changes).toMatchObject({
      changes: expect.arrayContaining([
        expect.objectContaining({ path: "added.txt", status: "added" }),
        expect.objectContaining({ path: "file.txt", status: "deleted" }),
      ]),
    });
    await expect(
      readPatch({
        change: changeFor(changes, "added.txt"),
        changes,
      }),
    ).toMatchObject({
      newContent: "added\n",
      oldContent: null,
      patch: expect.stringContaining("@@ -0,0 +1 @@"),
      path: "added.txt",
    });
    await expect(
      readPatch({
        change: changeFor(changes, "file.txt"),
        changes,
      }),
    ).toMatchObject({
      newContent: null,
      oldContent: "one\n",
      patch: expect.stringContaining("@@ -1 +0,0 @@"),
      path: "file.txt",
    });
  });

  it("compares the resolved base to mutable final worktree content", async () => {
    const root = await createRepository();
    const base = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
    const repositories = defineGitRepositories({
      allowedRoots: [root],
      baseResolver: async () => base,
    });
    await writeFile(join(root, "committed.txt"), "committed\n");
    await git(root, ["add", "committed.txt"]);
    await git(root, ["commit", "-m", "committed change"]);
    await writeFile(join(root, "file.txt"), "staged\n");
    await git(root, ["add", "file.txt"]);
    await writeFile(join(root, "file.txt"), "worktree\n");
    await writeFile(join(root, "untracked.txt"), "untracked\n");

    const before = await readSnapshot(repositories, root, "base");
    expect(before.changes.map(({ path }) => path).sort()).toEqual([
      "committed.txt",
      "file.txt",
      "untracked.txt",
    ]);
    expect(
      before.changes.filter(({ path }) => path === "file.txt"),
    ).toHaveLength(1);
    expect(before.changes.every((change) => change.area === undefined)).toBe(
      true,
    );
    await expect(
      readPatch({
        change: changeFor(before, "file.txt"),
        changes: before,
      }),
    ).toMatchObject({
      newContent: "worktree\n",
      oldContent: "one\n",
      patch: expect.stringContaining("+worktree"),
    });

    await writeFile(join(root, "file.txt"), "latest\n");
    const after = await readSnapshot(repositories, root, "base");
    expect(after.revision).not.toBe(before.revision);
    await expect(
      readPatch({
        change: changeFor(after, "file.txt"),
        changes: after,
      }),
    ).toMatchObject({ patch: expect.stringContaining("+latest") });
  });

  it("rejects outside paths before invoking Git and resolves file paths", async () => {
    const root = await createRepository();
    const outside = await mkdtemp(join(tmpdir(), "overmux-outside-"));
    const bin = await mkdtemp(join(tmpdir(), "overmux-git-bin-"));
    roots.push(outside, bin);
    const marker = join(bin, "called");
    const command = join(bin, "git");
    await writeFile(command, `#!/bin/sh\ntouch ${marker}\nexit 1\n`);
    await chmod(command, 0o755);
    vi.stubEnv("PATH", bin);
    const repositories = defineGitRepositories({ allowedRoots: [root] });

    await expect(readSnapshot(repositories, outside)).rejects.toThrow(
      "not authorized",
    );
    await expect(access(marker)).rejects.toThrow();
    vi.unstubAllEnvs();
    await expect(
      readSnapshot(repositories, join(root, "file.txt")),
    ).resolves.toMatchObject({ root });
  });

  it("stops its generation-owned watcher when the resource is disposed", async () => {
    const root = await createRepository();
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", "tracked.txt"), "one\n");
    await git(root, ["add", "nested/tracked.txt"]);
    await git(root, ["commit", "-m", "nested"]);
    const repositories = defineGitRepositories({
      allowedRoots: [root],
      watch: { debounceMs: 5 },
    });
    const changes = gitSourceControlResource({ repositories });
    let invalidations = 0;
    let resolveInvalidation: () => void = () => undefined;
    const waitForInvalidation = () =>
      new Promise<void>((resolve) => {
        resolveInvalidation = resolve;
      });
    const ready = waitForInvalidation();
    const dispose = changes.subscribe(
      { comparison: "uncommitted", path: root },
      () => {
        invalidations += 1;
        resolveInvalidation();
      },
      context(),
    );
    await ready;

    const worktreeInvalidation = waitForInvalidation();
    await writeFile(join(root, "nested", "tracked.txt"), "two\n");
    await worktreeInvalidation;
    const afterWorktree = invalidations;
    const discoveredDirectory = waitForInvalidation();
    await mkdir(join(root, "discovered"));
    await writeFile(join(root, "discovered", "new.txt"), "one\n");
    await discoveredDirectory;
    await readSnapshot(repositories, root);
    const nestedInvalidation = waitForInvalidation();
    await writeFile(join(root, "discovered", "new.txt"), "two\n");
    await nestedInvalidation;
    const metadataInvalidation = waitForInvalidation();
    await git(root, ["add", "nested/tracked.txt"]);
    await git(root, ["update-ref", "refs/heads/watcher", "HEAD"]);
    await metadataInvalidation;
    expect(invalidations).toBeGreaterThan(afterWorktree);
    dispose();
    const afterDispose = invalidations;
    await writeFile(join(root, "nested", "tracked.txt"), "three\n");
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(invalidations).toBe(afterDispose);
  });

  it("invalidates both stable comparison subscriptions from one watcher", async () => {
    const root = await createRepository();
    const base = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
    const repositories = defineGitRepositories({
      allowedRoots: [root],
      baseResolver: async () => base,
      watch: { debounceMs: 5 },
    });
    const sourceControl = gitSourceControlResource({ repositories });
    const uncommittedInvalidated = vi.fn();
    const baseInvalidated = vi.fn();
    let ready: () => void = () => undefined;
    const watcherReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const disposeUncommitted = sourceControl.subscribe(
      { comparison: "uncommitted", path: root },
      () => {
        uncommittedInvalidated();
        ready();
      },
      context(),
    );
    await watcherReady;
    const disposeBase = sourceControl.subscribe(
      { comparison: "base", path: root },
      baseInvalidated,
      context(),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    uncommittedInvalidated.mockClear();
    baseInvalidated.mockClear();

    await writeFile(join(root, "file.txt"), "three\n");
    await vi.waitFor(() => {
      expect(uncommittedInvalidated).toHaveBeenCalledOnce();
      expect(baseInvalidated).toHaveBeenCalledOnce();
    });
    disposeUncommitted();
    disposeBase();
  });

  it("distinguishes staged and unstaged patches and tracks binary files", async () => {
    const root = await createRepository();
    const repositories = defineGitRepositories({ allowedRoots: [root] });
    await writeFile(join(root, "rename me.txt"), "rename\n");
    await git(root, ["add", "rename me.txt"]);
    await git(root, ["commit", "-m", "fixtures"]);
    await writeFile(join(root, "space name.txt"), Buffer.from([0, 1, 2]));
    await git(root, ["add", "space name.txt"]);
    await git(root, ["mv", "rename me.txt", "renamed file.txt"]);
    await writeFile(join(root, "file.txt"), "staged\n");
    await git(root, ["add", "file.txt"]);
    await writeFile(join(root, "file.txt"), "unstaged\n");

    const changes = await readSnapshot(repositories, root);
    expect(changes.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ binary: true, path: "space name.txt" }),
        expect.objectContaining({
          path: "renamed file.txt",
          previousPath: "rename me.txt",
          status: "renamed",
        }),
        expect.objectContaining({
          area: "staged",
          insertions: 1,
          path: "file.txt",
        }),
        expect.objectContaining({
          area: "unstaged",
          insertions: 1,
          path: "file.txt",
        }),
      ]),
    );
    const binary = changeFor(changes, "space name.txt", "staged");
    await expect(readPatch({ change: binary, changes })).toMatchObject({
      binary: true,
      newContent: null,
      oldContent: null,
      patch: "",
    });
    expect(Object.keys(changes.diffs)).toHaveLength(changes.changes.length);

    await expect(
      readPatch({
        change: changeFor(changes, "file.txt", "staged"),
        changes,
      }),
    ).toMatchObject({
      newContent: "staged\n",
      oldContent: "one\n",
      patch: expect.stringContaining("+staged"),
    });
    await expect(
      readPatch({
        change: changeFor(changes, "file.txt", "unstaged"),
        changes,
      }),
    ).toMatchObject({
      newContent: "unstaged\n",
      oldContent: "staged\n",
      patch: expect.stringContaining("+unstaged"),
    });
    await expect(
      readPatch({
        change: changeFor(changes, "renamed file.txt"),
        changes,
      }),
    ).toMatchObject({
      newContent: "rename\n",
      oldContent: "rename\n",
      patch: expect.stringMatching(
        /diff --git a\/rename me\.txt b\/renamed file\.txt/,
      ),
    });
  });

  it("returns rename stats and patches for uncommitted and base comparisons", async () => {
    const root = await createRepository();
    await writeFile(
      join(root, "old name.txt"),
      "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n",
    );
    await git(root, ["add", "old name.txt"]);
    await git(root, ["commit", "-m", "rename fixture"]);
    const base = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
    const repositories = defineGitRepositories({
      allowedRoots: [root],
      baseResolver: async () => base,
    });

    await git(root, ["mv", "old name.txt", "new name.txt"]);
    await writeFile(
      join(root, "new name.txt"),
      "one\ntwo\nthree\nfour\nchanged\nsix\nseven\neight\nnine\nten\neleven\n",
    );
    await git(root, ["add", "--all"]);
    const uncommitted = await readSnapshot(repositories, root);
    const uncommittedRename = changeFor(uncommitted, "new name.txt");
    expect(uncommittedRename).toMatchObject({
      deletions: 1,
      insertions: 2,
      previousPath: "old name.txt",
      status: "renamed",
    });
    await expect(
      readPatch({
        change: uncommittedRename,
        changes: uncommitted,
      }),
    ).toMatchObject({
      patch: expect.stringContaining(
        "diff --git a/old name.txt b/new name.txt",
      ),
      previousPath: "old name.txt",
    });

    await git(root, ["commit", "-m", "rename"]);
    const baseChanges = await readSnapshot(repositories, root, "base");
    const baseRename = changeFor(baseChanges, "new name.txt");
    expect(baseRename).toMatchObject({
      deletions: 1,
      insertions: 2,
      previousPath: "old name.txt",
      status: "renamed",
    });
    await expect(
      readPatch({
        change: baseRename,
        changes: baseChanges,
      }),
    ).toMatchObject({
      patch: expect.stringContaining(
        "diff --git a/old name.txt b/new name.txt",
      ),
      previousPath: "old name.txt",
    });
  });

  it("returns ours and worktree contents for conflicts", async () => {
    const root = await createRepository();
    await git(root, ["switch", "-c", "incoming"]);
    await writeFile(join(root, "file.txt"), "incoming\n");
    await git(root, ["add", "file.txt"]);
    await git(root, ["commit", "-m", "incoming"]);
    await git(root, ["switch", "main"]);
    await writeFile(join(root, "file.txt"), "ours\n");
    await git(root, ["add", "file.txt"]);
    await git(root, ["commit", "-m", "ours"]);
    await expect(git(root, ["merge", "incoming"])).rejects.toThrow();
    const repositories = defineGitRepositories({ allowedRoots: [root] });

    const sourceControl = await readSnapshot(repositories, root);
    const conflict = changeFor(sourceControl, "file.txt", "conflict");
    expect(sourceControl.diffs[gitChangeKey(conflict)]).toMatchObject({
      binary: false,
      newContent: expect.stringContaining("<<<<<<< HEAD\nours\n"),
      oldContent: "ours\n",
    });
  });

  it("retries once when the repository changes during base generation", async () => {
    const root = await createRepository();
    const base = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(join(root, "file.txt"), "before\n");
    let resolutions = 0;
    const repositories = defineGitRepositories({
      allowedRoots: [root],
      baseResolver: async () => {
        resolutions += 1;
        if (resolutions === 2) {
          await writeFile(join(root, "file.txt"), "after\n");
        }
        return base;
      },
    });

    const snapshot = await readSnapshot(repositories, root, "base");
    const change = changeFor(snapshot, "file.txt");
    expect(resolutions).toBe(4);
    expect(snapshot.diffs[gitChangeKey(change)]?.patch).toContain("+after");
  });

  it("fails after one retry when the repository remains incoherent", async () => {
    const root = await createRepository();
    const base = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(join(root, "file.txt"), "version-0\n");
    let resolutions = 0;
    const repositories = defineGitRepositories({
      allowedRoots: [root],
      baseResolver: async () => {
        resolutions += 1;
        if (resolutions % 2 === 0) {
          await writeFile(join(root, "file.txt"), `version-${resolutions}\n`);
        }
        return base;
      },
    });

    await expect(readSnapshot(repositories, root, "base")).rejects.toThrow(
      "changed while building",
    );
    expect(resolutions).toBe(4);
  });

  it("returns revision-aware mutation outcomes and obeys permissions", async () => {
    const root = await createRepository();
    const repositories = defineGitRepositories({
      allowedRoots: [root],
      permissions: { discard: true, stage: true, unstage: true },
    });
    const operations = gitOperationHandlers({
      repositories,
      resourceId: "repositoryChanges",
    });
    type StageContext = Parameters<typeof operations.stage.handle>[1];
    expectTypeOf<
      Parameters<StageContext["invalidate"]>[0]
    >().toEqualTypeOf<"repositoryChanges">();
    const mutationContext = context();
    await writeFile(join(root, "file.txt"), "two\n");
    const before = await readSnapshot(repositories, root);

    await expect(
      operations.stage.handle(
        {
          changes: ["file.txt"],
          expectedRevision: before.revision,
          path: root,
        },
        mutationContext,
      ),
    ).resolves.toMatchObject({ outcome: "success" });
    expect(mutationContext.invalidate).toHaveBeenCalledExactlyOnceWith(
      "repositoryChanges",
      { comparison: "uncommitted", path: root },
    );
    await expect(
      operations.stage.handle(
        {
          changes: ["file.txt"],
          expectedRevision: before.revision,
          path: root,
        },
        mutationContext,
      ),
    ).resolves.toMatchObject({ outcome: "stale" });
    expect(mutationContext.invalidate).toHaveBeenCalledOnce();
    const staged = await readSnapshot(repositories, root);
    await expect(
      operations.unstage.handle(
        {
          changes: ["file.txt"],
          expectedRevision: staged.revision,
          path: root,
        },
        context(),
      ),
    ).resolves.toMatchObject({ outcome: "success" });

    await writeFile(join(root, "untracked.txt"), "temporary\n");
    const dirty = await readSnapshot(repositories, root);
    await writeFile(join(root, "untracked.txt"), "changed\n");
    await expect(
      operations.discard.handle(
        {
          changes: ["file.txt", "untracked.txt"],
          expectedRevision: dirty.revision,
          path: root,
        },
        context(),
      ),
    ).resolves.toMatchObject({ outcome: "stale" });
    const latestDirty = await readSnapshot(repositories, root);
    await expect(
      operations.discard.handle(
        {
          changes: ["file.txt", "untracked.txt"],
          expectedRevision: latestDirty.revision,
          path: root,
        },
        context(),
      ),
    ).resolves.toMatchObject({ outcome: "success" });
    await expect(readSnapshot(repositories, root)).resolves.toMatchObject({
      changes: [],
    });
  });

  it("mutates staged and unstaged versions of one path independently", async () => {
    const root = await createRepository();
    const repositories = defineGitRepositories({
      allowedRoots: [root],
      permissions: { discard: true, stage: true, unstage: true },
    });
    const operations = gitOperationHandlers({
      repositories,
      resourceId: "sourceControl",
    });
    await writeFile(join(root, "file.txt"), "staged\n");
    await git(root, ["add", "file.txt"]);
    await writeFile(join(root, "file.txt"), "unstaged\n");
    const before = await readSnapshot(repositories, root);

    await expect(
      operations.discard.handle(
        {
          changes: [{ area: "unstaged", path: "file.txt" }],
          expectedRevision: before.revision,
          path: root,
        },
        context(),
      ),
    ).resolves.toMatchObject({ outcome: "success" });
    const staged = await readSnapshot(repositories, root);
    expect(staged.changes).toEqual([
      expect.objectContaining({ area: "staged", path: "file.txt" }),
    ]);

    await writeFile(join(root, "file.txt"), "unstaged again\n");
    const mixed = await readSnapshot(repositories, root);
    await expect(
      operations.unstage.handle(
        {
          changes: [{ area: "staged", path: "file.txt" }],
          expectedRevision: mixed.revision,
          path: root,
        },
        context(),
      ),
    ).resolves.toMatchObject({ outcome: "success" });
    const unstaged = await readSnapshot(repositories, root);
    expect(unstaged.changes).toEqual([
      expect.objectContaining({ area: "unstaged", path: "file.txt" }),
    ]);
    await expect(
      operations.stage.handle(
        {
          changes: [{ area: "unstaged", path: "file.txt" }],
          expectedRevision: unstaged.revision,
          path: root,
        },
        context(),
      ),
    ).resolves.toMatchObject({ outcome: "success" });
  });

  it("returns safe mutation errors for denied, traversing, stale, and invalid requests", async () => {
    const root = await createRepository();
    const readOnly = defineGitRepositories({ allowedRoots: [root] });
    const deniedActions = gitOperationHandlers({
      repositories: readOnly,
      resourceId: "sourceControl",
    });
    await writeFile(join(root, "file.txt"), "two\n");
    const status = await readSnapshot(readOnly, root);
    await expect(
      deniedActions.stage.handle(
        {
          changes: ["file.txt"],
          expectedRevision: status.revision,
          path: root,
        },
        context(),
      ),
    ).resolves.toMatchObject({ outcome: "error" });

    const repositories = defineGitRepositories({
      allowedRoots: [root],
      permissions: { applyPatch: true, stage: true },
    });
    const operations = gitOperationHandlers({
      repositories,
      resourceId: "sourceControl",
    });
    const current = await readSnapshot(repositories, root);
    await expect(
      operations.stage.handle(
        {
          changes: ["../outside"],
          expectedRevision: current.revision,
          path: root,
        },
        context(),
      ),
    ).resolves.toMatchObject({ outcome: "error" });
    await writeFile(join(root, "file.txt"), "three\n");
    await expect(
      operations.applyPatch.handle(
        {
          expectedRevision: current.revision,
          patch: "not a patch",
          path: root,
        },
        context(),
      ),
    ).resolves.toMatchObject({ outcome: "stale" });
    const latest = await readSnapshot(repositories, root);
    await expect(
      operations.applyPatch.handle(
        { expectedRevision: latest.revision, patch: "not a patch", path: root },
        context(),
      ),
    ).resolves.toMatchObject({ outcome: "error" });
  });
});
