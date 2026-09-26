// Runs bounded, cancellable, non-interactive Git commands without a shell.
// Inherited Git overrides and configured executable helpers must not bypass authorization.
import { execFile } from "node:child_process";

export const MAX_CONTENT_BYTES = 16_000_000;

export class GitCommandError extends Error {
  constructor(
    readonly status: number,
    readonly stderr: Buffer,
  ) {
    super(`Git command failed (${status}): ${stderr.toString("utf8").trim()}`);
  }
}

export const runGit = (
  root: string,
  args: readonly string[],
  { signal, input }: { signal?: AbortSignal; input?: string } = {},
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    // GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE and injected config can redirect an
    // otherwise authorized command. Only our explicit Git environment is inherited.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    );
    const child = execFile(
      "git",
      [
        "--literal-pathspecs",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.askPass=",
        "-c",
        "diff.external=",
        "-c",
        "core.hooksPath=/dev/null",
        "-C",
        root,
        ...args,
      ],
      {
        encoding: "buffer",
        env: {
          ...env,
          GIT_OPTIONAL_LOCKS: "0",
          GIT_TERMINAL_PROMPT: "0",
          LC_ALL: "C",
        },
        maxBuffer: MAX_CONTENT_BYTES,
        timeout: 30_000,
        signal,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
        } else {
          reject(
            typeof error.code === "number"
              ? new GitCommandError(error.code, stderr)
              : error,
          );
        }
      },
    );
    // An aborted/failed process may close stdin before a supplied input is written.
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(input);
  });
