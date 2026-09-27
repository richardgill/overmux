// Verifies terminal attachment, input, selection, notifications, and geometry against real tmux.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { tmuxSocketArguments, type TmuxBackend } from "../backend";
import type {
  TmuxTerminalClientMessage,
  TmuxTerminalServerMessage,
  TmuxTerminalLocation,
} from "../../shared/terminal-contracts";
import { createTmuxTerminalClient } from "../../client/terminal-client";
import {
  createTmuxControlClient,
  type TmuxControlClient,
} from "../control/client";
import {
  createTmuxTerminalSession,
  defaultTmuxTerminalOutputChunkSize,
} from "./session";

const execFileAsync = promisify(execFile);
const realProcessTimeout = 10_000;
const activeServerSockets: string[] = [];
const activeControlClients: TmuxControlClient[] = [];
const activeTerminalDisposals = new Set<() => Promise<void>>();

const runTmux = async (
  socket: string,
  args: readonly string[],
  signal?: AbortSignal,
) => {
  const { stdout } = await execFileAsync(
    "tmux",
    ["-f", "/dev/null", ...tmuxSocketArguments(socket), ...args],
    { signal },
  );
  return stdout;
};

const stopTmuxServer = async (socket: string) => {
  try {
    await runTmux(socket, ["kill-server"]);
  } catch (cause) {
    const stderr = (cause as { stderr?: unknown }).stderr;
    if (String(stderr).includes("no server running")) {
      return;
    }
    throw cause;
  }
};

const createIsolatedTmuxBackend = (): TmuxBackend => {
  const socket = `overmux-terminal-test-${randomUUID()}`;
  activeServerSockets.push(socket);
  return {
    id: socket,
    run: (args: readonly string[], signal?: AbortSignal) =>
      runTmux(socket, args, signal),
    socket,
    subscribeNotifications: () => () => undefined,
  } as unknown as TmuxBackend;
};

const createTmuxSession = async (backend: TmuxBackend, name: string) =>
  (
    await backend.run([
      "new-session",
      "-d",
      "-P",
      "-F",
      "#{session_id}",
      "-s",
      name,
      "sh",
    ])
  ).trim();

const createSessionPair = async (backend: TmuxBackend) => ({
  first: await createTmuxSession(backend, "one"),
  second: await createTmuxSession(backend, "two"),
});

const withControlTransport = (backend: TmuxBackend) => {
  const client = createTmuxControlClient({ socket: backend.socket });
  activeControlClients.push(client);
  return {
    ...backend,
    run: (args: readonly string[], signal?: AbortSignal) =>
      client.command(args, { signal }),
    subscribeNotifications: client.subscribe,
  };
};

const waitForSessionChange = async ({
  failureCause,
  messages,
  sessionId,
}: {
  failureCause: () => unknown;
  messages: TmuxTerminalServerMessage[];
  sessionId: string;
}) =>
  vi.waitFor(
    () => {
      const failure = failureCause();
      if (failure) {
        throw failure;
      }
      expect(messages).toContainEqual(
        expect.objectContaining({
          location: expect.objectContaining({ sessionId }),
          type: "location-changed",
        }),
      );
    },
    { timeout: realProcessTimeout },
  );

const connectTerminal = async (
  backend: TmuxBackend,
  sessionId: string,
  geometry = true,
) => {
  const controller = new AbortController();
  const messages: TmuxTerminalServerMessage[] = [];
  const failure = vi.fn();
  let listener: ((message: TmuxTerminalServerMessage) => void) | undefined;
  let location: TmuxTerminalLocation | undefined;
  const session = createTmuxTerminalSession({
    allowInput: true,
    backend,
    emit: (message) => {
      messages.push(message);
      listener?.(message);
    },
    fail: failure,
    geometryPolicy: "shared",
    outputChunkSize: defaultTmuxTerminalOutputChunkSize,
    signal: controller.signal,
  });
  const client = createTmuxTerminalClient({
    connection: {
      connectionId: Symbol(),
      close: () => controller.abort(),
      status: "open",
      send: (message) => {
        session.onMessage?.(message);
        return true;
      },
      subscribe: (next) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    },
    onLocationChange: (next) => {
      location = next;
    },
    sink: { reset: () => undefined, write: (_bytes, done) => done() },
  });
  const disconnect = async () => {
    client.dispose();
    controller.abort();
    await session.dispose?.();
    activeTerminalDisposals.delete(disconnect);
  };
  activeTerminalDisposals.add(disconnect);

  const attached = client.goTo({ sessionId });
  if (geometry) {
    client.resize({ cols: 80, rows: 24 });
  }
  await attached;
  await waitForSessionChange({
    failureCause: () => failure.mock.calls[0]?.[0],
    messages,
    sessionId,
  });

  return {
    disconnect,
    failure,
    client,
    location: () => location,
    messages,
    send: (message: TmuxTerminalClientMessage) => session.onMessage?.(message),
    waitForSession: (selectedSessionId: string) =>
      waitForSessionChange({
        failureCause: () => failure.mock.calls[0]?.[0],
        messages,
        sessionId: selectedSessionId,
      }),
  };
};

const waitForPaneOutput = async (
  backend: TmuxBackend,
  target: string,
  expected: string,
) =>
  vi.waitFor(
    async () =>
      expect(await backend.run(["capture-pane", "-p", "-t", target])).toContain(
        expected,
      ),
    { timeout: realProcessTimeout },
  );

const createWindow = async (backend: TmuxBackend, sessionId: string) => {
  const [windowId, paneId] = (
    await backend.run([
      "new-window",
      "-d",
      "-P",
      "-F",
      "#{window_id}|#{pane_id}",
      "-t",
      `${sessionId}:`,
      "sh",
    ])
  )
    .trim()
    .split("|");
  return { sessionId, windowId: windowId!, paneId: paneId! };
};

const waitForLocation = async (
  terminal: Awaited<ReturnType<typeof connectTerminal>>,
  location: TmuxTerminalLocation,
) =>
  vi.waitFor(() => expect(terminal.location()).toEqual(location), {
    timeout: realProcessTimeout,
  });

const readNativeTerminalClient = async (backend: TmuxBackend) => {
  const output = await backend.run([
    "list-clients",
    "-F",
    "#{?client_control_mode,,#{client_name}|#{client_pid}|#{session_id}|#{client_width}|#{client_height}}",
  ]);
  const [name, pid, sessionId, width, height] = output.trim().split("|");
  if (!name || !pid || !sessionId || !width || !height) {
    throw new Error(
      `Native tmux terminal client was not found; observed ${JSON.stringify(output.trim())}`,
    );
  }
  return { height, name, pid, sessionId, width };
};

const cleanupIsolatedTmux = async () => {
  const terminalResults = await Promise.allSettled(
    [...activeTerminalDisposals].map((dispose) => dispose()),
  );
  activeTerminalDisposals.clear();
  const clientResults = await Promise.allSettled(
    activeControlClients.splice(0).map((client) => client.close()),
  );
  const serverResults = await Promise.allSettled(
    activeServerSockets.splice(0).map(stopTmuxServer),
  );
  const failures = [
    ...terminalResults,
    ...clientResults,
    ...serverResults,
  ].flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (failures.length) {
    throw new AggregateError(failures, "Failed to clean up isolated tmux");
  }
};

afterEach(cleanupIsolatedTmux);

describe("real isolated tmux terminal", () => {
  it("exposes the native client as soon as the readiness handshake signals", async () => {
    const backend = createIsolatedTmuxBackend();
    const sessionId = await createTmuxSession(backend, "handshake");
    let clientAtSignal:
      | Awaited<ReturnType<typeof readNativeTerminalClient>>
      | undefined;
    const terminal = await connectTerminal(
      {
        ...backend,
        run: async (args, signal) => {
          const output = await backend.run(args, signal);
          if (args[0] === "wait-for") {
            // Inspect immediately after the native signal, before the attachment code resumes.
            const storedName = (
              await backend.run(["show-options", "-gv", `@${args[1]}`])
            ).trim();
            clientAtSignal = await readNativeTerminalClient(backend);
            expect(clientAtSignal.name).toBe(storedName);
            expect(clientAtSignal.sessionId).toBe(sessionId);
          }
          return output;
        },
      },
      sessionId,
      false,
    );

    expect(clientAtSignal).toBeDefined();
    expect((await readNativeTerminalClient(backend)).pid).toBe(
      clientAtSignal?.pid,
    );
    expect(terminal.failure).not.toHaveBeenCalled();
    await terminal.disconnect();
  });

  it("attaches without shadows, follows window selection, and leaves the session running", async () => {
    const backend = createIsolatedTmuxBackend();
    const sourceSessionId = await createTmuxSession(backend, "source");
    await backend.run([
      "new-window",
      "-d",
      "-n",
      "second",
      "-t",
      "source:",
      "sh",
    ]);
    const terminal = await connectTerminal(backend, sourceSessionId);

    await backend.run(["select-window", "-t", "source:second"]);
    terminal.send({ data: "printf 'DIRECT7\\n'\r", type: "input" });
    await waitForPaneOutput(backend, "source:second.0", "DIRECT7");
    await terminal.disconnect();

    await expect(backend.run(["has-session", "-t", "=source"])).resolves.toBe(
      "",
    );
    await expect(
      backend.run(["list-sessions", "-F", "#{session_name}"]),
    ).resolves.toBe("source\n");
    expect(terminal.failure).not.toHaveBeenCalled();
  });

  it("streams shell output before and after reconnecting to a surviving session", async () => {
    const isolated = createIsolatedTmuxBackend();
    const sessionId = await createTmuxSession(isolated, "reconnect");
    const backend = withControlTransport(isolated);

    for (const marker of ["BEFORE", "AFTER"]) {
      const terminal = await connectTerminal(backend, sessionId);
      terminal.client.input(`printf '%s%s\\n' '${marker}' '7'\r`);

      await vi.waitFor(
        () => {
          const output = Buffer.concat(
            terminal.messages.flatMap((message) =>
              message.type === "data" ? [message.bytes] : [],
            ),
          ).toString();
          expect(output).toContain(`${marker}7`);
        },
        { timeout: realProcessTimeout },
      );
      expect(terminal.failure).not.toHaveBeenCalled();
      await terminal.disconnect();
      await expect(backend.run(["has-session", "-t", sessionId])).resolves.toBe(
        "",
      );
    }
  });

  it("reports a native switch-client for its PTY client", async () => {
    const backend = createIsolatedTmuxBackend();
    const { first, second } = await createSessionPair(backend);
    const terminal = await connectTerminal(
      withControlTransport(backend),
      first,
    );
    const client = await readNativeTerminalClient(backend);

    await backend.run(["switch-client", "-c", client.name, "-t", `=${second}`]);
    await terminal.waitForSession(second);

    expect(terminal.failure).not.toHaveBeenCalled();
    await terminal.disconnect();
  });

  it("confirms session/window active panes and selects a pane in the same full-window client", async () => {
    const backend = createIsolatedTmuxBackend();
    const sessionId = await createTmuxSession(backend, "source");
    const target = await createWindow(backend, sessionId);
    const otherPane = (
      await backend.run([
        "split-window",
        "-d",
        "-P",
        "-F",
        "#{pane_id}",
        "-h",
        "-t",
        target.paneId,
        "sh",
      ])
    ).trim();
    const terminal = await connectTerminal(
      withControlTransport(backend),
      sessionId,
    );
    const before = await readNativeTerminalClient(backend);

    await expect(
      terminal.client.goTo({ sessionId, windowId: target.windowId }),
    ).resolves.toEqual(target);
    const paneTarget = { ...target, paneId: otherPane };
    await expect(terminal.client.goTo(paneTarget)).resolves.toEqual(paneTarget);
    await expect(terminal.client.goTo({ sessionId })).resolves.toEqual(
      paneTarget,
    );
    await expect(
      terminal.client.goTo({ sessionId, windowId: target.windowId }),
    ).resolves.toEqual(paneTarget);

    const after = await readNativeTerminalClient(backend);
    expect({ name: after.name, pid: after.pid }).toEqual({
      name: before.name,
      pid: before.pid,
    });
    expect(
      await backend.run([
        "list-panes",
        "-t",
        `${sessionId}:${target.windowId}`,
        "-F",
        "#{pane_id}",
      ]),
    ).toContain(target.paneId);
    expect(
      await backend.run(["list-clients", "-F", "#{client_flags}"]),
    ).not.toContain("active-pane");
    terminal.send({ data: "printf 'SELECTEDPANE7\\n'\r", type: "input" });
    await waitForPaneOutput(backend, otherPane, "SELECTEDPANE7");
    await terminal.disconnect();
  });

  it("rejects hierarchy errors without detaching and respects linked-window session context", async () => {
    const backend = createIsolatedTmuxBackend();
    const { first, second } = await createSessionPair(backend);
    const firstWindow = await createWindow(backend, first);
    const secondWindow = await createWindow(backend, second);
    const terminal = await connectTerminal(backend, first);
    const before = await readNativeTerminalClient(backend);

    await expect(
      terminal.client.goTo({ sessionId: "$99999" }),
    ).rejects.toThrow();
    await expect(
      terminal.client.goTo({ ...secondWindow, sessionId: first }),
    ).rejects.toThrow("does not belong to session");
    await expect(
      terminal.client.goTo({ ...firstWindow, paneId: secondWindow.paneId }),
    ).rejects.toThrow("does not belong to window");
    await backend.run([
      "link-window",
      "-s",
      `${second}:${secondWindow.windowId}`,
      "-t",
      `${first}:`,
    ]);
    const linked = { ...secondWindow, sessionId: first };
    await expect(terminal.client.goTo(linked)).resolves.toEqual(linked);

    expect((await readNativeTerminalClient(backend)).name).toBe(before.name);
    await waitForLocation(terminal, linked);
    expect(terminal.failure).not.toHaveBeenCalled();
    await terminal.disconnect();
  });

  it("follows native keyboard/mouse changes and shared pane selection across linked sessions", async () => {
    const backend = createIsolatedTmuxBackend();
    const { first, second } = await createSessionPair(backend);
    const target = await createWindow(backend, second);
    const otherPane = (
      await backend.run([
        "split-window",
        "-d",
        "-P",
        "-F",
        "#{pane_id}",
        "-h",
        "-t",
        target.paneId,
        "sh",
      ])
    ).trim();
    await backend.run([
      "link-window",
      "-s",
      `${second}:${target.windowId}`,
      "-t",
      `${first}:`,
    ]);
    await backend.run(["set-option", "-g", "mouse", "on"]);
    await backend.run([
      "bind-key",
      "-n",
      "F12",
      "select-window",
      "-t",
      `${second}:${target.windowId}`,
    ]);
    const terminal = await connectTerminal(
      withControlTransport(backend),
      second,
    );

    terminal.client.input("\u001b[24~");
    await waitForLocation(terminal, target);
    terminal.client.input("\u0002o");
    await waitForLocation(terminal, { ...target, paneId: otherPane });
    await backend.run([
      "select-pane",
      "-t",
      `${first}:${target.windowId}.${target.paneId}`,
    ]);
    await waitForLocation(terminal, target);
    // xterm's extended mouse protocol sends button/cell coordinates for a right-pane click.
    terminal.client.input("\u001b[<0;60;2M\u001b[<0;60;2m");
    await waitForLocation(terminal, { ...target, paneId: otherPane });

    expect(terminal.failure).not.toHaveBeenCalled();
    await terminal.disconnect();
  });

  it("collapses competing navigation and confirms only the latest request", async () => {
    const backend = createIsolatedTmuxBackend();
    const { first, second } = await createSessionPair(backend);
    const target = await createWindow(backend, second);
    const terminal = await connectTerminal(backend, first);
    const before = await readNativeTerminalClient(backend);

    const superseded = terminal.client
      .goTo({ sessionId: second })
      .catch((error: Error) => error);
    const selected = terminal.client.goTo(target);
    await expect(superseded).resolves.toMatchObject({ name: "AbortError" });
    await expect(selected).resolves.toEqual(target);
    await waitForLocation(terminal, target);
    expect((await readNativeTerminalClient(backend)).pid).toBe(before.pid);
    await terminal.disconnect();
  });

  it("does not resize existing windows before renderer geometry arrives and redraws on mount", async () => {
    const backend = createIsolatedTmuxBackend();
    const sessionId = await createTmuxSession(backend, "source");
    const existing = await connectTerminal(backend, sessionId);
    existing.client.resize({ cols: 143, rows: 47 });
    const dimensions = () =>
      backend.run([
        "list-windows",
        "-t",
        sessionId,
        "-F",
        "#{window_width}|#{window_height}|#{window_layout}",
      ]);
    await vi.waitFor(async () =>
      expect(await dimensions()).toMatch(/^143\|46\|/),
    );
    const before = await dimensions();

    const pendingRenderer = await connectTerminal(backend, sessionId, false);
    expect(await dimensions()).toBe(before);
    expect(
      await backend.run(["list-clients", "-F", "#{client_flags}"]),
    ).toContain("ignore-size");
    const clientsBefore = await backend.run([
      "list-clients",
      "-F",
      "#{client_name}|#{client_pid}",
    ]);
    const outputCount = pendingRenderer.messages.filter(
      (message) => message.type === "data",
    ).length;
    pendingRenderer.client.resize({ cols: 111, rows: 33 });
    pendingRenderer.client.redraw();
    await vi.waitFor(async () =>
      expect(await dimensions()).toMatch(/^111\|32\|/),
    );
    await vi.waitFor(() =>
      expect(
        pendingRenderer.messages.filter((message) => message.type === "data")
          .length,
      ).toBeGreaterThan(outputCount),
    );

    expect(
      await backend.run(["list-clients", "-F", "#{client_name}|#{client_pid}"]),
    ).toBe(clientsBefore);
    expect(
      await backend.run(["list-clients", "-F", "#{client_flags}"]),
    ).not.toContain("active-pane");
    expect(pendingRenderer.failure).not.toHaveBeenCalled();

    await pendingRenderer.disconnect();
    await existing.disconnect();
  });

  it("switches sessions through the same PTY client and adopts its geometry", async () => {
    const backend = createIsolatedTmuxBackend();
    const { first, second } = await createSessionPair(backend);
    const terminal = await connectTerminal(backend, first);
    const clientBefore = await readNativeTerminalClient(backend);

    const selected = terminal.client.goTo({ sessionId: second });
    terminal.send({ cols: 111, rows: 33, type: "resize" });
    await vi.waitFor(
      async () =>
        expect(await readNativeTerminalClient(backend)).toMatchObject({
          height: "33",
          sessionId: second,
          width: "111",
        }),
      { timeout: realProcessTimeout },
    );
    await expect(selected).resolves.toMatchObject({ sessionId: second });
    const clientAfter = await readNativeTerminalClient(backend);

    expect({ name: clientAfter.name, pid: clientAfter.pid }).toEqual({
      name: clientBefore.name,
      pid: clientBefore.pid,
    });
    expect(terminal.failure).not.toHaveBeenCalled();
    await terminal.disconnect();
  });
});
