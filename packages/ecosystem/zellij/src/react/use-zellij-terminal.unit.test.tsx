import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test as testCases, vi } from "vitest";

import type { ZellijTerminalServerMessage } from "../shared/terminal-contracts";
import {
  useZellijTerminal,
  type UseZellijTerminalOptions,
  type UseZellijTerminalResult,
} from "./index";

let container: HTMLDivElement;
let root: Root;
let terminal: UseZellijTerminalResult;
const Harness = (options: UseZellijTerminalOptions) => {
  terminal = useZellijTerminal(options);
  return null;
};
const createStream = () => {
  let listener: ((message: ZellijTerminalServerMessage) => void) | undefined;
  const unsubscribe = vi.fn(() => {
    listener = undefined;
  });
  const stream = {
    close: vi.fn(),
    send: vi.fn(() => true),
    status: "open" as const,
    subscribe: vi.fn((next) => {
      listener = next;
      return unsubscribe;
    }),
  };
  return {
    stream,
    unsubscribe,
    emit: (message: ZellijTerminalServerMessage) => listener?.(message),
  };
};
const renderer = () => ({
  fit: vi.fn(),
  reset: vi.fn(),
  write: vi.fn((_bytes: Uint8Array, _done: () => void): void => {}),
});
const output = (
  sequence: number,
  terminalId = "a",
): ZellijTerminalServerMessage => ({
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

testCases(
  "bounds unrendered delivery, resumes on attachment, and acknowledges in order",
  async () => {
    const { stream, emit } = createStream();
    await act(async () => root.render(<Harness stream={stream} />));
    Array.from({ length: 30 }, (_, sequence) => emit(output(sequence)));
    expect(stream.send).not.toHaveBeenCalled();
    const sink = renderer();
    const detach = terminal.attachRenderer(sink);
    expect(sink.write).toHaveBeenCalledTimes(11);
    sink.write.mock.calls[1]![1]();
    expect(stream.send).not.toHaveBeenCalled();
    sink.write.mock.calls[0]![1]();
    expect(stream.send.mock.calls).toEqual([
      [{ type: "rendered", terminalId: "a", sequence: 0 }],
      [{ type: "rendered", terminalId: "a", sequence: 1 }],
    ]);
    sink.write.mockImplementation((_bytes, done) => done());
    sink.write.mock.calls.slice(2, 11).forEach(([, done]) => done());
    expect(sink.write).toHaveBeenCalledTimes(30);
    expect(stream.send).toHaveBeenCalledTimes(30);
    detach();
  },
);

testCases(
  "detaches in-flight writes once and isolates replacement renderer and terminal generations",
  async () => {
    const { stream, emit } = createStream();
    await act(async () => root.render(<Harness stream={stream} />));
    const first = renderer();
    const detach = terminal.attachRenderer(first);
    expect(() => terminal.attachRenderer(renderer())).toThrow(
      /only one renderer/,
    );
    emit(output(0));
    const stale = first.write.mock.calls[0]![1];
    detach();
    detach();
    expect(stream.send).toHaveBeenCalledExactlyOnceWith({
      type: "rendered",
      terminalId: "a",
      sequence: 0,
    });
    emit(output(1));
    expect(stream.close).not.toHaveBeenCalled();
    const next = renderer();
    terminal.attachRenderer(next);
    detach();
    expect(next.write).toHaveBeenCalledExactlyOnceWith(
      Uint8Array.of(1),
      expect.any(Function),
    );
    emit(output(0, "b"));
    stream.send.mockClear();
    stale();
    next.write.mock.calls[0]![1]();
    expect(stream.send).not.toHaveBeenCalled();
    next.write.mock.calls[1]![1]();
    expect(stream.send).toHaveBeenCalledExactlyOnceWith({
      type: "rendered",
      terminalId: "b",
      sequence: 0,
    });
  },
);

testCases(
  "replaces the transport, drops old buffered output and errors, and keeps methods stable",
  async () => {
    const first = createStream();
    const next = createStream();
    const error = new Error("old transport failed");
    await act(async () =>
      root.render(<Harness stream={{ ...first.stream, error }} />),
    );
    expect(terminal.error).toBe(error);
    first.emit(output(0));
    const { attachRenderer, input, resize } = terminal;
    await act(async () => root.render(<Harness stream={next.stream} />));
    expect(first.stream.close).toHaveBeenCalledOnce();
    expect(first.unsubscribe).toHaveBeenCalledOnce();
    expect(terminal).toMatchObject({
      attachRenderer,
      input,
      resize,
      error: undefined,
    });
    const sink = renderer();
    terminal.attachRenderer(sink);
    expect(sink.write).not.toHaveBeenCalled();
    next.emit(output(0));
    sink.write.mock.calls[0]![1]();
    terminal.input("new transport");
    expect(next.stream.send).toHaveBeenLastCalledWith({
      type: "input",
      data: "new transport",
    });
  },
);

testCases.each(["sequence", "acknowledgement"])(
  "exposes %s failures through the latest callback and invalidates pending writes",
  async (failure) => {
    const { stream, emit } = createStream();
    const oldOnError = vi.fn();
    const onError = vi.fn();
    const onConnectionStatusChange = vi.fn();
    await act(async () =>
      root.render(<Harness stream={stream} onError={oldOnError} />),
    );
    await act(async () =>
      root.render(
        <Harness
          stream={stream}
          onError={onError}
          onConnectionStatusChange={onConnectionStatusChange}
        />,
      ),
    );
    const sink = renderer();
    terminal.attachRenderer(sink);
    emit(output(0));
    await act(async () => {
      if (failure === "sequence") {
        emit(output(2));
      } else {
        stream.send.mockReturnValue(false);
        sink.write.mock.calls[0]![1]();
      }
    });
    expect(terminal.error?.message).toMatch(
      failure === "sequence" ? /out of order/ : /acknowledgement/,
    );
    expect(onError).toHaveBeenCalledExactlyOnceWith(terminal.error);
    expect(oldOnError).not.toHaveBeenCalled();
    expect(onConnectionStatusChange).toHaveBeenCalledExactlyOnceWith("closed");
    expect(stream.close).toHaveBeenCalledOnce();
    stream.send.mockClear();
    sink.write.mock.calls[0]![1]();
    expect(stream.send).not.toHaveBeenCalled();
  },
);

testCases(
  "survives StrictMode replay, fits on opening, and disposes only on owner unmount",
  async () => {
    const { stream, unsubscribe, emit } = createStream();
    const onConnectionStatusChange = vi.fn();
    const render = (status: "opening" | "open" | "closed") =>
      root.render(
        <StrictMode>
          <Harness
            stream={{ ...stream, status }}
            onConnectionStatusChange={onConnectionStatusChange}
          />
        </StrictMode>,
      );
    await act(async () => render("opening"));
    expect(stream.subscribe).toHaveBeenCalledOnce();
    expect(stream.close).not.toHaveBeenCalled();
    const sink = renderer();
    terminal.attachRenderer(sink);
    terminal.resize({ cols: 120, rows: 40 });
    stream.send.mockClear();
    await act(async () => render("open"));
    expect(sink.fit).toHaveBeenCalledOnce();
    expect(stream.send).toHaveBeenCalledExactlyOnceWith({
      type: "resize",
      cols: 120,
      rows: 40,
    });
    emit(output(0));
    await act(async () => render("closed"));
    stream.send.mockClear();
    sink.write.mock.calls[0]![1]();
    expect(stream.send).not.toHaveBeenCalled();
    expect(onConnectionStatusChange.mock.calls).toEqual([
      ["opening"],
      ["open"],
      ["closed"],
    ]);
    await act(async () => root.unmount());
    root = createRoot(container);
    expect(stream.close).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
    terminal.input("after unmount");
    expect(stream.send).not.toHaveBeenCalled();
  },
);
