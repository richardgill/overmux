import { describe, expect, it, vi } from "vitest";

import type { TerminalRenderedMessage } from "../shared/contracts";
import { createTerminalOutputProcessor } from "./output-processor";

const setup = () => {
  const callbacks: Array<() => void> = [];
  const onFailure = vi.fn();
  const sendRendered = vi.fn((_message: TerminalRenderedMessage) => true);
  const sink = {
    reset: vi.fn(),
    write: vi.fn((_bytes: Uint8Array, callback: () => void) => {
      callbacks.push(callback);
    }),
  };
  const processor = createTerminalOutputProcessor({
    onFailure,
    sendRendered,
    sink,
  });
  return {
    callbacks,
    onFailure,
    processor,
    send: sendRendered,
    terminal: sink,
  };
};

const message = (sequence: number, terminalId = "terminal-1") => ({
  bytes: Uint8Array.from([sequence]),
  sequence,
  terminalId,
  type: "data" as const,
});

const messages = (count: number) =>
  Array.from({ length: count }, (_, sequence) => message(sequence));

const rendered = (sequence: number): TerminalRenderedMessage => ({
  sequence,
  terminalId: "terminal-1",
  type: "rendered",
});

const completeWrites = (callbacks: Array<() => void>) =>
  callbacks.forEach((callback) => callback());

describe("terminal message processor", () => {
  it("pipelines ordered renderer writes and acknowledges rendered bytes", () => {
    const { callbacks, processor, send, terminal } = setup();
    messages(3).forEach((entry) => processor.enqueue(entry));

    expect(terminal.reset).toHaveBeenCalledOnce();
    expect(terminal.write).toHaveBeenCalledTimes(3);
    expect(send).not.toHaveBeenCalled();
    completeWrites(callbacks);

    expect(send).toHaveBeenNthCalledWith(1, rendered(0));
    expect(send).toHaveBeenNthCalledWith(2, rendered(1));
    expect(send).toHaveBeenNthCalledWith(3, rendered(2));
  });

  it("pauses above the renderer high watermark and resumes below its low watermark", () => {
    const { callbacks, processor, terminal } = setup();
    messages(12).forEach((entry) => processor.enqueue(entry));

    expect(terminal.write).toHaveBeenCalledTimes(11);
    callbacks.slice(0, 7).forEach((callback) => callback());
    expect(terminal.write).toHaveBeenCalledTimes(11);

    callbacks[7]?.();
    expect(terminal.write).toHaveBeenCalledTimes(12);
  });

  it("keeps acknowledgements ordered when callbacks arrive out of order", () => {
    const { callbacks, processor, send } = setup();
    processor.enqueue(message(0));
    processor.enqueue(message(1));

    callbacks[1]?.();
    expect(send).not.toHaveBeenCalled();
    callbacks[0]?.();

    expect(send).toHaveBeenNthCalledWith(1, rendered(0));
    expect(send).toHaveBeenNthCalledWith(2, rendered(1));
  });

  it("keeps rendering while the terminal view is inactive", () => {
    const { callbacks, processor, send, terminal } = setup();
    processor.enqueue(message(0));
    callbacks[0]?.();

    expect(terminal.write).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(rendered(0));
  });

  it("ignores stale writes and output after changing terminal generations", () => {
    const { callbacks, processor, send, terminal } = setup();
    processor.enqueue(message(0));
    processor.enqueue(message(0, "terminal-2"));

    callbacks[0]?.();
    expect(send).not.toHaveBeenCalled();
    expect(terminal.reset).toHaveBeenCalledTimes(2);
    expect(terminal.write).toHaveBeenCalledTimes(2);

    callbacks[1]?.();
    expect(send).toHaveBeenCalledWith({
      sequence: 0,
      terminalId: "terminal-2",
      type: "rendered",
    });
    processor.enqueue(message(1, "terminal-1"));
    expect(terminal.write).toHaveBeenCalledTimes(2);
  });

  it("fails cleanly when terminal output arrives out of order", () => {
    const { onFailure, processor, send, terminal } = setup();
    processor.enqueue(message(1));
    processor.enqueue(message(0));

    expect(terminal.write).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith(
      new Error("Terminal output arrived out of order"),
    );

    processor.connectionOpening();
    processor.enqueue(message(0, "terminal-2"));
    expect(terminal.write).toHaveBeenCalledOnce();
  });

  it("fails once when an acknowledgement cannot be sent", () => {
    const { callbacks, onFailure, processor, send } = setup();
    send.mockReturnValue(false);
    processor.enqueue(message(0));
    processor.enqueue(message(1));
    completeWrites(callbacks);

    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith(
      new Error("Terminal acknowledgement could not be sent"),
    );
    expect(send).toHaveBeenCalledOnce();
  });

  it("does not acknowledge pending writes completed after closure", () => {
    const { callbacks, processor, send } = setup();
    processor.enqueue(message(0));
    processor.enqueue(message(1));
    processor.connectionClosed();
    completeWrites(callbacks);

    expect(send).not.toHaveBeenCalled();
  });
});
