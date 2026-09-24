import { act, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test as testCases, vi } from "vitest";

import type {
  TmuxTerminalClientMessage,
  TmuxTerminalServerMessage,
} from "../shared/terminal-contracts";
import {
  useTmuxTerminal,
  type UseTmuxTerminalOptions,
  type UseTmuxTerminalResult,
} from "./use-tmux-terminal";

let container: HTMLDivElement;
let root: Root;
let terminal: UseTmuxTerminalResult;
const location = { sessionId: "$1", windowId: "@2", paneId: "%3" };

const Harness = (options: UseTmuxTerminalOptions) => {
  terminal = useTmuxTerminal(options);
  return null;
};

const Navigate = ({
  value,
  requests,
}: {
  value: UseTmuxTerminalResult;
  requests: Promise<unknown>[];
}) => {
  useLayoutEffect(() => {
    requests.push(
      value.goTo({ sessionId: "$1" }).catch((error: Error) => error),
    );
  }, [value.goTo, requests]);
  return null;
};
const EarlyHarness = ({
  stream,
  requests,
}: UseTmuxTerminalOptions & { requests: Promise<unknown>[] }) => {
  terminal = useTmuxTerminal({ stream });
  return <Navigate value={terminal} requests={requests} />;
};

const createStream = (status: "open" | "opening" = "open") => {
  let listener: ((message: TmuxTerminalServerMessage) => void) | undefined;
  const close = vi.fn();
  const send = vi.fn((_message: TmuxTerminalClientMessage) => true);
  const unsubscribe = vi.fn(() => {
    listener = undefined;
  });
  const stream = {
    connectionId: status === "open" ? Symbol() : undefined,
    close,
    send,
    status,
    subscribe: vi.fn((next) => {
      listener = next;
      return unsubscribe;
    }),
  };
  return {
    close,
    emit: (message: TmuxTerminalServerMessage) => listener?.(message),
    send,
    stream,
    unsubscribe,
  };
};

const rebindStream = (stream: UseTmuxTerminalOptions["stream"]) => ({
  ...stream,
  close: vi.fn(() => stream.close()),
  send: vi.fn((message: TmuxTerminalClientMessage) => stream.send(message)),
  subscribe: vi.fn((listener: (message: TmuxTerminalServerMessage) => void) =>
    stream.subscribe(listener),
  ),
});

const renderer = () => ({
  fit: vi.fn(),
  reset: vi.fn(),
  write: vi.fn((_bytes: Uint8Array, _done: () => void): void => {}),
});
const confirm = (requestId = 0, revision = 0): TmuxTerminalServerMessage => ({
  type: "go-to-result",
  requestId,
  result: { outcome: "success", location, revision },
});
const output = (
  sequence: number,
  terminalId = "terminal-1",
): TmuxTerminalServerMessage => ({
  type: "data",
  terminalId,
  sequence,
  bytes: Uint8Array.of(sequence),
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

testCases.each(["stable methods", "rebound methods"])(
  "rejects interrupted navigation and reattaches only the confirmed session: %s",
  async (scenario) => {
    const { close, emit, send, stream } = createStream();
    await act(async () => root.render(<Harness stream={stream} />));
    const initial = terminal.goTo(location);
    await act(async () => emit(confirm(0, 10)));
    await expect(initial).resolves.toEqual(location);
    const rejected = expect(
      terminal.goTo({ ...location, paneId: "%5" }),
    ).rejects.toThrow(/disconnect/i);

    const reopened = { ...stream, connectionId: Symbol() };
    await act(async () =>
      root.render(
        <Harness
          stream={
            scenario === "stable methods" ? reopened : rebindStream(reopened)
          }
        />,
      ),
    );

    expect(terminal.location).toBeUndefined();
    expect(close).not.toHaveBeenCalled();
    expect(
      send.mock.calls.filter(([message]) => message.type === "go-to"),
    ).toHaveLength(3);
    await rejected;
    expect(send).toHaveBeenLastCalledWith({
      type: "go-to",
      requestId: 2,
      target: { sessionId: "$1" },
    });
    // An old response cannot overwrite the recovered location.
    await act(async () => emit(confirm(1, 100)));
    expect(terminal.location).toBeUndefined();
    await act(async () => emit(confirm(2, 0)));
    expect(terminal.location).toEqual(location);
  },
);

testCases.each(["stable methods", "rebound methods"])(
  "owns the connection status and fitted-size handshake: %s",
  async (scenario) => {
    const { send, stream } = createStream("opening");
    const terminalRenderer = renderer();
    const onConnectionStatusChange = vi.fn();
    await act(async () =>
      root.render(
        <Harness
          onConnectionStatusChange={onConnectionStatusChange}
          stream={stream}
        />,
      ),
    );
    terminal.attachRenderer(terminalRenderer);
    act(() => terminal.resize({ cols: 120, rows: 40 }));
    send.mockClear();

    const opened = {
      ...stream,
      connectionId: Symbol(),
      status: "open" as const,
    };
    await act(async () =>
      root.render(
        <Harness
          onConnectionStatusChange={onConnectionStatusChange}
          stream={scenario === "stable methods" ? opened : rebindStream(opened)}
        />,
      ),
    );

    expect(send.mock.calls).toEqual([
      [{ cols: 120, rows: 40, type: "resize" }],
      [{ type: "redraw" }],
    ]);
    expect(terminalRenderer.fit).toHaveBeenCalledOnce();
    expect(onConnectionStatusChange.mock.calls).toEqual([
      ["opening"],
      ["open"],
    ]);
  },
);

testCases(
  "navigates headlessly, exposes only confirmed locations and keeps goTo stable",
  async () => {
    const { emit, send, stream } = createStream("opening");
    const onConnectionStatusChange = vi.fn();
    await act(async () =>
      root.render(
        <Harness
          stream={stream}
          onConnectionStatusChange={onConnectionStatusChange}
        />,
      ),
    );
    const goTo = terminal.goTo;
    const navigated = terminal.goTo({ sessionId: "$1" });
    expect(terminal.location).toBeUndefined();
    expect(send).not.toHaveBeenCalled();

    await act(async () =>
      root.render(
        <Harness
          stream={{ ...stream, connectionId: Symbol(), status: "open" }}
          onConnectionStatusChange={onConnectionStatusChange}
        />,
      ),
    );
    expect(send.mock.calls).toEqual([
      [{ type: "go-to", requestId: 0, target: { sessionId: "$1" } }],
    ]);
    expect(terminal.location).toBeUndefined();
    await act(async () => emit(confirm()));
    await expect(navigated).resolves.toEqual(location);
    expect(terminal.location).toEqual(location);
    expect(terminal.goTo).toBe(goTo);
    expect(onConnectionStatusChange.mock.calls).toEqual([
      ["opening"],
      ["open"],
    ]);

    const nativeLocation = { ...location, paneId: "%4" };
    await act(async () =>
      emit({ type: "location-changed", location: nativeLocation, revision: 1 }),
    );
    expect(terminal.location).toEqual(nativeLocation);
    expect(send).toHaveBeenCalledOnce();
  },
);

testCases(
  "buffers without acknowledgements until a renderer attaches, then fits and redraws",
  async () => {
    const { emit, send, stream } = createStream();
    await act(async () => root.render(<Harness stream={stream} />));
    emit(output(0));
    emit(output(1));
    expect(send).not.toHaveBeenCalled();
    const sink = renderer();
    sink.fit.mockImplementation(() => terminal.resize({ cols: 120, rows: 40 }));

    const detach = terminal.attachRenderer(sink);
    expect(sink.reset).toHaveBeenCalledOnce();
    expect(sink.write.mock.calls.map(([bytes]) => bytes)).toEqual([
      Uint8Array.of(0),
      Uint8Array.of(1),
    ]);
    expect(send.mock.calls).toEqual([
      [{ type: "resize", cols: 120, rows: 40 }],
      [{ type: "redraw" }],
    ]);
    sink.write.mock.calls[1]![1]();
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "rendered" }),
    );
    sink.write.mock.calls[0]![1]();
    expect(send.mock.calls.slice(2)).toEqual([
      [{ type: "rendered", terminalId: "terminal-1", sequence: 0 }],
      [{ type: "rendered", terminalId: "terminal-1", sequence: 1 }],
    ]);
    detach();
  },
);

testCases(
  "detaches in-flight writes once, retains location, and isolates later generations",
  async () => {
    const { close, emit, send, stream } = createStream();
    await act(async () => root.render(<Harness stream={stream} />));
    await act(async () =>
      emit({ type: "location-changed", location, revision: 0 }),
    );
    const first = renderer();
    const detach = terminal.attachRenderer(first);
    expect(() => terminal.attachRenderer(renderer())).toThrow(
      /only one renderer/,
    );
    emit(output(0));
    const staleCallback = first.write.mock.calls[0]![1];
    detach();
    detach();
    expect(
      send.mock.calls.filter(([message]) => message.type === "rendered"),
    ).toEqual([[{ type: "rendered", terminalId: "terminal-1", sequence: 0 }]]);
    emit(output(1));
    expect(close).not.toHaveBeenCalled();
    expect(terminal.location).toEqual(location);

    const replacement = renderer();
    const detachReplacement = terminal.attachRenderer(replacement);
    detach();
    expect(replacement.write).toHaveBeenCalledOnce();
    emit(output(0, "terminal-2"));
    send.mockClear();
    staleCallback();
    replacement.write.mock.calls[0]![1]();
    expect(send).not.toHaveBeenCalled();
    replacement.write.mock.calls[1]![1]();
    expect(send).toHaveBeenCalledExactlyOnceWith({
      type: "rendered",
      terminalId: "terminal-2",
      sequence: 0,
    });
    detachReplacement();
  },
);

testCases(
  "bounds unrendered delivery and resumes it after attachment",
  async () => {
    const { emit, send, stream } = createStream();
    await act(async () => root.render(<Harness stream={stream} />));
    Array.from({ length: 30 }, (_, sequence) => emit(output(sequence)));
    expect(send).not.toHaveBeenCalled();
    const sink = renderer();
    const detach = terminal.attachRenderer(sink);
    expect(sink.write).toHaveBeenCalledTimes(11);
    sink.write.mockImplementation((_bytes, done) => done());
    sink.write.mock.calls.slice(0, 11).forEach(([, done]) => done());
    expect(sink.write).toHaveBeenCalledTimes(30);
    expect(send).toHaveBeenCalledWith({
      type: "rendered",
      terminalId: "terminal-1",
      sequence: 29,
    });
    detach();
  },
);

testCases(
  "rebinds methods without reopening or losing pending navigation on the same server stream",
  async () => {
    const { close, emit, send, stream } = createStream();
    await act(async () => root.render(<Harness stream={stream} />));
    const pending = terminal.goTo(location);
    void pending.catch(() => undefined);
    const stale = stream.subscribe.mock.calls[0]![0];
    const rebound = rebindStream(stream);

    await act(async () => root.render(<Harness stream={rebound} />));

    expect(close).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () =>
      stale({
        type: "location-changed",
        location: { ...location, paneId: "%99" },
        revision: 99,
      }),
    );
    expect(terminal.location).toBeUndefined();
    await act(async () => emit(confirm()));
    await expect(pending).resolves.toEqual(location);
    const next = terminal.goTo({ sessionId: "$2" });
    expect(rebound.send).toHaveBeenCalledWith({
      type: "go-to",
      requestId: 1,
      target: { sessionId: "$2" },
    });
    await act(async () => emit(confirm(1, 1)));
    await expect(next).resolves.toEqual(location);
  },
);

testCases(
  "routes child layout-effect navigation to a replacement transport, not the old client",
  async () => {
    const first = createStream();
    const replacement = createStream();
    const firstRequests: Promise<unknown>[] = [];
    const replacementRequests: Promise<unknown>[] = [];
    await act(async () =>
      root.render(
        <EarlyHarness stream={first.stream} requests={firstRequests} />,
      ),
    );
    await act(async () => first.emit(confirm()));
    expect(await firstRequests[0]).toEqual(location);
    first.send.mockClear();

    await act(async () =>
      root.render(
        <EarlyHarness
          stream={replacement.stream}
          requests={replacementRequests}
        />,
      ),
    );
    expect(first.send).not.toHaveBeenCalled();
    expect(first.close).not.toHaveBeenCalled();
    expect(terminal.location).toBeUndefined();
    expect(replacement.send).toHaveBeenCalledExactlyOnceWith({
      type: "go-to",
      requestId: 1,
      target: { sessionId: "$1" },
    });
    await act(async () => replacement.emit(confirm(1)));
    expect(await replacementRequests[0]).toEqual(location);
    expect(terminal.location).toEqual(location);
  },
);

testCases(
  "disconnect clears location and rejects both interrupted and new navigation",
  async () => {
    const { close, emit, send, stream, unsubscribe } = createStream();
    await act(async () => root.render(<Harness stream={stream} />));
    await act(async () =>
      emit({ type: "location-changed", location, revision: 0 }),
    );
    const rejected = expect(terminal.goTo({ sessionId: "$2" })).rejects.toThrow(
      /disconnect/i,
    );
    await act(async () =>
      root.render(
        <Harness
          stream={{ ...stream, connectionId: undefined, status: "closed" }}
        />,
      ),
    );
    await rejected;
    expect(terminal.location).toBeUndefined();
    await expect(terminal.goTo({ sessionId: "$2" })).rejects.toThrow(
      /disconnect/i,
    );
    await act(async () =>
      root.render(<Harness stream={{ ...stream, connectionId: Symbol() }} />),
    );
    expect(send).toHaveBeenLastCalledWith({
      type: "go-to",
      requestId: 1,
      target: { sessionId: "$1" },
    });
    await act(async () => emit(confirm(1)));
    await act(async () => root.unmount());
    root = createRoot(container);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    await expect(terminal.goTo({ sessionId: "$1" })).rejects.toThrow(/dispos/i);
  },
);

testCases.each([
  { name: "normal mount", strict: false, requestId: 0 },
  { name: "StrictMode setup replay", strict: true, requestId: 1 },
])(
  "queues headless child layout-effect navigation across delayed opening: $name",
  async ({ strict, requestId }) => {
    const { close, emit, send, stream, unsubscribe } = createStream("opening");
    const requests: Promise<unknown>[] = [];
    const connectionId = Symbol();
    const render = (status: "opening" | "open") => {
      const harness = (
        <EarlyHarness
          stream={{
            ...stream,
            connectionId: status === "open" ? connectionId : undefined,
            status,
          }}
          requests={requests}
        />
      );
      root.render(strict ? <StrictMode>{harness}</StrictMode> : harness);
    };
    await act(async () => render("opening"));
    const goTo = terminal.goTo;
    const settled = vi.fn();
    void requests[requestId]!.then(settled);

    // Drain real microtasks between commits, including the deferred cleanup lease.
    for (let renderCount = 0; renderCount < 3; renderCount += 1) {
      await act(async () => {
        await Promise.resolve();
        render("opening");
      });
      expect(settled).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      expect(terminal.location).toBeUndefined();
      expect(terminal.error).toBeUndefined();
      expect(terminal.goTo).toBe(goTo);
    }
    expect(requests).toHaveLength(requestId + 1);
    if (strict) {
      expect(await requests[0]).toMatchObject({ name: "AbortError" });
    }
    expect(close).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledTimes(strict ? 1 : 0);
    expect(stream.subscribe).toHaveBeenCalledTimes(strict ? 2 : 1);

    await act(async () => render("open"));
    expect(send).toHaveBeenCalledExactlyOnceWith({
      type: "go-to",
      target: { sessionId: "$1" },
      requestId,
    });
    expect(settled).not.toHaveBeenCalled();
    expect(terminal.location).toBeUndefined();
    await act(async () => emit(confirm(requestId)));
    expect(await requests[requestId]).toEqual(location);
    expect(settled).toHaveBeenCalledExactlyOnceWith(location);
    expect(terminal.location).toEqual(location);
    expect(terminal.goTo).toBe(goTo);
    expect(close).not.toHaveBeenCalled();
  },
);

const recoveryCases = [
  "disconnect",
  "batched reconnect",
  "transport replacement",
];
testCases.each(recoveryCases)(
  "reattaches the latest native session and follows tmux's current pane: %s",
  async (scenario) => {
    const first = createStream();
    await act(async () => root.render(<Harness stream={first.stream} />));
    const initial = terminal.goTo({ sessionId: "$1" });
    await act(async () => first.emit(confirm(0, 10)));
    await initial;
    const native = { sessionId: "$2", windowId: "@4", paneId: "%5" };
    await act(async () =>
      first.emit({ type: "location-changed", location: native, revision: 11 }),
    );
    expect(first.send).toHaveBeenCalledTimes(1);
    if (scenario === "disconnect") {
      await act(async () =>
        root.render(
          <Harness
            stream={{
              ...first.stream,
              connectionId: undefined,
              status: "closed",
            }}
          />,
        ),
      );
      expect(terminal.location).toBeUndefined();
    }
    const next = scenario === "transport replacement" ? createStream() : first;
    const stream = { ...next.stream, connectionId: Symbol() };
    await act(async () => root.render(<Harness stream={stream} />));
    const requestId = 1;
    expect(next.send).toHaveBeenLastCalledWith({
      type: "go-to",
      requestId,
      target: { sessionId: native.sessionId },
    });
    const current = { ...native, paneId: "%6" };
    await act(async () =>
      next.emit({
        type: "go-to-result",
        requestId,
        result: { outcome: "success", location: current, revision: 0 },
      }),
    );
    expect(terminal.location).toEqual(current);
    const calls = next.send.mock.calls.length;
    await act(async () => root.render(<Harness stream={{ ...stream }} />));
    expect(next.send).toHaveBeenCalledTimes(calls);
  },
);

testCases.each(["opening", "recovering"])(
  "invalid navigation does not suppress recovery or its failure: %s",
  async (phase) => {
    const { emit, send, stream } = createStream();
    await act(async () => root.render(<Harness stream={stream} />));
    await act(async () =>
      emit({ type: "location-changed", location, revision: 0 }),
    );
    await act(async () =>
      root.render(
        <Harness
          stream={{ ...stream, connectionId: undefined, status: "opening" }}
        />,
      ),
    );
    const reopened = { ...stream, connectionId: Symbol() };
    if (phase === "recovering") {
      await act(async () => root.render(<Harness stream={reopened} />));
    }

    await expect(terminal.goTo({ sessionId: "invalid" })).rejects.toThrow(
      "Invalid tmux navigation target",
    );
    await act(async () => root.render(<Harness stream={reopened} />));

    expect(send).toHaveBeenCalledExactlyOnceWith({
      type: "go-to",
      requestId: 0,
      target: { sessionId: location.sessionId },
    });
    await act(async () =>
      emit({
        type: "go-to-result",
        requestId: 0,
        result: { outcome: "error", message: "Session disappeared" },
      }),
    );
    expect(terminal.error?.message).toBe("Session disappeared");
  },
);

const failureCases = ["server rejection", "rejected send"];
testCases.each(failureCases)(
  "reports recovery failure without retrying a failed target: %s",
  async (failure) => {
    const { emit, send, stream } = createStream();
    const onError = vi.fn();
    await act(async () =>
      root.render(<Harness stream={stream} onError={onError} />),
    );
    await act(async () =>
      emit({ type: "location-changed", location, revision: 0 }),
    );
    if (failure === "rejected send") {
      send.mockReturnValueOnce(false);
    }
    const next = { ...stream, connectionId: Symbol() };
    await act(async () =>
      root.render(<Harness stream={next} onError={onError} />),
    );
    if (failure === "server rejection") {
      await act(async () =>
        emit({
          type: "go-to-result",
          requestId: 0,
          result: { outcome: "error", message: "Pane disappeared" },
        }),
      );
    }
    expect(terminal.error).toBeInstanceOf(Error);
    expect(onError).toHaveBeenCalledWith(terminal.error);
    expect(terminal.location).toBeUndefined();
    await act(async () =>
      root.render(
        <Harness
          stream={{ ...next, connectionId: Symbol() }}
          onError={onError}
        />,
      ),
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(terminal.error).toBeInstanceOf(Error);
    const requested = terminal.goTo(location);
    await act(async () => emit(confirm(1)));
    await expect(requested).resolves.toEqual(location);
    expect(terminal.error).toBeUndefined();
  },
);

testCases(
  "unmount rejects an opening request without waiting for a renderer",
  async () => {
    const { stream } = createStream("opening");
    await act(async () => root.render(<Harness stream={stream} />));
    const rejected = expect(terminal.goTo({ sessionId: "$1" })).rejects.toThrow(
      /dispos/i,
    );
    await act(async () => root.unmount());
    root = createRoot(container);
    await rejected;
  },
);
