import { describe, expect, it, vi } from "vitest";

import type {
  TerminalDataMessage,
  TerminalInputMessage,
  TerminalRenderedMessage,
  TerminalResizeMessage,
} from "../shared/contracts";
import { createTerminalStreamClient } from "./terminal-client";

type OutboundMessage =
  | TerminalInputMessage
  | TerminalRenderedMessage
  | TerminalResizeMessage;

const setup = (status: "closed" | "open" | "opening" = "opening") => {
  let listener: ((message: TerminalDataMessage) => void) | undefined;
  const callbacks: Array<() => void> = [];
  const close = vi.fn();
  const onConnectionStatusChange = vi.fn();
  const onError = vi.fn();
  const send = vi.fn((_message: OutboundMessage) => true);
  const sink = {
    reset: vi.fn(),
    write: vi.fn((_bytes: Uint8Array, onProcessed: () => void) => {
      callbacks.push(onProcessed);
    }),
  };
  const connection = {
    close,
    send,
    status,
    subscribe: vi.fn((next: (message: TerminalDataMessage) => void) => {
      listener = next;
      return vi.fn();
    }),
  };
  const client = createTerminalStreamClient({
    connection,
    onConnectionStatusChange,
    onError,
    sink,
  });
  return {
    callbacks,
    client,
    close,
    connection,
    emit: (message: TerminalDataMessage) => listener?.(message),
    onConnectionStatusChange,
    onError,
    send,
    sink,
  };
};

const output = (sequence: number, terminalId = "terminal-1") => ({
  bytes: Uint8Array.from([sequence]),
  sequence,
  terminalId,
  type: "data" as const,
});

describe("terminal stream client", () => {
  it("coordinates stream output and rendered acknowledgements", () => {
    const { callbacks, client, emit, send, sink } = setup();
    emit(output(0));
    callbacks[0]?.();

    expect(sink.reset).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      sequence: 0,
      terminalId: "terminal-1",
      type: "rendered",
    });
    client.dispose();
  });

  it("replays cached size when fitting does not synchronously resize", () => {
    const { client, send } = setup();
    client.resize({ cols: 120, rows: 40 });
    send.mockClear();

    client.fitAndReportSize(vi.fn());

    expect(send).toHaveBeenCalledWith({
      cols: 120,
      rows: 40,
      type: "resize",
    });
  });

  it("does not duplicate a size reported synchronously by fitting", () => {
    const { client, send } = setup();
    client.resize({ cols: 80, rows: 24 });
    send.mockClear();

    const rendererSize = {
      cols: 120,
      colsChanged: true,
      rows: 40,
      rowsChanged: true,
    };
    client.fitAndReportSize(() => client.resize(rendererSize));

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ cols: 120, rows: 40, type: "resize" });
  });

  it("reports truthful connection lifecycle independently of output", () => {
    const { client, connection, onConnectionStatusChange } = setup("opening");

    client.updateConnection({ ...connection, status: "open" });
    client.updateConnection({ ...connection, status: "closed" });

    expect(onConnectionStatusChange.mock.calls).toEqual([
      ["opening"],
      ["open"],
      ["closed"],
    ]);
  });

  it("sends binary input without converting it to text", () => {
    const { client, send } = setup("open");
    const bytes = Uint8Array.from([0, 128, 255]);

    client.input(bytes);

    expect(send).toHaveBeenCalledWith({ data: bytes, type: "input" });
  });

  it("closes the connection when ordered output processing fails", () => {
    const { client, close, emit, onError } = setup();
    emit(output(1));

    expect(close).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      new Error("Terminal output arrived out of order"),
    );
    client.dispose();
  });

  it("unsubscribes and closes once during disposal", () => {
    const { client, close, connection } = setup();
    const unsubscribe = connection.subscribe.mock.results[0]?.value;

    client.dispose();
    client.dispose();

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
