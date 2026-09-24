import { describe, expect, it, vi } from "vitest";

import type { TerminalDataMessage } from "@overmux/terminal-stream/shared";

import { createZellijTerminalClient } from "./terminal-client";

describe("Zellij terminal client", () => {
  it("resets rendering when a replacement fixed stream has a new terminal generation", () => {
    let listener: ((message: TerminalDataMessage) => void) | undefined;
    const send = vi.fn(() => true);
    const sink = {
      reset: vi.fn(),
      write: vi.fn((_bytes: Uint8Array, processed: () => void) => processed()),
    };
    const client = createZellijTerminalClient({
      connection: {
        close: vi.fn(),
        send,
        status: "open",
        subscribe: (next) => {
          listener = next;
          return () => undefined;
        },
      },
      sink,
    });

    listener?.({
      bytes: Uint8Array.of(1),
      sequence: 0,
      terminalId: "a",
      type: "data",
    });
    listener?.({
      bytes: Uint8Array.of(2),
      sequence: 0,
      terminalId: "b",
      type: "data",
    });

    expect(sink.reset).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, {
      sequence: 0,
      terminalId: "a",
      type: "rendered",
    });
    expect(send).toHaveBeenNthCalledWith(2, {
      sequence: 0,
      terminalId: "b",
      type: "rendered",
    });
    client.dispose();
  });
});
