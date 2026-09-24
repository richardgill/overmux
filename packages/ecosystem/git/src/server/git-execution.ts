import { execFile } from "node:child_process";

export type GitExecutionOptions = {
  acceptedExitCodes?: readonly number[];
  input?: Buffer | string;
  signal?: AbortSignal;
};

export type GitOutput = {
  stderr: Buffer;
  stdout: Buffer;
};

export class GitCommandError extends Error {
  readonly status: number | null;
  readonly stderr: Buffer;

  constructor(status: number | null, stderr: Buffer) {
    super(
      `Git command failed with status ${status ?? "unknown"}: ${stderr.toString("utf8").trim()}`,
    );
    this.status = status;
    this.stderr = stderr;
  }
}

// Keep server-side Git non-interactive and prevent user-configured tools or optional locks from adding side effects.
const gitEnvironment = () => ({
  ...process.env,
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "core.askPass",
  GIT_CONFIG_KEY_1: "diff.external",
  GIT_CONFIG_VALUE_0: "",
  GIT_CONFIG_VALUE_1: "",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
});

export const runGit = (
  root: string,
  args: readonly string[],
  options: GitExecutionOptions = {},
): Promise<GitOutput> =>
  new Promise((resolve, reject) => {
    const acceptedExitCodes = options.acceptedExitCodes ?? [0];
    const child = execFile(
      "git",
      ["-C", root, ...args],
      {
        encoding: "buffer",
        env: gitEnvironment(),
        maxBuffer: 16_000_000,
        signal: options.signal,
      },
      (error, stdout, stderr) => {
        const output = { stderr, stdout };
        if (
          !error ||
          (typeof error.code === "number" &&
            acceptedExitCodes.includes(error.code))
        ) {
          resolve(output);
          return;
        }
        if (typeof error.code !== "number") {
          reject(error);
          return;
        }
        reject(new GitCommandError(error.code, output.stderr));
      },
    );
    child.stdin?.end(options.input);
  });
