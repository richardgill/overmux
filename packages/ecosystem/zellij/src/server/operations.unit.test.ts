import { describe, expect, it, test as testCases, vi } from "vitest";

import type { ZellijState } from "../shared/state-contract";
import type { ZellijBackend, ZellijReconciliation } from "./backend";
import { zellijOperationHandlers } from "./operations";
import { runZellijCommand } from "./zellij-process";

vi.mock("./zellij-process", () => ({ runZellijCommand: vi.fn() }));

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
const setup = (currentState = state) => {
  const query = vi
    .mocked(runZellijCommand)
    .mockReset()
    .mockImplementation(async (args) =>
      JSON.stringify(
        args[1] === "demo"
          ? [{ id: 7, is_plugin: false, pane_cwd: "/source work" }]
          : [],
      ),
    );
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
    read: vi.fn(async () => currentState),
  } as unknown as ZellijBackend;
  return { mutate, operations: zellijOperationHandlers({ backend }), query };
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

  testCases.each([
    {
      name: "conflicting cwd",
      fromPane: { id: 7, isPlugin: false },
      cwd: "/work",
    },
    { name: "plugin source", fromPane: { id: 7, isPlugin: true } },
    { name: "negative pane ID", fromPane: { id: -1, isPlugin: false } },
    { name: "incomplete pane identity", fromPane: { id: 7 } },
  ])("rejects $name for source-pane creation", ({ name: _name, ...input }) => {
    const { operations } = setup();
    expect(
      operations.createTab.input.safeParse({ sessionName: "demo", ...input })
        .success,
    ).toBe(false);
  });

  testCases.each([
    { direction: "up", sessionName: "demo", tabId: 4 },
    { direction: "left", sessionName: "", tabId: 4 },
    { direction: "right", sessionName: "demo", tabId: -1 },
    { direction: "right", sessionName: "demo", tabId: 1.5 },
  ])("rejects invalid move input: $direction/$sessionName/$tabId", (input) => {
    expect(setup().operations.moveTab.input.safeParse(input).success).toBe(
      false,
    );
  });

  it("uses the source pane's reported cwd explicitly and keeps creation options", async () => {
    const { mutate, operations, query } = setup();
    const input = operations.createTab.input.parse({
      command: ["sh"],
      fromPane: { id: 7, isPlugin: false },
      name: "source",
      sessionName: "demo",
    });
    await expect(
      operations.createTab.handle(input, context()),
    ).resolves.toEqual({
      created: { kind: "tab", tabId: 8 },
      outcome: "success",
    });
    expect(query).toHaveBeenCalledWith(
      ["--session", "demo", "action", "list-panes", "--all", "--json"],
      expect.any(AbortSignal),
    );
    expect(mutate.mock.calls[0]?.[0]).toEqual([
      "--session",
      "demo",
      "action",
      "new-tab",
      "--no-focus",
      "--name",
      "source",
      "--cwd",
      "/source work",
      "--",
      "sh",
    ]);
  });

  testCases.each([undefined, ""])(
    "reports unavailable cwd (%s) without a fallback",
    async (pane_cwd) => {
      const { mutate, operations, query } = setup();
      query.mockResolvedValue(
        JSON.stringify([{ id: 7, is_plugin: false, pane_cwd }]),
      );
      await expect(
        operations.createTab.handle(
          {
            fromPane: { id: 7, isPlugin: false },
            sessionName: "demo",
          },
          context(),
        ),
      ).resolves.toEqual({
        message:
          "Working directory unavailable for terminal pane 7 in session demo",
        outcome: "error",
      });
      expect(mutate).not.toHaveBeenCalled();
    },
  );

  testCases.each([
    { name: "disappeared pane", panes: [] },
    {
      name: "plugin with the same numeric ID",
      panes: [{ id: 7, is_plugin: true }],
    },
  ])("returns not-found for $name in CLI metadata", async ({ panes }) => {
    const { mutate, operations, query } = setup();
    query.mockResolvedValue(JSON.stringify(panes));
    await expect(
      operations.createTab.handle(
        {
          fromPane: { id: 7, isPlugin: false },
          sessionName: "demo",
        },
        context(),
      ),
    ).resolves.toEqual({ outcome: "not-found" });
    expect(mutate).not.toHaveBeenCalled();
  });

  it("does not resolve a source pane or tab from another session", async () => {
    const otherSession = { name: "other", tabs: [] };
    const { mutate, operations } = setup({
      ...state,
      sessions: [...state.sessions, otherSession],
    });
    for (const sessionName of ["missing", "other"]) {
      await expect(
        operations.createTab.handle(
          {
            fromPane: { id: 7, isPlugin: false },
            sessionName,
          },
          context(),
        ),
      ).resolves.toEqual({ outcome: "not-found" });
      await expect(
        operations.moveTab.handle(
          {
            direction: "left",
            sessionName,
            tabId: 4,
          },
          context(),
        ),
      ).resolves.toEqual({ outcome: "not-found" });
    }
    await expect(
      operations.createTab.handle(
        {
          fromPane: { id: 99, isPlugin: false },
          sessionName: "demo",
        },
        context(),
      ),
    ).resolves.toEqual({ outcome: "not-found" });
    await expect(
      operations.moveTab.handle(
        {
          direction: "right",
          sessionName: "demo",
          tabId: 99,
        },
        context(),
      ),
    ).resolves.toEqual({ outcome: "not-found" });
    expect(mutate).not.toHaveBeenCalled();
  });

  it("returns not-found without mutating and reports disconnected state", async () => {
    const { mutate, operations } = setup();
    await expect(
      operations.closeTab.handle({ sessionName: "demo", tabId: 99 }, context()),
    ).resolves.toEqual({ outcome: "not-found" });
    expect(mutate).not.toHaveBeenCalled();
  });
});
