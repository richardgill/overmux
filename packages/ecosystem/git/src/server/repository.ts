// Authorizes canonical roots before discovery and reads current-checkout branch metadata.
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import type { GitBranch } from "../shared";
import { runGit } from "./execution";

export type Repository = {
  repoRoot: string;
  worktreeGitDir: string;
  sharedGitDir: string;
};
export const isWithin = (root: string, candidate: string) => {
  const path = relative(root, candidate);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
};
export const gitPath = (output: Buffer) =>
  output.toString("utf8").replace(/\n$/, "");
export const authorizeRepository = async ({
  repoRoot,
  allowedRoots,
  signal,
}: {
  repoRoot: string;
  allowedRoots: readonly string[];
  signal: AbortSignal;
}): Promise<Repository> => {
  signal.throwIfAborted();
  if (!isAbsolute(repoRoot)) {
    throw new Error("Git repoRoot must be absolute");
  }
  const [candidate, roots] = await Promise.all([
    realpath(repoRoot),
    Promise.all(
      allowedRoots.map(async (root) => {
        const canonical = await realpath(root);
        if (!(await stat(canonical)).isDirectory()) {
          throw new Error("Git allowedRoots must be directories");
        }
        return canonical;
      }),
    ),
  ]);
  if (!roots.some((root) => isWithin(root, candidate))) {
    throw new Error("Git repository is not authorized");
  }
  // Discovery only happens after authorization. A nested directory is not a root,
  // even when Git would happily search its ancestors for a repository.
  const actual = await realpath(
    gitPath(
      await runGit(candidate, ["rev-parse", "--show-toplevel"], { signal }),
    ),
  );
  if (actual !== candidate) {
    throw new Error(
      "Git repoRoot must be the repository root, not a child directory",
    );
  }
  const [worktreeGitDir, sharedGitDir] = await Promise.all([
    runGit(candidate, ["rev-parse", "--absolute-git-dir"], { signal }).then(
      async (path) => realpath(gitPath(path)),
    ),
    runGit(
      candidate,
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { signal },
    ).then(async (path) => realpath(gitPath(path))),
  ]);
  signal.throwIfAborted();
  return { repoRoot: candidate, worktreeGitDir, sharedGitDir };
};
export const assertFileOutsideMetadata = (
  repository: Repository,
  path: string,
) => {
  if (
    !isWithin(repository.repoRoot, path) ||
    [repository.worktreeGitDir, repository.sharedGitDir].some((root) =>
      isWithin(root, path),
    )
  ) {
    throw new Error(
      "Git file must stay inside the working tree and outside Git metadata",
    );
  }
};
export const readBranch = async ({
  repository,
  signal,
}: {
  repository: Repository;
  signal: AbortSignal;
}): Promise<GitBranch> => {
  const output = await runGit(
    repository.repoRoot,
    ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=no"],
    { signal },
  );
  const headers = new Map(
    output
      .toString("utf8")
      .split("\0")
      .flatMap((line) => {
        const match = /^# branch\.(\w+) (.*)$/.exec(line);
        return match ? [[match[1]!, match[2]!] as const] : [];
      }),
  );
  const name = headers.get("head");
  const counts = /^\+(\d+) -(\d+)$/.exec(headers.get("ab") ?? "");
  return {
    name: name === "(detached)" ? null : (name ?? null),
    upstream: headers.get("upstream") ?? null,
    ahead: Number(counts?.[1] ?? 0),
    behind: Number(counts?.[2] ?? 0),
    unborn: headers.get("oid") === "(initial)",
  };
};
