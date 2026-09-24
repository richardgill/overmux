import { describe, expect, it, vi } from "vitest";

import type { ZellijState } from "../shared/state-contract";
import type { ZellijBackend, ZellijReconciliation } from "./backend";
import { zellijOperationHandlers } from "./operations";

const state = {
  backend: { id: "test" },
  connected: true,
  sessions: [
    {
      name: "demo",
      tabs: [
        {
          info: { tab_id: 4 },
          panes: [{ id: 7, is_plugin: false }],
        },
      ],
    },
  ],
} as unknown as ZellijState;
const context = () => ({
  instance: {
    getInstanceId: () => "test",
    getDeepLinkPrefix: () => "overmux://test",
  },
  invalidate: () => undefined,
  notifications: { send: async () => undefined },
  signal: new AbortController().signal,
});
const setup = () => {
  const mutate = vi.fn(
    async (
      args: readonly string[],
      _reconciliation: ZellijReconciliation,
      _signal?: AbortSignal,
    ) =>
      args.includes("new-tab")
        ? "8\n"
        : args.includes("new-pane")
          ? "terminal_9\n"
          : "",
  );
  const backend = {
    mutate,
    read: vi.fn(async () => state),
  } as unknown as ZellijBackend;
  return { mutate, operations: zellijOperationHandlers({ backend }) };
};

describe("Zellij operations", () => {
  it("uses stable IDs, no-focus creation, and returns authoritative identities", async () => {
    const { mutate, operations } = setup();
    const tabInput = {
      command: ["sh", ""] as [string, ...string[]],
      cwd: "/work",
      name: "logs",
      sessionName: "demo",
    };

    expect(operations.createTab.input.parse(tabInput)).toEqual(tabInput);
    await expect(
      operations.createTab.handle(tabInput, context()),
    ).resolves.toEqual({
      created: { kind: "tab", tabId: 8 },
      outcome: "success",
    });
    await expect(
      operations.createPane.handle(
        {
          command: ["tail", "-f", "app.log"],
          floating: true,
          sessionName: "demo",
          tabId: 4,
        },
        context(),
      ),
    ).resolves.toEqual({
      created: { kind: "pane", pane: { id: 9, isPlugin: false } },
      outcome: "success",
    });
    expect(mutate).toHaveBeenNthCalledWith(
      1,
      [
        "--session",
        "demo",
        "action",
        "new-tab",
        "--no-focus",
        "--name",
        "logs",
        "--cwd",
        "/work",
        "--",
        "sh",
        "",
      ],
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(mutate).toHaveBeenNthCalledWith(
      2,
      [
        "--session",
        "demo",
        "action",
        "new-pane",
        "--tab-id",
        "4",
        "--no-focus",
        "--floating",
        "--",
        "tail",
        "-f",
        "app.log",
      ],
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it("maps every destructive and rename action without client-relative commands", async () => {
    const { mutate, operations } = setup();
    await operations.renameTab.handle(
      { name: "code", sessionName: "demo", tabId: 4 },
      context(),
    );
    await operations.closeTab.handle(
      { sessionName: "demo", tabId: 4 },
      context(),
    );
    await operations.closePane.handle(
      { pane: { id: 7, isPlugin: false }, sessionName: "demo" },
      context(),
    );
    await operations.renameSession.handle(
      { name: "renamed", sessionName: "demo" },
      context(),
    );
    await expect(
      operations.killSession.handle({ sessionName: "demo" }, context()),
    ).resolves.toEqual({ outcome: "success" });

    expect(mutate.mock.calls.map(([args]) => args)).toEqual([
      ["--session", "demo", "action", "rename-tab-by-id", "4", "code"],
      ["--session", "demo", "action", "close-tab-by-id", "4"],
      ["--session", "demo", "action", "close-pane", "--pane-id", "terminal_7"],
      ["--session", "demo", "action", "rename-session", "renamed"],
      ["kill-session", "demo"],
    ]);
    expect(mutate.mock.calls.flat(2)).not.toContain("focus");
    const killReconciliation = mutate.mock.calls[4]?.[1] as (
      output: string,
    ) => unknown;
    expect(killReconciliation("")).toBeUndefined();
  });

  it("returns not-found without mutating and reports disconnected state", async () => {
    const { mutate, operations } = setup();
    await expect(
      operations.closeTab.handle({ sessionName: "demo", tabId: 99 }, context()),
    ).resolves.toEqual({ outcome: "not-found" });
    expect(mutate).not.toHaveBeenCalled();
  });
});
