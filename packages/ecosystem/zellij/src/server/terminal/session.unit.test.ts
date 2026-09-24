import type { PtyProcess, PtySpawnOptions } from "@overmux/pty/server";
import { describe, expect, it, vi } from "vitest";

import {
  zellijTerminalInputLimit,
  type ZellijTerminalServerMessage,
} from "../../shared/terminal-contracts";
import type { ZellijBackend } from "../backend";
import { createZellijTerminalSession } from "./session";

type FakePty = PtyProcess & {
  emitOutput: (data: string) => void;
  exit: (exitCode: number, signal?: number) => void;
};
const fakePty = (): FakePty => {
  let dataListener: ((data: string) => void) | undefined;
  let exitListener:
    | ((event: { exitCode: number; signal?: number }) => void)
    | undefined;
  return {
    emitOutput: (data) => dataListener?.(data),
    exit: (exitCode, signal) => exitListener?.({ exitCode, signal }),
    kill: vi.fn((signal?: string) => {
      if (signal === "SIGHUP") {
        exitListener?.({ exitCode: 0 });
      }
    }),
    onData: vi.fn((listener) => {
      dataListener = listener;
      return { dispose: vi.fn() };
    }),
    onExit: vi.fn((listener) => {
      exitListener = listener;
      return { dispose: vi.fn() };
    }),
    pause: vi.fn(),
    pid: 123,
    resize: vi.fn(),
    resume: vi.fn(),
    write: vi.fn(),
  };
};
const setup = ({ allowInput = true } = {}) => {
  const process = fakePty();
  const ptyFactory = vi.fn((_options: PtySpawnOptions) => process);
  const messages: ZellijTerminalServerMessage[] = [];
  const controller = new AbortController();
  const fail = vi.fn();
  const backend = {
    executable: "custom-zellij",
    read: vi.fn(async () => ({
      backend: { id: "test" },
      connected: true,
      sessions: [{ name: "demo", tabs: [] }],
    })),
  } as unknown as ZellijBackend;
  const session = createZellijTerminalSession({
    allowInput,
    backend,
    emit: (message) => messages.push(message),
    fail,
    outputChunkSize: 3,
    ptyFactory,
    sessionName: "demo",
    signal: controller.signal,
  });
  return { controller, fail, messages, process, ptyFactory, session };
};

describe("Zellij terminal session", () => {
  it("waits for initial resize, validates, attaches, and flushes bounded byte-preserving input", async () => {
    const terminal = setup();
    const binary = Uint8Array.from([0, 128, 255]);
    terminal.session.onMessage?.({ data: "echo ready\r", type: "input" });
    terminal.session.onMessage?.({ data: binary, type: "input" });
    expect(terminal.ptyFactory).not.toHaveBeenCalled();

    terminal.session.onMessage?.({ cols: 101, rows: 37, type: "resize" });
    await vi.waitFor(() => expect(terminal.ptyFactory).toHaveBeenCalledOnce());

    expect(terminal.ptyFactory).toHaveBeenCalledWith({
      args: ["attach", "demo"],
      cols: 101,
      command: "custom-zellij",
      env: {
        COLORTERM: "truecolor",
        TERM: "xterm-256color",
        TERM_PROGRAM: "overmux",
      },
      rows: 37,
    });
    expect(terminal.process.write).toHaveBeenNthCalledWith(1, "echo ready\r");
    expect(terminal.process.write).toHaveBeenNthCalledWith(
      2,
      Buffer.from(binary),
    );
    await terminal.session.dispose?.();
  });

  it("rejects early input beyond the bounded attach queue", async () => {
    const terminal = setup();
    const first = new Uint8Array(zellijTerminalInputLimit);

    terminal.session.onMessage?.({ data: first, type: "input" });
    expect(() =>
      terminal.session.onMessage?.({ data: Uint8Array.of(1), type: "input" }),
    ).toThrow("Terminal received too much input before attaching");
    expect(terminal.ptyFactory).not.toHaveBeenCalled();
    await terminal.session.dispose?.();
  });

  it("drops read-only input and forwards output through shared flow control", async () => {
    const terminal = setup({ allowInput: false });
    terminal.session.onMessage?.({ data: "before", type: "input" });
    terminal.session.onMessage?.({ cols: 80, rows: 24, type: "resize" });
    await vi.waitFor(() => expect(terminal.ptyFactory).toHaveBeenCalledOnce());
    terminal.session.onMessage?.({ data: "after", type: "input" });
    terminal.process.emitOutput("abcdef");

    expect(terminal.process.write).not.toHaveBeenCalled();
    expect(terminal.messages).toHaveLength(2);
    expect(terminal.messages.map((message) => message.bytes)).toEqual([
      Uint8Array.from([97, 98, 99]),
      Uint8Array.from([100, 101, 102]),
    ]);
    terminal.messages.forEach((message) =>
      terminal.session.onMessage?.({
        sequence: message.sequence,
        terminalId: message.terminalId,
        type: "rendered",
      }),
    );
    await terminal.session.dispose?.();
  });

  it("fails unexpected exit and performs idempotent SIGHUP cleanup", async () => {
    const terminal = setup();
    terminal.session.onMessage?.({ cols: 80, rows: 24, type: "resize" });
    await vi.waitFor(() => expect(terminal.ptyFactory).toHaveBeenCalledOnce());

    terminal.process.exit(7, 9);
    await vi.waitFor(() =>
      expect(terminal.fail).toHaveBeenCalledWith(
        new Error("Zellij terminal client exited (code 7, signal 9)"),
      ),
    );
    const first = terminal.session.dispose?.();
    const second = terminal.session.dispose?.();
    expect(first).toBe(second);
    await first;
  });

  it("terminates only the attached client on stream cancellation", async () => {
    const terminal = setup();
    terminal.session.onMessage?.({ cols: 80, rows: 24, type: "resize" });
    await vi.waitFor(() => expect(terminal.ptyFactory).toHaveBeenCalledOnce());

    terminal.controller.abort();
    await terminal.session.dispose?.();

    expect(terminal.process.kill).toHaveBeenCalledWith("SIGHUP");
    expect(terminal.fail).not.toHaveBeenCalled();
  });
});
