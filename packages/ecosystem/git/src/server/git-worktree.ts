import { constants } from "node:fs";
import { lstat, open, readFile, readlink } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const resolveWorktreePath = (root: string, path: string) => {
  const absolute = resolve(root, path);
  const local = relative(root, absolute);
  if (local.startsWith(`..${sep}`) || local === ".." || isAbsolute(local)) {
    throw new Error("Git returned a path outside the repository");
  }
  return absolute;
};

export const safeWorktreeContent = async (root: string, path: string) => {
  const absolute = resolveWorktreePath(root, path);
  const stat = await lstat(absolute);
  return stat.isSymbolicLink()
    ? Buffer.from(await readlink(absolute))
    : await readFile(absolute);
};

// Untracked files exist only in the checked-out worktree, and Git excludes them
// from normal diff statistics, so derive their summary from worktree content.
export const untrackedStats = async (
  root: string,
  path: string,
  maxFileBytes: number,
) => {
  const absolute = resolveWorktreePath(root, path);
  const stat = await lstat(absolute);
  if (!stat.isSymbolicLink() && stat.size > maxFileBytes) {
    const handle = await open(
      absolute,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const sample = Buffer.alloc(Math.min(stat.size, 8_000));
      await handle.read(sample, 0, sample.byteLength, 0);
      return { binary: sample.includes(0) };
    } finally {
      await handle.close();
    }
  }
  const content = await safeWorktreeContent(root, path);
  const binary = content.includes(0);
  return {
    binary,
    deletions: 0,
    insertions: binary ? 0 : content.toString("utf8").split("\n").length - 1,
  };
};
