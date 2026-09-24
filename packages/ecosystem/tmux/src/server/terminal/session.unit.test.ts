// Covers terminal selection races, input, geometry, output flow control, failures, and cleanup.
import type { PtyProcess, PtySpawnOptions } from "@overmux/pty/server";
import { describe, expect, it, test as testCases, vi } from "vitest";

import type { TmuxBackend } from "../backend";
import {
  tmuxTerminalInputLimit,
  type TmuxTerminalClientMessage,
  type TmuxTerminalServerMessage,
} from "../../shared/terminal-contracts";
import {
  createTmuxTerminalSession,
  defaultTmuxTerminalOutputChunkSize,
  tmuxAttachArguments,
} from "./session";

type Deferred<T> = {
  promise: Promise<T>;
  reject: (cause: unknown) => void;
  resolve: (value: T) => void;
};

type FakePty = PtyProcess & {
  dataSubscriptionDisposed: ReturnType<typeof vi.fn>;
  emitOutput: (data: string) => void;
  exit: (result: { exitCode: number; signal?: number }) => void;
  exitSubscriptionDisposed: ReturnType<typeof vi.fn>;
};

const createDeferred = <T>(): Deferred<T> => {
  let reject: Deferred<T>["reject"] = () => undefined;
  let resolve: Deferred<T>["resolve"] = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
};

const locationFor = (sessionId: string) => ({
  paneId: `%${sessionId.slice(1)}`,
  sessionId,
  windowId: `@${sessionId.slice(1)}`,
});

const createFakePty = (): FakePty => {
  let dataListener: ((data: string) => void) | undefined;
  let exitListener:
    | ((result: { exitCode: number; signal?: number }) => void)
    | undefined;
  const dataSubscriptionDisposed = vi.fn();
  const exitSubscriptionDisposed = vi.fn();
  return {
    dataSubscriptionDisposed,
    emitOutput: (data: string) => dataListener?.(data),
    exit: (result) => exitListener?.(result),
    exitSubscriptionDisposed,
    kill: vi.fn(() => exitListener?.({ exitCode: 0 })),
    onData: vi.fn((listener) => {
      dataListener = listener;
      return { dispose: dataSubscriptionDisposed };
    }),
    onExit: vi.fn((listener) => {
      exitListener = listener;
      return { dispose: exitSubscriptionDisposed };
    }),
    pause: vi.fn(),
    pid: 123,
    resize: vi.fn(),
    resume: vi.fn(),
    write: vi.fn(),
  } satisfies FakePty;
};

const createSessionHarness = ({
  allowInput = true,
  outputChunkSize = defaultTmuxTerminalOutputChunkSize,
  geometryPolicy = "shared",
  spawnError,
}: {
  allowInput?: boolean;
  outputChunkSize?: number;
  geometryPolicy?: "shared" | "ignore-size";
  spawnError?: Error;
} = {}) => {
  const abortController = new AbortController();
  const messages: TmuxTerminalServerMessage[] = [];
  const process = createFakePty();
  const sessionLookups = new Map<string, Promise<string>>();
  const sessionSwitches = new Map<string, Promise<void>>();
  const clientListHolds: Deferred<void>[] = [];
  const unsubscribeNotifications = vi.fn();
  let notificationListener:
    | ((event: { type: "sessions-changed" }) => void)
    | undefined;
  let attachReadiness: Promise<void> | undefined;
  let attachedSessionId = "$1";
  const clientName = "/dev/pts/terminal";

  const run = vi.fn(async (args: readonly string[]) => {
    if (args[0] === "display-message") {
      const sessionId = args[3]?.replace(/^=/, "").replace(/:$/, "") ?? "";
      return `${await (sessionLookups.get(sessionId) ?? sessionId)}\n`;
    }
    if (args[0] === "wait-for") {
      await attachReadiness;
      return "";
    }
    if (args[0] === "show-options") {
      return `${clientName}\n`;
    }
    if (args[0] === "list-clients") {
      const location = locationFor(attachedSessionId);
      const result = `${clientName}\\037${location.sessionId}\\037${location.windowId}\\037${location.paneId}\n`;
      await clientListHolds.shift()?.promise;
      return result;
    }
    if (args[0] === "switch-client") {
      const sessionId = args[4]?.replace(/^=/, "") ?? "";
      await sessionSwitches.get(sessionId);
      attachedSessionId = sessionId;
    }
    return "";
  });
  const backend = {
    id: "test",
    run,
    socket: "test",
    subscribeNotifications: (
      listener: Parameters<TmuxBackend["subscribeNotifications"]>[0],
    ) => {
      notificationListener = listener as typeof notificationListener;
      return unsubscribeNotifications;
    },
  } as unknown as TmuxBackend;
  const ptyFactory = vi.fn((options: PtySpawnOptions) => {
    if (spawnError) {
      throw spawnError;
    }
    const targetIndex = options.args.indexOf("-t");
    attachedSessionId = options.args[targetIndex + 1]?.replace(/^=/, "") ?? "";
    return process;
  });
  const fail = vi.fn();
  const session = createTmuxTerminalSession({
    allowInput,
    backend,
    emit: (message) => messages.push(message),
    fail,
    geometryPolicy,
    outputChunkSize,
    ptyFactory,
    signal: abortController.signal,
  });
  let requestId = 0;

  return {
    abort: () => abortController.abort(),
    fail,
    holdAttachReadiness: () => {
      const readiness = createDeferred<void>();
      attachReadiness = readiness.promise;
      return readiness;
    },
    holdNextClientList: () => {
      const hold = createDeferred<void>();
      clientListHolds.push(hold);
      return hold;
    },
    holdSessionLookup: (sessionId: string) => {
      const lookup = createDeferred<string>();
      sessionLookups.set(sessionId, lookup.promise);
      return lookup;
    },
    holdSessionSwitch: (sessionId: string) => {
      const sessionSwitch = createDeferred<void>();
      sessionSwitches.set(sessionId, sessionSwitch.promise);
      return sessionSwitch;
    },
    input: (
      data: Extract<TmuxTerminalClientMessage, { type: "input" }>["data"],
    ) => session.onMessage?.({ data, type: "input" }),
    messages,
    notify: () => notificationListener?.({ type: "sessions-changed" }),
    process,
    ptyFactory,
    resize: (cols: number, rows: number) =>
      session.onMessage?.({ cols, rows, type: "resize" }),
    run,
    select: (sessionId: string) => {
      const requestIdForSelection = requestId;
      requestId += 1;
      session.onMessage?.({
        requestId: requestIdForSelection,
        target: { sessionId },
        type: "go-to",
      });
      return requestIdForSelection;
    },
    session,
    unsubscribeNotifications,
  };
};

type SessionHarness = ReturnType<typeof createSessionHarness>;

const attachTerminal = async (terminal: SessionHarness, sessionId = "$1") => {
  const requestId = terminal.select(sessionId);
  await vi.waitFor(() =>
    expect(terminal.messages).toContainEqual({
      requestId,
      result: {
        location: locationFor(sessionId),
        outcome: "success",
        revision: 1,
      },
      type: "go-to-result",
    }),
  );
};

const hasSessionSwitch = (terminal: SessionHarness, sessionId: string) =>
  terminal.run.mock.calls.some(
    ([args]) => args[0] === "switch-client" && args.includes(`=${sessionId}`),
  );

describe("tmux terminal navigation", () => {
  it("attaches at the default size without geometry, then confirms the complete location", async () => {
    const terminal = createSessionHarness();
    const requestId = terminal.select("$1");

    await vi.waitFor(() => expect(terminal.ptyFactory).toHaveBeenCalledOnce());

    expect(terminal.ptyFactory).toHaveBeenCalledWith(
      expect.objectContaining({ cols: 80, rows: 24 }),
    );
    expect(terminal.ptyFactory.mock.calls[0]?.[0].args).toEqual(
      expect.arrayContaining([
        "attach-session",
        "-E",
        "-f",
        "ignore-size",
        "-t",
        "=$1",
      ]),
    );
    expect(terminal.process.resize).not.toHaveBeenCalled();
    expect(
      terminal.run.mock.calls.some(([args]) => args[0] === "refresh-client"),
    ).toBe(false);
    expect(hasSessionSwitch(terminal, "$1")).toBe(true);
    expect(terminal.messages).toContainEqual({
      location: locationFor("$1"),
      revision: 1,
      type: "location-changed",
    });
    expect(terminal.messages).toContainEqual({
      requestId,
      result: { location: locationFor("$1"), outcome: "success", revision: 1 },
      type: "go-to-result",
    });
    await terminal.session.dispose?.();
  });

  it("attaches only the latest selection when validation races", async () => {
    const terminal = createSessionHarness();
    const firstLookup = terminal.holdSessionLookup("$1");
    const firstRequest = terminal.select("$1");
    const secondRequest = terminal.select("$2");
    firstLookup.resolve("$1");

    await vi.waitFor(() => expect(terminal.ptyFactory).toHaveBeenCalledOnce());

    expect(terminal.ptyFactory.mock.calls[0]?.[0].args).toContain("=$2");
    expect(terminal.messages).toContainEqual({
      requestId: firstRequest,
      result: {
        message: "Tmux navigation superseded by a newer request",
        outcome: "error",
      },
      type: "go-to-result",
    });
    expect(terminal.messages).toContainEqual({
      requestId: secondRequest,
      result: { location: locationFor("$2"), outcome: "success", revision: 1 },
      type: "go-to-result",
    });
    await terminal.session.dispose?.();
  });

  it("retains a stale initial attach and switches its PTY to the latest selection", async () => {
    const terminal = createSessionHarness();
    const attachReadiness = terminal.holdAttachReadiness();
    terminal.select("$1");
    await vi.waitFor(() => expect(terminal.ptyFactory).toHaveBeenCalledOnce());

    terminal.select("$2");
    attachReadiness.resolve();
    await vi.waitFor(() => expect(hasSessionSwitch(terminal, "$2")).toBe(true));

    expect(terminal.ptyFactory).toHaveBeenCalledOnce();
    await terminal.session.dispose?.();
  });

  it("ignores a stale switch failure and applies the latest selection", async () => {
    const terminal = createSessionHarness();
    await attachTerminal(terminal);
    const staleSwitch = terminal.holdSessionSwitch("$2");
    terminal.select("$2");
    await vi.waitFor(() => expect(hasSessionSwitch(terminal, "$2")).toBe(true));

    terminal.select("$3");
    staleSwitch.reject(new Error("stale switch failed"));
    await vi.waitFor(() => expect(hasSessionSwitch(terminal, "$3")).toBe(true));

    expect(terminal.fail).not.toHaveBeenCalled();
    await terminal.session.dispose?.();
  });

  it("does not emit an observation started before navigation", async () => {
    const terminal = createSessionHarness();
    await attachTerminal(terminal);
    const clientListsBeforeObservation = terminal.run.mock.calls.filter(
      ([args]) => args[0] === "list-clients",
    ).length;
    const staleObservation = terminal.holdNextClientList();
    terminal.notify();
    await vi.waitFor(() =>
      expect(
        terminal.run.mock.calls.filter(([args]) => args[0] === "list-clients"),
      ).toHaveLength(clientListsBeforeObservation + 1),
    );

    const requestId = terminal.select("$2");
    await vi.waitFor(() =>
      expect(terminal.messages).toContainEqual({
        requestId,
        result: {
          location: locationFor("$2"),
          outcome: "success",
          revision: 2,
        },
        type: "go-to-result",
      }),
    );
    staleObservation.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    expect(
      terminal.messages.filter(
        (message) =>
          message.type === "location-changed" &&
          message.location.sessionId === "$1",
      ),
    ).toHaveLength(1);
    await terminal.session.dispose?.();
  });

  it("reports a current switch failure without retrying or replacing the PTY", async () => {
    const terminal = createSessionHarness();
    await attachTerminal(terminal);
    const failedSwitch = terminal.holdSessionSwitch("$2");
    const requestId = terminal.select("$2");
    await vi.waitFor(() => expect(hasSessionSwitch(terminal, "$2")).toBe(true));
    terminal.input("discarded");
    failedSwitch.reject(new Error("switch failed"));

    await vi.waitFor(() =>
      expect(terminal.messages).toContainEqual({
        requestId,
        result: { message: "switch failed", outcome: "error" },
        type: "go-to-result",
      }),
    );

    expect(terminal.fail).not.toHaveBeenCalled();
    expect(terminal.ptyFactory).toHaveBeenCalledOnce();
    expect(terminal.process.write).not.toHaveBeenCalledWith("discarded");
    expect(
      terminal.run.mock.calls.filter(
        ([args]) => args[0] === "switch-client" && args.includes("=$2"),
      ),
    ).toHaveLength(1);
    await terminal.session.dispose?.();
  });

  it("reports a spawn failure fatally and cleans up its backend subscription", async () => {
    const attachFailure = new Error("PTY spawn failed");
    const terminal = createSessionHarness({ spawnError: attachFailure });
    terminal.select("$1");

    await vi.waitFor(() =>
      expect(terminal.fail).toHaveBeenCalledWith(attachFailure),
    );

    expect(terminal.unsubscribeNotifications).toHaveBeenCalledOnce();
    await terminal.session.dispose?.();
  });

  it("applies the latest geometry after attach readiness", async () => {
    const terminal = createSessionHarness();
    const attachReadiness = terminal.holdAttachReadiness();
    terminal.select("$1");
    terminal.resize(80, 24);
    await vi.waitFor(() => expect(terminal.ptyFactory).toHaveBeenCalledOnce());

    terminal.resize(120, 40);
    attachReadiness.resolve();
    await vi.waitFor(() =>
      expect(terminal.process.resize).toHaveBeenCalledWith(120, 40),
    );

    expect(terminal.ptyFactory).toHaveBeenCalledWith(
      expect.objectContaining({ cols: 80, rows: 24 }),
    );
    expect(terminal.process.resize).toHaveBeenCalledOnce();
    await terminal.session.dispose?.();
  });

  it("resizes after attachment and opts a shared terminal into geometry", async () => {
    const terminal = createSessionHarness();
    await attachTerminal(terminal);

    terminal.resize(120, 40);
    terminal.resize(120, 40);

    expect(terminal.process.resize).toHaveBeenCalledOnce();
    expect(terminal.process.resize).toHaveBeenCalledWith(120, 40);
    expect(terminal.run.mock.calls.map(([args]) => args)).toContainEqual([
      "refresh-client",
      "-t",
      "/dev/pts/terminal",
      "-f",
      "!ignore-size",
    ]);
    await terminal.session.dispose?.();
  });
});

testCases.each(["shared", "ignore-size"] as const)(
  "applies measured bootstrap-sized geometry with %s policy and redraws the same client",
  async (geometryPolicy) => {
    const terminal = createSessionHarness({ geometryPolicy });
    await attachTerminal(terminal);
    terminal.resize(80, 24);
    expect(terminal.process.resize).toHaveBeenCalledWith(80, 24);
    expect(
      terminal.run.mock.calls.some(([args]) => args.includes("!ignore-size")),
    ).toBe(geometryPolicy === "shared");

    terminal.session.onMessage?.({ type: "redraw" });
    expect(terminal.run).toHaveBeenCalledWith(
      ["refresh-client", "-t", "/dev/pts/terminal"],
      expect.any(AbortSignal),
    );
    expect(terminal.ptyFactory).toHaveBeenCalledOnce();
    await terminal.session.dispose?.();
  },
);

describe("tmux terminal input", () => {
  it("flushes queued text and binary input in arrival order after attach", async () => {
    const terminal = createSessionHarness();
    const binaryInput = Uint8Array.from([0, 128, 255]);
    terminal.input("pwd\r");
    terminal.input(binaryInput);

    await attachTerminal(terminal);

    expect(terminal.process.write).toHaveBeenNthCalledWith(1, "pwd\r");
    expect(terminal.process.write).toHaveBeenNthCalledWith(
      2,
      Buffer.from(binaryInput),
    );
    await terminal.session.dispose?.();
  });

  it("queues input during a switch until the latest session is selected", async () => {
    const terminal = createSessionHarness();
    await attachTerminal(terminal);
    const sessionSwitch = terminal.holdSessionSwitch("$2");
    terminal.select("$2");
    await vi.waitFor(() => expect(hasSessionSwitch(terminal, "$2")).toBe(true));

    terminal.input("queued");
    expect(terminal.process.write).not.toHaveBeenCalled();
    sessionSwitch.resolve();
    await vi.waitFor(() =>
      expect(terminal.process.write).toHaveBeenCalledWith("queued"),
    );
    await terminal.session.dispose?.();
  });

  it("writes permitted input directly to the selected PTY", async () => {
    const terminal = createSessionHarness();
    await attachTerminal(terminal);

    terminal.input("pwd\r");

    expect(terminal.process.write).toHaveBeenCalledWith("pwd\r");
    await terminal.session.dispose?.();
  });

  it("drops read-only input before and after attach", async () => {
    const terminal = createSessionHarness({ allowInput: false });
    terminal.input("before attach");
    await attachTerminal(terminal);
    terminal.input("after attach");

    expect(terminal.process.write).not.toHaveBeenCalled();
    await terminal.session.dispose?.();
  });

  it("limits the total input queued before selection", async () => {
    const terminal = createSessionHarness();
    terminal.input("x".repeat(tmuxTerminalInputLimit));

    expect(() => terminal.input("x")).toThrow(
      "Terminal received too much input before selecting a session",
    );
    await terminal.session.dispose?.();
  });
});

describe("tmux terminal output boundary", () => {
  it("forwards PTY output and rendered acknowledgements through the shared flow", async () => {
    const terminal = createSessionHarness({ outputChunkSize: 3 });
    await attachTerminal(terminal);
    terminal.process.emitOutput("abc");
    const output = terminal.messages.find((message) => message.type === "data");

    expect(output).toMatchObject({
      bytes: Uint8Array.from([97, 98, 99]),
      sequence: 0,
      type: "data",
    });
    expect(() =>
      terminal.session.onMessage?.({
        sequence: output!.sequence,
        terminalId: output!.terminalId,
        type: "rendered",
      }),
    ).not.toThrow();
    await terminal.session.dispose?.();
  });
});

describe("tmux terminal cleanup", () => {
  it("disposes the PTY and subscriptions only once", async () => {
    const terminal = createSessionHarness();
    await attachTerminal(terminal);

    const firstDisposal = terminal.session.dispose?.();
    const secondDisposal = terminal.session.dispose?.();
    await firstDisposal;

    expect(secondDisposal).toBe(firstDisposal);
    expect(terminal.process.kill).toHaveBeenCalledOnce();
    expect(terminal.process.dataSubscriptionDisposed).toHaveBeenCalledOnce();
    expect(terminal.process.exitSubscriptionDisposed).toHaveBeenCalledOnce();
    expect(terminal.unsubscribeNotifications).toHaveBeenCalledOnce();
  });

  it("reports an unexpected PTY exit", async () => {
    const terminal = createSessionHarness();
    await attachTerminal(terminal);
    terminal.process.exit({ exitCode: 7, signal: 9 });
    await vi.waitFor(() => expect(terminal.fail).toHaveBeenCalledOnce());

    expect(terminal.fail).toHaveBeenCalledWith(
      new Error("Tmux terminal client exited (code 7, signal 9)"),
    );
    await terminal.session.dispose?.();
  });

  it("disposes a pending navigation without confirming it", async () => {
    const terminal = createSessionHarness();
    const lookup = terminal.holdSessionLookup("$1");
    terminal.select("$1");
    const disposal = terminal.session.dispose?.();
    lookup.resolve("$1");
    await disposal;

    expect(terminal.messages).not.toContainEqual(
      expect.objectContaining({ type: "go-to-result" }),
    );
    expect(terminal.unsubscribeNotifications).toHaveBeenCalledOnce();
  });

  it("aborts the PTY without reporting a failure or killing the tmux session", async () => {
    const terminal = createSessionHarness();
    await attachTerminal(terminal);
    terminal.abort();
    await terminal.session.dispose?.();

    expect(terminal.process.kill).toHaveBeenCalledWith("SIGHUP");
    expect(terminal.fail).not.toHaveBeenCalled();
    expect(terminal.run.mock.calls.flat(2)).not.toContain("kill-session");
  });
});

describe("tmux PTY command policy", () => {
  const geometryPolicyCases = [
    { expected: [], policy: "shared" as const },
    { expected: ["-f", "ignore-size"], policy: "ignore-size" as const },
  ];

  testCases.each(geometryPolicyCases)(
    "constructs $policy geometry flags",
    ({ expected, policy }) => {
      const args = tmuxAttachArguments({
        geometryPolicy: policy,
        readyChannel: "ready",
        sessionId: "$1",
        socket: "/tmp/tmux.sock",
      });

      expect(args).toEqual(
        expect.arrayContaining(["-S", "/tmp/tmux.sock", "-t", "=$1", "ready"]),
      );
      expect(
        args.filter((argument) => ["-f", "ignore-size"].includes(argument)),
      ).toEqual(expected);
      expect(args).not.toContain("active-pane");
    },
  );
});
