import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Repository } from "./repository";
import { collectWatchScope } from "./watch-scope";

vi.mock("node:fs/promises", { spy: true });
const opendir = vi.mocked(fs.opendir);
const exec = promisify(execFile);
const roots: string[] = [];
const testRoot = fileURLToPath(
  new URL("../../../../../.test-tmp/", import.meta.url),
);

const git = (root: string, args: string[]) =>
  exec("git", ["-C", root, ...args], {
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  });

const createRepository = async () => {
  await mkdir(testRoot, { recursive: true });
  const repoRoot = await mkdtemp(join(testRoot, "watch-scope-"));
  roots.push(repoRoot);
  await git(repoRoot, ["init", "-b", "main"]);
  await git(repoRoot, ["config", "user.email", "test@example.com"]);
  await git(repoRoot, ["config", "user.name", "Overmux Test"]);
  await writeFile(join(repoRoot, "tracked.txt"), "tracked\n");
  await git(repoRoot, ["add", "."]);
  await git(repoRoot, ["commit", "-m", "initial"]);
  return repoRoot;
};

const repository = (repoRoot: string): Repository => ({
  repoRoot,
  worktreeGitDir: join(repoRoot, ".git"),
  sharedGitDir: join(repoRoot, ".git"),
});

const collect = async (repoRoot: string) =>
  collectWatchScope(repository(repoRoot), new AbortController().signal);

const pathsOf = (scope: Map<string, "worktree" | "metadata">) => [
  ...scope.keys(),
];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
  vi.clearAllMocks();
});

describe("collectWatchScope", () => {
  it("watches eligible worktree directories without following symlinks", async () => {
    const repoRoot = await createRepository();
    await mkdir(join(repoRoot, "empty"));
    await mkdir(join(repoRoot, "nested", "deep"), { recursive: true });
    await writeFile(join(repoRoot, "nested", "deep", "file.txt"), "new\n");
    await symlink(join(repoRoot, "nested"), join(repoRoot, "linked"));

    const scope = await collect(repoRoot);
    const paths = pathsOf(scope);

    expect(scope.get(repoRoot)).toBe("worktree");
    expect(scope.get(join(repoRoot, "empty"))).toBe("worktree");
    expect(scope.get(join(repoRoot, "nested"))).toBe("worktree");
    expect(scope.get(join(repoRoot, "nested", "deep"))).toBe("worktree");
    expect(paths).not.toContain(join(repoRoot, "linked"));
    expect(scope.get(join(repoRoot, ".git"))).toBe("metadata");
  });

  it("keeps directory names that look like pathspecs or contain whitespace", async () => {
    const repoRoot = await createRepository();
    const names = [
      ":(glob)magic",
      "glob*?[x]",
      "line\nbreak",
      "tab\tname",
      "☃雪",
    ];
    await Promise.all(names.map((name) => mkdir(join(repoRoot, name))));

    const paths = pathsOf(await collect(repoRoot));
    names.forEach((name) => expect(paths).toContain(join(repoRoot, name)));
  });

  it("skips directories represented by submodule gitlinks", async () => {
    const repoRoot = await createRepository();
    await mkdir(join(repoRoot, "submodule", "nested"), { recursive: true });
    const { stdout } = await git(repoRoot, ["rev-parse", "HEAD"]);
    await git(repoRoot, [
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${stdout.trim()},submodule`,
    ]);

    expect(pathsOf(await collect(repoRoot))).not.toContain(
      join(repoRoot, "submodule"),
    );
  });

  it("prunes ignored-only trees before enumerating their descendants", async () => {
    const repoRoot = await createRepository();
    await writeFile(join(repoRoot, ".gitignore"), "ignored/\n");
    await mkdir(join(repoRoot, "ignored", "nested"), { recursive: true });
    opendir.mockClear();

    const scope = await collect(repoRoot);

    expect(pathsOf(scope)).not.toContain(join(repoRoot, "ignored"));
    expect(opendir.mock.calls.map(([path]) => path)).not.toContain(
      join(repoRoot, "ignored"),
    );
    expect(opendir.mock.calls.map(([path]) => path)).not.toContain(
      join(repoRoot, "ignored", "nested"),
    );
  });

  it("retains ignored ancestors containing tracked files", async () => {
    const repoRoot = await createRepository();
    await mkdir(join(repoRoot, "ignored", "nested"), { recursive: true });
    await writeFile(
      join(repoRoot, "ignored", "nested", "tracked.txt"),
      "one\n",
    );
    await git(repoRoot, ["add", "ignored/nested/tracked.txt"]);
    await git(repoRoot, ["commit", "-m", "tracked ignored file"]);
    await writeFile(join(repoRoot, ".gitignore"), "ignored/\n");
    await writeFile(join(repoRoot, "ignored", "untracked.txt"), "ignored\n");

    const tracked = await collect(repoRoot);
    expect(tracked.get(join(repoRoot, "ignored"))).toBe("worktree");
    expect(tracked.get(join(repoRoot, "ignored", "nested"))).toBe("worktree");

    await git(repoRoot, ["rm", "--cached", "ignored/nested/tracked.txt"]);
    const pruned = await collect(repoRoot);
    expect(pathsOf(pruned)).not.toContain(join(repoRoot, "ignored"));
    expect(pathsOf(pruned)).not.toContain(join(repoRoot, "ignored", "nested"));
  });

  it("applies repository, nested, and info exclude ignore rules", async () => {
    const repoRoot = await createRepository();
    await mkdir(join(repoRoot, "build", "kept"), { recursive: true });
    await mkdir(join(repoRoot, "nested", "generated"), { recursive: true });
    await mkdir(join(repoRoot, "excluded"));
    await writeFile(join(repoRoot, ".gitignore"), "/build/*\n!build/kept/\n");
    await writeFile(join(repoRoot, "nested", ".gitignore"), "generated/\n");
    await writeFile(join(repoRoot, ".git", "info", "exclude"), "excluded/\n");

    const scope = await collect(repoRoot);
    const paths = pathsOf(scope);

    expect(paths).toContain(join(repoRoot, "build"));
    expect(paths).toContain(join(repoRoot, "build", "kept"));
    expect(paths).not.toContain(join(repoRoot, "nested", "generated"));
    expect(paths).not.toContain(join(repoRoot, "excluded"));

    await writeFile(join(repoRoot, ".gitignore"), "");
    await writeFile(join(repoRoot, "nested", ".gitignore"), "");
    await writeFile(join(repoRoot, ".git", "info", "exclude"), "");
    const updated = pathsOf(await collect(repoRoot));
    expect(updated).toContain(join(repoRoot, "nested", "generated"));
    expect(updated).toContain(join(repoRoot, "excluded"));
  });

  it("applies global excludes configured through an included Git config", async () => {
    const repoRoot = await createRepository();
    const excludes = `${repoRoot}-global-excludes`;
    const includedConfig = `${repoRoot}-included-config`;
    roots.push(excludes, includedConfig);
    await mkdir(join(repoRoot, "globally-ignored"));
    await writeFile(excludes, "globally-ignored/\n");
    await writeFile(includedConfig, `[core]\n\texcludesFile = ${excludes}\n`);
    await git(repoRoot, ["config", "include.path", includedConfig]);

    expect(pathsOf(await collect(repoRoot))).not.toContain(
      join(repoRoot, "globally-ignored"),
    );

    await writeFile(excludes, "");
    expect(pathsOf(await collect(repoRoot))).toContain(
      join(repoRoot, "globally-ignored"),
    );
  });

  it("includes shallow Git configuration and all ref ancestors", async () => {
    const repoRoot = await createRepository();
    await mkdir(join(repoRoot, ".git", "refs", "heads", "topic"), {
      recursive: true,
    });
    await writeFile(
      join(repoRoot, ".git", "refs", "heads", "topic", "one"),
      "ref\n",
    );

    const scope = await collect(repoRoot);

    expect(scope.get(join(repoRoot, ".git"))).toBe("metadata");
    expect(scope.get(join(repoRoot, ".git", "info"))).toBe("metadata");
    expect(scope.get(join(repoRoot, ".git", "refs"))).toBe("metadata");
    expect(scope.get(join(repoRoot, ".git", "refs", "heads", "topic"))).toBe(
      "metadata",
    );
    expect(scope.has(join(repoRoot, ".git", "objects"))).toBe(false);
  });

  it("stops registering directories when cancelled during discovery", async () => {
    const repoRoot = await createRepository();
    const controller = new AbortController();
    const seen: string[] = [];

    await expect(
      collectWatchScope(repository(repoRoot), controller.signal, ({ path }) => {
        seen.push(path);
        controller.abort();
      }),
    ).rejects.toThrow();
    expect(seen).toHaveLength(1);
  });
});
