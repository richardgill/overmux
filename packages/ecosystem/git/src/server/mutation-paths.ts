import { isUtf8 } from "node:buffer";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { gitFileSchema } from "../shared";
import { runGit } from "./execution";
import {
  assertFileOutsideMetadata,
  isWithin,
  type Repository,
} from "./repository";

export const nulPaths = (output: Buffer) => {
  // Lossy decoding could validate a different path than Git actually uses,
  // especially when a quoted patch filename contains non-UTF-8 octal bytes.
  if (!isUtf8(output)) {
    throw new Error("Git mutation paths must use valid UTF-8");
  }
  return output.toString("utf8").split("\0").filter(Boolean);
};

export const validateMutationPaths = async (
  repository: Repository,
  files: readonly string[],
) => {
  for (const file of files) {
    gitFileSchema.parse(file);
    const path = join(repository.repoRoot, file);
    assertFileOutsideMetadata(repository, path);
    // A directory selection must not recursively include custom Git metadata.
    if (
      [repository.worktreeGitDir, repository.sharedGitDir].some((dir) =>
        isWithin(path, dir),
      )
    ) {
      throw new Error(`Git selection includes Git metadata: ${file}`);
    }
    const parts = file.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const parent = join(repository.repoRoot, ...parts.slice(0, index));
      const entry = await lstat(parent).catch(
        (error: NodeJS.ErrnoException) => {
          // Deleted files and even missing parent directories are valid Git targets.
          if (error.code === "ENOENT") {
            return undefined;
          }
          throw error;
        },
      );
      if (entry?.isSymbolicLink()) {
        throw new Error(
          `Git file cannot traverse a symlink directory: ${file}`,
        );
      }
    }
  }
};

export const validateFileSelections = async (
  repository: Repository,
  files: readonly string[],
  signal: AbortSignal,
) => {
  await validateMutationPaths(repository, files);
  // Git can expand a directory into many paths. Validate those too, including
  // tracked paths now hidden beneath a replacement directory symlink.
  const entries = await runGit(
    repository.repoRoot,
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...files,
    ],
    { signal },
  );
  await validateMutationPaths(repository, nulPaths(entries));
};

export const validatePatchPaths = async (
  repository: Repository,
  patch: string,
  signal: AbortSignal,
) => {
  // --numstat -z reports only the destination for renames/copies. Parsing in
  // BOTH directions exposes both concrete paths, including quoted/odd names.
  // These modes only inspect the patch, never apply it or enable unsafe paths.
  const outputs = await Promise.all(
    [false, true].map((reverse) =>
      runGit(
        repository.repoRoot,
        [
          "apply",
          "--cached",
          "--unidiff-zero",
          "--numstat",
          "-z",
          ...(reverse ? ["--reverse"] : []),
        ],
        { signal, input: patch },
      ),
    ),
  );
  const paths = outputs.flatMap((output) =>
    nulPaths(output).map((record) => {
      const match = /^(?:\d+|-)\t(?:\d+|-)\t([\s\S]+)$/.exec(record);
      if (!match) {
        throw new Error("Git could not identify a patch target");
      }
      return match[1]!;
    }),
  );
  if (paths.length === 0) {
    throw new Error("Git patch must contain at least one file change");
  }
  await validateMutationPaths(repository, [...new Set(paths)]);
};
