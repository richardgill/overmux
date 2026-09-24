import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { nodePtyProcess, spawn } = vi.hoisted(() => ({
  nodePtyProcess: {
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
    pause: vi.fn(),
    resize: vi.fn(),
    resume: vi.fn(),
    write: vi.fn(),
  },
  spawn: vi.fn(),
}));

vi.mock("node-pty", () => ({ spawn }));

import { spawnPty } from "./index";

describe("PTY process", () => {
  it("publishes only an explicit server entry point", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(import.meta.dirname, "../package.json"), "utf8"),
    ) as { exports: Record<string, unknown> };

    expect(Object.keys(packageJson.exports)).toEqual(["./server"]);
  });

  beforeEach(() => {
    nodePtyProcess.write.mockReset();
    spawn.mockReset();
    spawn.mockReturnValue(nodePtyProcess);
  });

  it("spawns at the requested initial dimensions and terminal environment", () => {
    const result = spawnPty({
      args: ["attach", "-t", "session"],
      cols: 101,
      command: "tmux",
      cwd: "/work",
      env: { COLORTERM: "truecolor", TERM: "xterm-256color" },
      rows: 37,
    });

    expect(result).toBe(nodePtyProcess);
    const bytes = Buffer.from([0, 128, 255]);
    result.write(bytes);
    expect(nodePtyProcess.write).toHaveBeenCalledWith(bytes);
    expect(spawn).toHaveBeenCalledWith(
      "tmux",
      ["attach", "-t", "session"],
      expect.objectContaining({
        cols: 101,
        cwd: "/work",
        env: expect.objectContaining({
          COLORTERM: "truecolor",
          TERM: "xterm-256color",
        }),
        name: "xterm-256color",
        rows: 37,
      }),
    );
  });
});
