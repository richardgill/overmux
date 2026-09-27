import * as childProcess from "node:child_process";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, test as testCases, vi } from "vitest";
import { GitCommandError, runGit } from "./execution";

vi.mock("node:child_process", { spy: true });

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

testCases.each([
  { name: "success", error: null },
  {
    name: "Git failure",
    error: Object.assign(new Error("failed"), { code: 128 }),
  },
  {
    name: "timeout",
    error: Object.assign(new Error("timed out"), {
      killed: true,
      signal: "SIGTERM" as const,
    }),
  },
])(
  "preserves $name when the callback runs during close",
  async ({ name, error }) => {
    const child = new childProcess.ChildProcess();
    const stdin = new PassThrough();
    child.stdin = stdin;
    const stdout = Buffer.from([0, 255, 10]);
    const stderr = Buffer.from("failure details\n");
    vi.mocked(childProcess.execFile).mockImplementation(
      (_file, _args, options, callback) => {
        expect(options).toMatchObject({ timeout: 30_000, encoding: "buffer" });
        // execFile registers its close listener before runGit can register one.
        child.once("close", () => callback?.(error, stdout, stderr));
        return child;
      },
    );

    const result = runGit(process.cwd(), ["status"], { input: "patch bytes" });
    expect(stdin.read().toString()).toBe("patch bytes");
    stdin.emit("error", Object.assign(new Error("closed"), { code: "EPIPE" }));
    child.emit("close", error ? 128 : 0, null);

    if (error === null) {
      expect(await result).toBe(stdout);
    } else if (name === "Git failure") {
      await expect(result).rejects.toBeInstanceOf(GitCommandError);
      await expect(result).rejects.toMatchObject({
        status: 128,
        stderr,
        message: "Git command failed (128): failure details",
      });
    } else {
      await expect(result).rejects.toBe(error);
    }
  },
);

it("rejects an already aborted signal without spawning", async () => {
  const spawn = vi.mocked(childProcess.execFile);
  const reason = new Error("already cancelled");

  await expect(
    runGit(process.cwd(), ["status"], { signal: AbortSignal.abort(reason) }),
  ).rejects.toBe(reason);
  expect(spawn).not.toHaveBeenCalled();
});

it("settles a spawn failure that has no exit event", async () => {
  vi.stubEnv("PATH", "");

  await expect(runGit(process.cwd(), ["status"])).rejects.toMatchObject({
    code: "ENOENT",
    syscall: "spawn git",
  });
});

it("settles a synchronous spawn argument error without waiting for close", async () => {
  await expect(runGit(process.cwd(), ["\0"])).rejects.toMatchObject({
    code: "ERR_INVALID_ARG_VALUE",
  });
});
