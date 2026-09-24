import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, test as testCases, vi } from "vitest";

import { createZellijBackend } from "./backend";

const tab = {
  active: true,
  active_swap_layout_name: "BASE",
  are_floating_panes_visible: true,
  display_area_columns: 80,
  display_area_rows: 24,
  has_bell_notification: false,
  is_flashing_bell: false,
  is_fullscreen_active: false,
  is_swap_layout_dirty: false,
  is_sync_panes_active: false,
  name: "Tab #1",
  other_focused_clients: [1],
  panes_to_hide: 0,
  position: 0,
  selectable_floating_panes_count: 0,
  selectable_tiled_panes_count: 1,
  tab_id: 0,
  viewport_columns: 80,
  viewport_rows: 22,
};

type FakeProcess = EventEmitter & {
  exitCode: number | null;
  kill: ReturnType<typeof vi.fn>;
  stderr: PassThrough;
  stdin: PassThrough;
  stdout: PassThrough;
};

const createProcess = (): FakeProcess => {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    stdout: new PassThrough(),
  }) as FakeProcess;
  child.kill = vi.fn((signal: NodeJS.Signals) => {
    if (child.exitCode !== null) {
      return false;
    }
    child.exitCode = 0;
    queueMicrotask(() => child.emit("exit", 0, signal));
    return true;
  });
  return child;
};

const snapshot = (connectionId: string, sequence: number, names: string[]) => ({
  connectionId,
  protocolVersion: 1,
  resurrectableSessions: [],
  sequence,
  sessions: names.map((name) => ({
    name,
    tabs: [{ info: tab, panes: [] }],
  })),
  type: "snapshot",
});
const emit = (child: FakeProcess, ...messages: unknown[]) =>
  child.stdout.write(
    `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
  );
const hello = (connectionId: string) => ({
  connectionId,
  pluginId: 4,
  pluginVersion: "0.0.1",
  protocolVersion: 1,
  type: "hello",
});
const completeStartup = (
  child: FakeProcess,
  connectionId: string,
  names: string[],
) =>
  queueMicrotask(() =>
    emit(child, hello(connectionId), snapshot(connectionId, 1, names)),
  );
const completeShutdown = (child: FakeProcess) => {
  let connectionId = "";
  child.stdin.on("data", (chunk: Buffer) => {
    const messages = chunk
      .toString("utf8")
      .trim()
      .split("\n")
      .map(
        (line) => JSON.parse(line) as { connectionId: string; type: string },
      );
    connectionId =
      messages.find((message) => message.type === "init")?.connectionId ??
      connectionId;
    if (
      messages.some((message) => message.type === "shutdown") &&
      child.exitCode === null
    ) {
      emit(child, { connectionId, protocolVersion: 1, type: "bye" });
      child.exitCode = 0;
      queueMicrotask(() => child.emit("exit", 0, null));
    }
  });
  child.stdin.on("finish", () => {
    if (child.exitCode === null) {
      child.exitCode = 0;
      queueMicrotask(() => child.emit("exit", 0, null));
    }
  });
};

const setup = ({
  cooperativeShutdown = true,
  listSessions = vi.fn(
    async (_signal?: AbortSignal) => ["alpha"] as readonly string[],
  ),
  runCommand = vi.fn(async () => ""),
  spawn,
}: {
  cooperativeShutdown?: boolean;
  listSessions?: ReturnType<
    typeof vi.fn<(signal?: AbortSignal) => Promise<readonly string[]>>
  >;
  runCommand?: ReturnType<
    typeof vi.fn<
      (args: readonly string[], signal?: AbortSignal) => Promise<string>
    >
  >;
  spawn?: (child: FakeProcess, connectionId: string, call: number) => void;
} = {}) => {
  const children: FakeProcess[] = [];
  const spawnPipe = vi.fn(({ connectionId }: { connectionId: string }) => {
    const child = createProcess();
    children.push(child);
    if (cooperativeShutdown) {
      completeShutdown(child);
    }
    spawn?.(child, connectionId, children.length);
    return child as never;
  });
  const backend = createZellijBackend(
    {},
    {
      listSessions,
      reconciliationTimeoutMs: 100,
      runCommand,
      spawnPipe,
      startupTimeoutMs: 100,
      uuid: () => `connection-${children.length + 1}`,
      verifyArtifact: async () => ({ artifactPath: "/installed/overmux.wasm" }),
    },
  );
  return { backend, children, listSessions, runCommand, spawnPipe };
};

describe("Zellij event-driven backend", () => {
  it("defaults its identity and publishes initial and repeated snapshots", async () => {
    const { backend, children, spawnPipe } = setup({
      spawn: (child, connectionId) =>
        completeStartup(child, connectionId, ["alpha"]),
    });
    const listener = vi.fn();
    const unsubscribe = backend.subscribe(listener);

    await expect(backend.read()).resolves.toMatchObject({
      backend: { id: "zellij" },
      connected: true,
      sessions: [{ name: "alpha" }],
    });
    emit(children[0]!, snapshot("connection-1", 2, ["alpha", "beta"]));
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));
    expect(backend.state().sessions.map((session) => session.name)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(spawnPipe).toHaveBeenCalledOnce();

    unsubscribe();
    await backend.close();
  });

  it("cancels only one concurrent startup reader", async () => {
    const { backend, children } = setup();
    const firstController = new AbortController();
    const secondController = new AbortController();
    const firstRead = backend.read(firstController.signal);
    const secondRead = backend.read(secondController.signal);
    await vi.waitFor(() => expect(children).toHaveLength(1));

    firstController.abort(new Error("first caller left"));

    await expect(firstRead).rejects.toThrow("first caller left");
    expect(children[0]!.exitCode).toBeNull();
    completeStartup(children[0]!, "connection-1", ["alpha"]);
    await expect(secondRead).resolves.toMatchObject({ connected: true });
    await backend.close();
  });

  it("cancels shared startup when its final reader or subscriber leaves", async () => {
    const { backend, children } = setup();
    const controller = new AbortController();
    const reading = backend.read(controller.signal);
    const unsubscribe = backend.subscribe(() => undefined);
    await vi.waitFor(() => expect(children).toHaveLength(1));

    controller.abort(new Error("reader left"));
    await expect(reading).rejects.toThrow("reader left");
    expect(children[0]!.exitCode).toBeNull();

    unsubscribe();
    await vi.waitFor(() => expect(children[0]!.exitCode).toBe(0));
  });

  testCases.each([{ owner: "read" }, { owner: "subscription" }])(
    "does not restart when a cancelled $owner arrives during shutdown",
    async ({ owner }) => {
      const { backend, children, spawnPipe } = setup({
        cooperativeShutdown: false,
        spawn: (child, connectionId) =>
          completeStartup(child, connectionId, ["alpha"]),
      });
      await backend.read();
      const closing = backend.close();
      const controller = new AbortController();
      const pendingRead =
        owner === "read" ? backend.read(controller.signal) : undefined;
      const unsubscribe =
        owner === "subscription"
          ? backend.subscribe(() => undefined)
          : undefined;

      if (pendingRead) {
        controller.abort(new Error("owner left"));
        await expect(pendingRead).rejects.toThrow("owner left");
      } else {
        unsubscribe?.();
      }
      children[0]!.exitCode = 0;
      children[0]!.emit("exit", 0, null);
      await closing;
      await new Promise((resolve) => setImmediate(resolve));

      expect(spawnPipe).toHaveBeenCalledOnce();
      expect(children).toHaveLength(1);
    },
  );

  testCases.each([
    { emitHello: false, expectedPluginRemoval: false, name: "before hello" },
    { emitHello: true, expectedPluginRemoval: true, name: "after hello" },
  ])(
    "force-cleans failed startup $name",
    async ({ emitHello, expectedPluginRemoval }) => {
      const runCommand = vi.fn(async () => "");
      const { backend, children } = setup({
        cooperativeShutdown: false,
        runCommand,
        spawn: (child, connectionId) => {
          child.kill.mockImplementation((signal: NodeJS.Signals) => {
            if (signal === "SIGKILL") {
              child.exitCode = 1;
              queueMicrotask(() => child.emit("exit", 1, signal));
            }
            return true;
          });
          emit(
            child,
            ...(emitHello ? [hello(connectionId)] : []),
            "malformed output",
          );
        },
      });

      await expect(backend.read()).rejects.toThrow("protocol undefined");
      expect(children[0]!.kill).toHaveBeenCalledWith("SIGTERM");
      expect(children[0]!.kill).toHaveBeenCalledWith("SIGKILL");
      expect(runCommand).toHaveBeenCalledTimes(expectedPluginRemoval ? 1 : 0);
      if (expectedPluginRemoval) {
        expect(runCommand).toHaveBeenCalledWith([
          "--session",
          "alpha",
          "action",
          "close-pane",
          "--pane-id",
          "plugin_4",
        ]);
      }
    },
    5_000,
  );

  it("replaces a vanished anchor lexicographically and keeps publishing", async () => {
    const listSessions = vi
      .fn<(signal?: AbortSignal) => Promise<readonly string[]>>()
      .mockResolvedValueOnce(["beta", "alpha"])
      .mockResolvedValueOnce(["beta"]);
    const { backend, children, spawnPipe } = setup({
      listSessions,
      spawn: (child, connectionId, call) =>
        completeStartup(
          child,
          connectionId,
          call === 1 ? ["alpha", "beta"] : ["beta"],
        ),
    });
    await backend.read();

    children[0]!.exitCode = 1;
    children[0]!.emit("exit", 1, null);
    expect(backend.state().connected).toBe(false);

    await vi.waitFor(() => expect(spawnPipe).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(backend.state().sessions.map((session) => session.name)).toEqual([
        "beta",
      ]),
    );
    expect(spawnPipe.mock.calls[1]?.[0]).toMatchObject({
      anchorSession: "beta",
    });
    await backend.close();
  });

  it("can restart cleanly when shutdown cancels anchor replacement", async () => {
    let listCall = 0;
    const listSessions = vi.fn(
      (signal?: AbortSignal): Promise<readonly string[]> => {
        listCall += 1;
        if (listCall !== 2) {
          return Promise.resolve(["alpha"]);
        }
        return new Promise((_resolve, reject) =>
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
      },
    );
    const { backend, children, spawnPipe } = setup({
      listSessions,
      spawn: (child, connectionId) =>
        completeStartup(child, connectionId, ["alpha"]),
    });
    await backend.read();
    children[0]!.exitCode = 1;
    children[0]!.emit("exit", 1, null);
    await vi.waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2));

    await backend.close();
    await expect(backend.read()).resolves.toMatchObject({ connected: true });
    expect(spawnPipe).toHaveBeenCalledTimes(2);
    await backend.close();
  });

  it("treats protocol failure as terminal within its stdout chunk", async () => {
    const { backend, children } = setup({
      spawn: (child, connectionId) =>
        queueMicrotask(() =>
          emit(
            child,
            "malformed output",
            hello(connectionId),
            snapshot(connectionId, 1, ["should-not-publish"]),
          ),
        ),
    });

    await expect(backend.read()).rejects.toThrow("protocol undefined");
    expect(backend.state()).toMatchObject({ connected: false, sessions: [] });
    expect(children).toHaveLength(1);
  });

  it("escalates and removes the plugin after an established protocol failure", async () => {
    const { backend, children, runCommand } = setup({
      spawn: (child, connectionId) =>
        completeStartup(child, connectionId, ["alpha"]),
    });
    await backend.read();
    children[0]!.stdin.removeAllListeners("data");
    children[0]!.stdin.removeAllListeners("finish");
    children[0]!.kill.mockImplementation((signal: NodeJS.Signals) => {
      if (signal === "SIGKILL") {
        children[0]!.exitCode = 1;
        queueMicrotask(() => children[0]!.emit("exit", 1, signal));
      }
      return true;
    });

    children[0]!.stdout.write("not-json\n");

    await vi.waitFor(
      () => expect(children[0]!.kill).toHaveBeenCalledWith("SIGKILL"),
      { timeout: 3_000 },
    );
    expect(runCommand).toHaveBeenCalledWith([
      "--session",
      "alpha",
      "action",
      "close-pane",
      "--pane-id",
      "plugin_4",
    ]);
    expect(backend.state()).toMatchObject({ connected: false, sessions: [] });
    await backend.close();
  });

  it("decodes snapshots split within a Unicode code point", async () => {
    const { backend, children } = setup({
      spawn: (child, connectionId) => {
        queueMicrotask(() => {
          emit(child, hello(connectionId));
          const encoded = Buffer.from(
            `${JSON.stringify(snapshot(connectionId, 1, ["alpha-😀"]))}\n`,
          );
          const unicodeOffset = encoded.indexOf(Buffer.from("😀"));
          child.stdout.write(encoded.subarray(0, unicodeOffset + 1));
          child.stdout.write(encoded.subarray(unicodeOffset + 1));
        });
      },
    });

    await expect(backend.read()).resolves.toMatchObject({
      sessions: [{ name: "alpha-😀" }],
    });
    await backend.close();
    expect(children).toHaveLength(1);
  });

  it("registers reconciliation before mutation and ignores unrelated newer events", async () => {
    let child: FakeProcess | undefined;
    const runCommand = vi.fn(async () => {
      emit(child!, snapshot("connection-1", 2, ["alpha", "unrelated"]));
      await Promise.resolve();
      emit(child!, snapshot("connection-1", 3, ["beta"]));
      return "done";
    });
    const setupResult = setup({
      runCommand,
      spawn: (spawned, connectionId) => {
        child = spawned;
        completeStartup(spawned, connectionId, ["alpha"]);
      },
    });
    await setupResult.backend.read();

    await expect(
      setupResult.backend.mutate(
        ["kill-session", "alpha"],
        () => (state) =>
          !state.sessions.some((session) => session.name === "alpha"),
      ),
    ).resolves.toBe("done");
    expect(runCommand).toHaveBeenCalledOnce();
    await setupResult.backend.close();
  });

  it("treats successful command completion as sufficient when killing its anchor", async () => {
    let child: FakeProcess | undefined;
    const listSessions = vi
      .fn<(signal?: AbortSignal) => Promise<readonly string[]>>()
      .mockResolvedValueOnce(["alpha"])
      .mockResolvedValueOnce([]);
    const runCommand = vi.fn(async () => {
      child!.exitCode = 0;
      child!.emit("exit", 0, null);
      return "killed";
    });
    const { backend } = setup({
      listSessions,
      runCommand,
      spawn: (spawned, connectionId) => {
        child = spawned;
        completeStartup(spawned, connectionId, ["alpha"]);
      },
    });
    await backend.read();

    await expect(
      backend.mutate(["kill-session", "alpha"], () => undefined),
    ).resolves.toBe("killed");
    expect(runCommand).toHaveBeenCalledOnce();
    await backend.close();
  });

  it("cleans reconciliation when creation output is malformed", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const { backend } = setup({
      runCommand: vi.fn(async () => "not-an-id"),
      spawn: (child, connectionId) =>
        completeStartup(child, connectionId, ["alpha"]),
    });
    await backend.read();
    const clearedBeforeMutation = clearTimeoutSpy.mock.calls.length;

    await expect(
      backend.mutate(["create"], () => {
        throw new Error("invalid creation output");
      }),
    ).rejects.toThrow("invalid creation output");
    expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(
      clearedBeforeMutation,
    );

    clearTimeoutSpy.mockRestore();
    await backend.close();
  });

  it("cooperatively shuts down once and rejects pending reconciliation", async () => {
    const runCommand = vi.fn(async () => "done");
    const { backend, children } = setup({
      runCommand,
      spawn: (child, connectionId) =>
        completeStartup(child, connectionId, ["alpha"]),
    });
    await backend.read();
    const input: Buffer[] = [];
    children[0]!.stdin.on("data", (chunk: Buffer) => input.push(chunk));
    const mutation = backend.mutate(["rename"], () => () => false);
    await vi.waitFor(() => expect(runCommand).toHaveBeenCalledOnce());

    const first = backend.close();
    const second = backend.close();

    expect(second).toBe(first);
    await expect(mutation).rejects.toMatchObject({ name: "AbortError" });
    await first;
    expect(Buffer.concat(input).toString("utf8")).toContain(
      '"type":"shutdown"',
    );
    expect(runCommand).toHaveBeenLastCalledWith([
      "--session",
      "alpha",
      "action",
      "close-pane",
      "--pane-id",
      "plugin_4",
    ]);
    expect(children[0]!.kill).not.toHaveBeenCalledWith("SIGKILL");
  });
});
