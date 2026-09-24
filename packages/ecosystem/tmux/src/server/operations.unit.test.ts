import { describe, expect, it, vi } from "vitest";

import type { TmuxState } from "../shared/state-contract";
import type { TmuxBackend } from "./backend";
import { tmuxOperations } from "./operations";

const state: TmuxState = {
  backend: { id: "test" },
  connected: true,
  hierarchy: {
    sessions: [
      {
        activeWindowId: "@1",
        id: "$1",
        name: "demo",
        windows: [
          {
            activePaneId: "%1",
            id: "@1",
            index: 0,
            name: "editor",
            panes: [
              {
                currentCommand: "vim",
                id: "%1",
                inCopyMode: false,
                index: 0,
                path: "/work",
                title: "editor",
              },
            ],
          },
        ],
      },
    ],
  },
};

const context = () => ({
  instance: {
    getInstanceId: () => "test",
    getDeepLinkPrefix: () => "overmux://test",
  },
  invalidate: () => undefined,
  notifications: { send: async () => undefined },
  signal: new AbortController().signal,
});

const setup = ({
  configPath,
  refresh = async () => state,
  reportedConfigFiles = "",
}: {
  configPath?: string;
  refresh?: TmuxBackend["refresh"];
  reportedConfigFiles?: string;
} = {}) => {
  const run = vi.fn(async (args: readonly string[]) =>
    args[0] === "display-message" ? reportedConfigFiles : "",
  );
  const backend: TmuxBackend = {
    ...(configPath ? { configPath } : {}),
    id: "test",
    refresh,
    run,
    socket: "test",
    state: () => state,
    subscribe: () => () => undefined,
    subscribeNotifications: () => () => undefined,
  };
  return { operations: tmuxOperations({ backend }), run };
};

describe("tmux operations", () => {
  it("validates explicit window and pane selection targets", async () => {
    const { operations, run } = setup();
    expect(
      await operations.selectTmuxWindow.handle(
        { sessionId: "$1", windowId: "@1" },
        context(),
      ),
    ).toEqual({ outcome: "success" });
    expect(
      await operations.selectTmuxPane.handle(
        { paneId: "%1", windowId: "@1" },
        context(),
      ),
    ).toEqual({ outcome: "success" });
    expect(run).toHaveBeenCalledWith(
      ["select-window", "-t", "$1:@1"],
      expect.any(AbortSignal),
    );
    expect(run).toHaveBeenCalledWith(
      ["select-pane", "-t", "%1"],
      expect.any(AbortSignal),
    );
  });

  it("uses an explicit config path as the reload override", async () => {
    const { operations, run } = setup({ configPath: "/work/custom.conf" });

    await expect(
      operations.reloadTmuxConfig.handle(undefined, context()),
    ).resolves.toEqual({ outcome: "success" });
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(
      ["source-file", "/work/custom.conf"],
      expect.any(AbortSignal),
    );
  });

  it("reloads reported config files in order and ignores missing candidates", async () => {
    const { operations, run } = setup({
      reportedConfigFiles:
        "/etc/tmux.conf,/home/test/.tmux.conf,/home/test/.config/tmux/tmux.conf\n",
    });

    await expect(
      operations.reloadTmuxConfig.handle(undefined, context()),
    ).resolves.toEqual({ outcome: "success" });
    expect(run.mock.calls.map(([args]) => args)).toEqual([
      ["display-message", "-p", "#{config_files}"],
      [
        "source-file",
        "-q",
        "/etc/tmux.conf",
        "/home/test/.tmux.conf",
        "/home/test/.config/tmux/tmux.conf",
      ],
    ]);
  });

  it("returns an error when tmux reports no config files", async () => {
    const { operations, run } = setup();

    await expect(
      operations.reloadTmuxConfig.handle(undefined, context()),
    ).resolves.toEqual({
      message: "Tmux server did not report any configuration files",
      outcome: "error",
    });
    expect(run).toHaveBeenCalledOnce();
  });

  it("returns an error result when move window refresh fails", async () => {
    const { operations, run } = setup({
      refresh: async () => {
        throw new Error("tmux is unavailable");
      },
    });

    await expect(
      operations.moveTmuxWindow.handle(
        { direction: "left", windowId: "@1" },
        context(),
      ),
    ).resolves.toEqual({ message: "tmux is unavailable", outcome: "error" });
    expect(run).not.toHaveBeenCalled();
  });
});
