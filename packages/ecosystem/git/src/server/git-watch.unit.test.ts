import { afterEach, describe, expect, test as testCases, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  watchers: new Map<
    string,
    { close: ReturnType<typeof vi.fn>; listener: () => void }
  >(),
}));

vi.mock("node:fs", () => ({
  watch: vi.fn((path: string, _options: unknown, listener: () => void) => {
    const watcher = {
      close: vi.fn(),
      listener,
      on: vi.fn(),
    };
    mocks.watchers.set(path, watcher);
    return watcher;
  }),
}));

vi.mock("./git-execution", () => ({
  runGit: vi.fn(async (_root: string, args: string[]) => {
    const path =
      args.includes("--absolute-git-dir") || args.includes("--git-common-dir")
        ? "/repo/.git\n"
        : "";
    return { stderr: Buffer.alloc(0), stdout: Buffer.from(path) };
  }),
}));

import { watchGitRepository } from "./git-watch";
import { watch } from "node:fs";

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.watchers.clear();
});

describe("Git repository watcher", () => {
  testCases("recursively watches the worktree and Git metadata", async () => {
    vi.useFakeTimers();
    const invalidate = vi.fn();
    const repositoryWatcher = await watchGitRepository({
      debounceMs: 5,
      invalidate,
      root: "/repo",
    });

    expect(watch).toHaveBeenCalledWith(
      "/repo",
      { recursive: true },
      expect.any(Function),
    );
    expect(watch).toHaveBeenCalledWith(
      "/repo/.git",
      { recursive: true },
      expect.any(Function),
    );
    expect(mocks.watchers.size).toBe(2);

    mocks.watchers.get("/repo")?.listener();
    await vi.advanceTimersByTimeAsync(5);
    expect(invalidate).toHaveBeenCalledOnce();

    repositoryWatcher.dispose();
    expect(
      [...mocks.watchers.values()].every(
        ({ close }) => close.mock.calls.length > 0,
      ),
    ).toBe(true);
  });
});
