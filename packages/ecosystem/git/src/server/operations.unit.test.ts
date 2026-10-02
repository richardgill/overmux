import { execFile } from "node:child_process";
import * as childProcess from "node:child_process";
import { setImmediate } from "node:timers/promises";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, test as testCases, vi } from "vitest";
import { gitChangesResource, gitOperationHandlers } from "./index";
import * as execution from "./execution";

vi.mock("./execution", { spy: true });
vi.mock("node:child_process", { spy: true });
const exec = promisify(execFile);
const testRoot = fileURLToPath(
  new URL("../../../../../.test-tmp/", import.meta.url),
);
const roots: string[] = [];
const disposers: (() => void)[] = [];
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
  notifications: { send: async () => undefined },
  invalidate: vi.fn(),
  signal,
});
const git = async (root: string, args: string[]) =>
  (
    await exec("git", ["-C", root, ...args], {
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    })
  ).stdout;
const createRepository = async (committed = true) => {
  await mkdir(testRoot, { recursive: true });
  const root = await mkdtemp(join(testRoot, "operations-"));
  roots.push(root);
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Test"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "commit.gpgsign", "false"]);
  await writeFile(join(root, "file.txt"), "one\ntwo\nthree\nfour\nfive\n");
  await writeFile(join(root, "other.txt"), "other\n");
  if (committed) {
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "initial"]);
  }
  return root;
};
const operations = (root: string) =>
  gitOperationHandlers({
    allowedRoots: [root],
    permissions: {
      stage: true,
      unstage: true,
      discard: true,
      applyIndexPatch: true,
    },
  });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const indexBytes = (root: string) => readFile(join(root, ".git/index"));
const patchFor = (file = "file.txt") =>
  `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-one\n+ONE\n`;
const applyPatch = (root: string, patch: string, reverse?: boolean) => {
  const operation = operations(root).applyIndexPatch;
  return operation.handle(
    operation.input.parse({ repoRoot: root, patch, reverse }),
    context(),
  );
};

afterEach(async () => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("public Git mutation handlers", () => {
  it("stages saved additions, modifications and deletions, then unstages only the selection without changing disk", async () => {
    const repoRoot = await createRepository();
    await writeFile(join(repoRoot, "file.txt"), "saved\n");
    await writeFile(join(repoRoot, "new.txt"), "new\n");
    await rm(join(repoRoot, "other.txt"));
    const handlers = operations(repoRoot);
    const ctx = context();
    const files = ["file.txt", "new.txt", "other.txt"];
    expect(await handlers.stage.handle({ repoRoot, files }, ctx)).toBeNull();
    expect(await git(repoRoot, ["diff", "--cached", "--name-status"])).toBe(
      "M\tfile.txt\nA\tnew.txt\nD\tother.txt\n",
    );

    await writeFile(join(repoRoot, "file.txt"), "newer saved\n");
    await handlers.unstage.handle(
      { repoRoot, files: ["file.txt", "other.txt"] },
      ctx,
    );
    expect(await git(repoRoot, ["diff", "--cached", "--name-only"])).toBe(
      "new.txt\n",
    );
    expect(await readFile(join(repoRoot, "file.txt"), "utf8")).toBe(
      "newer saved\n",
    );
    await expect(readFile(join(repoRoot, "other.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(ctx.invalidate).not.toHaveBeenCalled();
  });

  it("refuses unborn unstage without modifying the index or disk", async () => {
    const repoRoot = await createRepository(false);
    const handlers = operations(repoRoot);
    await handlers.stage.handle({ repoRoot, files: ["file.txt"] }, context());
    const before = await indexBytes(repoRoot);
    await expect(
      handlers.unstage.handle({ repoRoot, files: ["file.txt"] }, context()),
    ).rejects.toThrow(/HEAD/);
    expect(await indexBytes(repoRoot)).toEqual(before);
    expect(await readFile(join(repoRoot, "file.txt"), "utf8")).toContain("one");
  });

  it("discards from the index, restores missing tracked parents, and cleans only selected nonignored data", async () => {
    const repoRoot = await createRepository();
    await mkdir(join(repoRoot, "tracked"));
    await writeFile(join(repoRoot, "tracked/deleted.txt"), "restore me\n");
    await writeFile(join(repoRoot, ".gitignore"), "*.keep\n");
    await writeFile(join(repoRoot, "file.txt"), "staged\n");
    await git(repoRoot, ["add", "."]);
    await writeFile(join(repoRoot, "file.txt"), "unstaged\n");
    await rm(join(repoRoot, "tracked"), { recursive: true });
    await mkdir(join(repoRoot, "scratch"));
    await writeFile(join(repoRoot, "scratch/remove.txt"), "remove\n");
    await writeFile(join(repoRoot, "scratch/private.keep"), "keep\n");
    await writeFile(join(repoRoot, "remove.txt"), "remove\n");
    await writeFile(join(repoRoot, "unselected.txt"), "keep\n");

    await operations(repoRoot).discard.handle(
      {
        repoRoot,
        files: ["file.txt", "tracked/deleted.txt", "scratch", "remove.txt"],
      },
      context(),
    );
    expect(await readFile(join(repoRoot, "file.txt"), "utf8")).toBe("staged\n");
    expect(await readFile(join(repoRoot, "tracked/deleted.txt"), "utf8")).toBe(
      "restore me\n",
    );
    expect(await readFile(join(repoRoot, "scratch/private.keep"), "utf8")).toBe(
      "keep\n",
    );
    expect(await readFile(join(repoRoot, "unselected.txt"), "utf8")).toBe(
      "keep\n",
    );
    for (const file of ["scratch/remove.txt", "remove.txt"]) {
      await expect(readFile(join(repoRoot, file))).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
    // Git restore may refresh stat information, but must preserve all staged content.
    expect(await git(repoRoot, ["show", ":file.txt"])).toBe("staged\n");
    expect(await git(repoRoot, ["diff", "--cached", "--name-only"])).toBe(
      ".gitignore\nfile.txt\ntracked/deleted.txt\n",
    );
  });

  testCases.each(["unchanged", "staged-only", "ignored"])(
    "rejects a %s selection before discarding any files",
    async (kind) => {
      const repoRoot = await createRepository();
      await writeFile(join(repoRoot, "file.txt"), "keep unstaged\n");
      if (kind === "staged-only") {
        await writeFile(join(repoRoot, "other.txt"), "staged\n");
        await git(repoRoot, ["add", "other.txt"]);
      }
      if (kind === "ignored") {
        await writeFile(join(repoRoot, ".gitignore"), "ignored\n");
        await writeFile(join(repoRoot, "ignored"), "keep\n");
      }
      await expect(
        operations(repoRoot).discard.handle(
          {
            repoRoot,
            files: ["file.txt", kind === "ignored" ? "ignored" : "other.txt"],
          },
          context(),
        ),
      ).rejects.toThrow(/Cannot discard/);
      expect(await readFile(join(repoRoot, "file.txt"), "utf8")).toBe(
        "keep unstaged\n",
      );
    },
  );

  it("rejects conflicted discard as a batch but permits staging a saved resolution", async () => {
    const repoRoot = await createRepository();
    await git(repoRoot, ["checkout", "-b", "side"]);
    await writeFile(join(repoRoot, "file.txt"), "side\n");
    await git(repoRoot, ["commit", "-am", "side"]);
    await git(repoRoot, ["checkout", "main"]);
    await writeFile(join(repoRoot, "file.txt"), "main\n");
    await git(repoRoot, ["commit", "-am", "main"]);
    await expect(git(repoRoot, ["merge", "side"])).rejects.toThrow();
    await writeFile(join(repoRoot, "other.txt"), "keep unstaged\n");
    const handlers = operations(repoRoot);
    await expect(
      handlers.discard.handle(
        { repoRoot, files: ["other.txt", "file.txt"] },
        context(),
      ),
    ).rejects.toThrow(/resolve conflicts/);
    expect(await readFile(join(repoRoot, "other.txt"), "utf8")).toBe(
      "keep unstaged\n",
    );
    await writeFile(join(repoRoot, "file.txt"), "resolved\n");
    await handlers.stage.handle({ repoRoot, files: ["file.txt"] }, context());
    expect(await git(repoRoot, ["ls-files", "--unmerged"])).toBe("");
    expect(await git(repoRoot, ["show", ":file.txt"])).toBe("resolved\n");
  });

  it("stages and reverses one supplied zero-context hunk without touching disk, and rejects a stale patch atomically", async () => {
    const repoRoot = await createRepository();
    const disk = "ONE\ntwo\nthree\nfour\nFIVE\n";
    await writeFile(join(repoRoot, "file.txt"), disk);
    await applyPatch(repoRoot, patchFor());
    expect(await git(repoRoot, ["show", ":file.txt"])).toBe(
      "ONE\ntwo\nthree\nfour\nfive\n",
    );
    expect(await readFile(join(repoRoot, "file.txt"), "utf8")).toBe(disk);
    const before = await indexBytes(repoRoot);
    await expect(applyPatch(repoRoot, patchFor())).rejects.toThrow(
      /patch does not apply/,
    );
    expect(await indexBytes(repoRoot)).toEqual(before);
    await applyPatch(repoRoot, patchFor(), true);
    expect(await git(repoRoot, ["diff", "--cached"])).toBe("");
    expect(await readFile(join(repoRoot, "file.txt"), "utf8")).toBe(disk);
  });

  testCases.each(["stage", "unstage", "discard", "applyIndexPatch"] as const)(
    "denies %s by default",
    async (name) => {
      const repoRoot = await createRepository();
      const handler = gitOperationHandlers({ allowedRoots: [repoRoot] })[name];
      const before = await indexBytes(repoRoot);
      await expect(
        handler.handle(
          { repoRoot, files: ["file.txt"], patch: patchFor(), reverse: false },
          context(),
        ),
      ).rejects.toThrow(/disabled/);
      expect(await indexBytes(repoRoot)).toEqual(before);
    },
  );

  it("requires explicit nonempty mutation roots and rejects unauthorized repositories and unknown input keys", async () => {
    expect(() => gitOperationHandlers({ allowedRoots: [] })).toThrow();
    expect(() => gitOperationHandlers({} as never)).toThrow();
    const repoRoot = await createRepository();
    const elsewhere = await createRepository();
    const handler = operations(elsewhere).stage;
    await expect(
      handler.handle({ repoRoot, files: ["file.txt"] }, context()),
    ).rejects.toThrow(/not authorized/);
    expect(() => handler.input.parse({ repoRoot, files: [] })).toThrow();
    expect(() =>
      handler.input.parse({
        repoRoot,
        files: ["file.txt"],
        expectedRevision: "old",
      }),
    ).toThrow();
    expect(() =>
      operations(repoRoot).applyIndexPatch.input.parse({
        repoRoot,
        patch: patchFor(),
        unexpected: true,
      }),
    ).toThrow();
    expect(
      operations(repoRoot).applyIndexPatch.input.parse({
        repoRoot,
        patch: patchFor(),
      }).reverse,
    ).toBe(false);
  });

  testCases.each([
    "../escape",
    "/absolute",
    ".git/config",
    "dir/../file.txt",
    "link/file.txt",
  ])("rejects unsafe literal selection %s without mutation", async (file) => {
    const repoRoot = await createRepository();
    const outside = await createRepository();
    await symlink(outside, join(repoRoot, "link"));
    const before = await indexBytes(repoRoot);
    for (const handler of [
      operations(repoRoot).stage,
      operations(repoRoot).unstage,
      operations(repoRoot).discard,
    ]) {
      await expect(
        handler.handle({ repoRoot, files: [file] }, context()),
      ).rejects.toThrow();
    }
    expect(await indexBytes(repoRoot)).toEqual(before);
    expect(await readFile(join(outside, "file.txt"), "utf8")).toContain("one");
  });

  it("blocks custom metadata paths, enclosing directories, and patch targets", async () => {
    const repoRoot = await createRepository();
    await mkdir(join(repoRoot, "private"));
    await rename(join(repoRoot, ".git"), join(repoRoot, "private/metadata"));
    await writeFile(join(repoRoot, ".git"), "gitdir: private/metadata\n");
    const before = await readFile(join(repoRoot, "private/metadata/index"));
    for (const file of ["private", "private/metadata/config"]) {
      await expect(
        operations(repoRoot).stage.handle(
          { repoRoot, files: [file] },
          context(),
        ),
      ).rejects.toThrow(/metadata/);
      await expect(
        operations(repoRoot).discard.handle(
          { repoRoot, files: [file] },
          context(),
        ),
      ).rejects.toThrow(/metadata/);
    }
    await expect(
      applyPatch(repoRoot, patchFor("private/metadata/config")),
    ).rejects.toThrow(/metadata/);
    expect(await readFile(join(repoRoot, "private/metadata/index"))).toEqual(
      before,
    );
  });

  it("handles literal odd names and final symlinks as link text rather than following their targets", async () => {
    const repoRoot = await createRepository();
    const outside = await createRepository();
    const odd = "-:(glob)*\tline\nname.txt";
    await writeFile(join(repoRoot, odd), "one\n");
    await rm(join(repoRoot, "file.txt"));
    await symlink(join(outside, "file.txt"), join(repoRoot, "file.txt"));
    const handlers = operations(repoRoot);
    await handlers.stage.handle(
      { repoRoot, files: [odd, "file.txt"] },
      context(),
    );
    expect(await git(repoRoot, ["show", ":file.txt"])).toBe(
      join(outside, "file.txt"),
    );
    await writeFile(join(repoRoot, odd), "ONE\n");
    const patch = await git(repoRoot, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--unified=0",
    ]);
    await applyPatch(repoRoot, patch);
    expect(await git(repoRoot, ["show", `:${odd}`])).toBe("ONE\n");
    await rm(join(repoRoot, "file.txt"));
    await symlink("different-target", join(repoRoot, "file.txt"));
    await handlers.discard.handle({ repoRoot, files: ["file.txt"] }, context());
    expect(await git(repoRoot, ["diff", "--", "file.txt"])).toBe("");
    expect(await readFile(join(outside, "file.txt"), "utf8")).toContain("one");
  });

  testCases.each([
    { name: "traversal", old: "../escape", next: "file.txt" },
    { name: "metadata destination", old: "file.txt", next: ".git/config" },
    { name: "metadata source", old: ".git/config", next: "file.txt" },
    {
      name: "directory symlink source",
      old: "link/file.txt",
      next: "file.txt",
    },
    {
      name: "directory symlink destination",
      old: "file.txt",
      next: "link/file.txt",
    },
  ])(
    "rejects rename/copy $name in either direction without index changes",
    async ({ old, next }) => {
      const repoRoot = await createRepository();
      await symlink(repoRoot, join(repoRoot, "link"));
      const before = await indexBytes(repoRoot);
      for (const kind of ["rename", "copy"]) {
        const patch = `diff --git a/${old} b/${next}\nsimilarity index 100%\n${kind} from ${old}\n${kind} to ${next}\n`;
        for (const reverse of [false, true]) {
          await expect(applyPatch(repoRoot, patch, reverse)).rejects.toThrow();
          expect(await indexBytes(repoRoot)).toEqual(before);
        }
      }
    },
  );

  testCases.each(["rename", "copy"])(
    "applies a contained %s patch and preserves Git's reverse semantics",
    async (kind) => {
      const repoRoot = await createRepository();
      const patch = `diff --git a/file.txt b/new.txt\nsimilarity index 100%\n${kind} from file.txt\n${kind} to new.txt\n`;
      await applyPatch(repoRoot, patch);
      expect(await git(repoRoot, ["show", ":new.txt"])).toContain("one");
      if (kind === "rename") {
        await applyPatch(repoRoot, patch, true);
        expect(await git(repoRoot, ["diff", "--cached"])).toBe("");
      } else {
        // Git reverses the copy's paths, not its meaning: the original still
        // exists, so --reverse rejects rather than deleting the new copy.
        const before = await indexBytes(repoRoot);
        await expect(applyPatch(repoRoot, patch, true)).rejects.toThrow(
          /already exists/,
        );
        expect(await indexBytes(repoRoot)).toEqual(before);
      }
      expect(await readFile(join(repoRoot, "file.txt"), "utf8")).toContain(
        "one",
      );
    },
  );

  it("rejects quoted non-UTF-8 patch paths rather than validating a lossy filename", async () => {
    const repoRoot = await createRepository();
    const before = await indexBytes(repoRoot);
    const patch =
      'diff --git "a/link\\377/file.txt" "b/link\\377/file.txt"\nnew file mode 100644\n--- /dev/null\n+++ "b/link\\377/file.txt"\n@@ -0,0 +1 @@\n+new\n';
    await expect(applyPatch(repoRoot, patch)).rejects.toThrow(/UTF-8/);
    expect(await indexBytes(repoRoot)).toEqual(before);
  });

  it("ignores ambient Git redirection when staging", async () => {
    const repoRoot = await createRepository();
    const other = await createRepository();
    const before = await indexBytes(other);
    vi.stubEnv("GIT_DIR", join(other, ".git"));
    vi.stubEnv("GIT_WORK_TREE", other);
    vi.stubEnv("GIT_INDEX_FILE", join(other, ".git/index"));
    await writeFile(join(repoRoot, "file.txt"), "local\n");
    await operations(repoRoot).stage.handle(
      { repoRoot, files: ["file.txt"] },
      context(),
    );
    expect(await indexBytes(other)).toEqual(before);
    vi.unstubAllEnvs();
    expect(await git(repoRoot, ["show", ":file.txt"])).toBe("local\n");
  });

  it("serializes canonical roots across factories, survives failure, and skips cancelled queued work", async () => {
    const repoRoot = await createRepository();
    const alias = `${repoRoot}-alias`;
    roots.push(alias);
    await symlink(repoRoot, alias);
    await writeFile(join(repoRoot, "file.txt"), "saved\n");
    const entered = deferred();
    const release = deferred();
    const { runGit: realRunGit } =
      await vi.importActual<typeof execution>("./execution");
    const mutations: string[] = [];
    const authorized: AbortSignal[] = [];
    vi.mocked(execution.runGit).mockImplementation(
      async (root, args, options) => {
        if (args[0] === "add") {
          mutations.push(args.at(-1)!);
          if (args.at(-1) === "missing") {
            entered.resolve();
            await release.promise;
          }
        }
        const output = await realRunGit(root, args, options);
        if (args.includes("--git-common-dir") && options?.signal) {
          authorized.push(options.signal);
        }
        return output;
      },
    );
    const first = operations(repoRoot).stage.handle(
      { repoRoot, files: ["missing"] },
      context(),
    );
    const failed = expect(first).rejects.toThrow(/pathspec/);
    await entered.promise;
    const controller = new AbortController();
    const second = operations(repoRoot).stage.handle(
      { repoRoot: alias, files: ["other.txt"] },
      context(controller.signal),
    );
    const cancelled = expect(second).rejects.toThrow();
    const thirdContext = context();
    const third = operations(repoRoot).stage.handle(
      { repoRoot: alias, files: ["file.txt"] },
      thirdContext,
    );
    try {
      await vi.waitFor(() => {
        expect(authorized).toContain(controller.signal);
        expect(authorized).toContain(thirdContext.signal);
      });
      expect(mutations).toEqual(["missing"]);
      controller.abort();
    } finally {
      release.resolve();
    }
    await Promise.all([failed, cancelled, third]);
    expect(mutations).toEqual(["missing", "file.txt"]);
    expect(await git(repoRoot, ["show", ":file.txt"])).toBe("saved\n");
    await operations(repoRoot).unstage.handle(
      { repoRoot, files: ["file.txt"] },
      context(),
    );
    expect(await git(repoRoot, ["diff", "--cached"])).toBe("");
  });

  it("holds the mutation queue until a cancelled running Git process closes", async () => {
    const repoRoot = await createRepository();
    await writeFile(join(repoRoot, "other.txt"), "saved\n");
    const controller = new AbortController();
    const child = new childProcess.ChildProcess();
    const entered = deferred();
    const mutations: string[] = [];
    const { execFile: realExecFile } =
      await vi.importActual<typeof childProcess>("node:child_process");
    vi.mocked(childProcess.execFile).mockImplementation(
      (file, args, options, callback) => {
        if (args?.includes("add")) {
          mutations.push(args.at(-1)!);
          if (options?.signal === controller.signal) {
            // Node reports abort before the process exits and closes its stdio.
            controller.signal.addEventListener("abort", () => {
              callback?.(
                Object.assign(new Error("cancelled"), { name: "AbortError" }),
                Buffer.alloc(0),
                Buffer.alloc(0),
              );
            });
            entered.resolve();
            return child;
          }
        }
        return realExecFile(file, args, options, callback);
      },
    );
    const settled = vi.fn();
    const first = Promise.resolve(
      operations(repoRoot).stage.handle(
        { repoRoot, files: ["file.txt"] },
        context(controller.signal),
      ),
    );
    void first.then(settled, settled);
    const cancelled = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    await entered.promise;
    const second = operations(repoRoot).stage.handle(
      { repoRoot, files: ["other.txt"] },
      context(),
    );

    try {
      controller.abort();
      await setImmediate();
      expect(settled).not.toHaveBeenCalled();
      expect(mutations).toEqual(["file.txt"]);

      child.emit("exit", null, "SIGTERM");
      await setImmediate();
      expect(settled).not.toHaveBeenCalled();
      expect(mutations).toEqual(["file.txt"]);
    } finally {
      child.emit("close", null, "SIGTERM");
      await Promise.all([cancelled, second]);
    }
    expect(mutations).toEqual(["file.txt", "other.txt"]);
    expect(await git(repoRoot, ["show", ":other.txt"])).toBe("saved\n");
  });

  it("refreshes a subscribed resource through its watcher without operation invalidation", async () => {
    const repoRoot = await createRepository();
    await writeFile(join(repoRoot, "file.txt"), "saved\n");
    const resource = gitChangesResource({ allowedRoots: [repoRoot] });
    const input = {
      repoRoot,
      comparisons: {
        staged: {
          base: { kind: "commit" as const, ref: "HEAD" },
          target: { kind: "index" as const },
        },
      },
    };
    const invalidated = vi.fn();
    const subscription = new AbortController();
    const release = await resource.subscribe(
      input,
      invalidated,
      context(subscription.signal),
    );
    disposers.push(() => {
      subscription.abort();
      release();
    });
    expect((await resource.read(input, context())).comparisons.staged).toEqual(
      [],
    );
    // Consume the readiness refresh before checking a mutation-driven event.
    await vi.waitFor(() => expect(invalidated).toHaveBeenCalled(), {
      timeout: 5000,
    });
    invalidated.mockClear();
    const ctx = context();
    await operations(repoRoot).stage.handle(
      { repoRoot, files: ["file.txt"] },
      ctx,
    );
    await vi.waitFor(() => expect(invalidated).toHaveBeenCalled(), {
      timeout: 5000,
    });
    expect(
      (await resource.read(input, context())).comparisons.staged,
    ).toMatchObject([{ path: "file.txt" }]);
    expect(ctx.invalidate).not.toHaveBeenCalled();
  });
});
