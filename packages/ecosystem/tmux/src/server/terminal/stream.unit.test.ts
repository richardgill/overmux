// Covers the terminal stream contract, runtime wiring, and output chunk-size policy.
import type { PtyFactory } from "@overmux/pty/server";
import { afterEach, describe, expect, it, test as testCases, vi } from "vitest";

import type { TmuxBackend } from "../backend";
import {
  tmuxTerminalClientMessageSchema,
  tmuxTerminalOpenInputSchema,
  tmuxTerminalServerMessageSchema,
} from "../../shared/terminal-contracts";
import { defaultTmuxTerminalOutputChunkSize } from "./session";

const sessionMocks = vi.hoisted(() => ({
  createTmuxTerminalSession: vi.fn(),
}));

vi.mock("./session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session")>()),
  createTmuxTerminalSession: sessionMocks.createTmuxTerminalSession,
}));

import { tmuxStream } from "./stream";

const terminalStreamOptions = {
  backend: {} as TmuxBackend,
};

const createStreamContext = () => ({
  instance: {
    getInstanceId: () => "test",
    getDeepLinkPrefix: () => "overmux://test",
  },
  emit: vi.fn(),
  fail: vi.fn(),
  invalidate: vi.fn(),
  signal: new AbortController().signal,
});

afterEach(() => vi.clearAllMocks());

describe("tmux terminal stream", () => {
  it("defines the terminal schemas as its contract boundary", () => {
    const stream = tmuxStream(terminalStreamOptions);

    expect(stream.contract.input).toBe(tmuxTerminalOpenInputSchema);
    expect(stream.contract.clientMessage).toBe(tmuxTerminalClientMessageSchema);
    expect(stream.contract.serverMessage).toBe(tmuxTerminalServerMessageSchema);
  });

  it("maps stream options and runtime context into a terminal session", () => {
    const context = createStreamContext();
    const ptyFactory = vi.fn() as unknown as PtyFactory;
    const session = {};
    sessionMocks.createTmuxTerminalSession.mockReturnValue(session);
    const stream = tmuxStream({
      ...terminalStreamOptions,
      allowInput: false,
      geometryPolicy: "ignore-size",
      outputChunkSize: 1_024,
      ptyFactory,
    });

    const openedSession = stream.open(undefined, context);

    expect(openedSession).toBe(session);
    expect(sessionMocks.createTmuxTerminalSession).toHaveBeenCalledWith({
      allowInput: false,
      backend: terminalStreamOptions.backend,
      emit: context.emit,
      fail: context.fail,
      geometryPolicy: "ignore-size",
      outputChunkSize: 1_024,
      ptyFactory,
      signal: context.signal,
    });
  });

  it("uses the standard interactive defaults", () => {
    const context = createStreamContext();
    const stream = tmuxStream(terminalStreamOptions);

    stream.open(undefined, context);

    expect(sessionMocks.createTmuxTerminalSession).toHaveBeenCalledWith(
      expect.objectContaining({
        allowInput: true,
        geometryPolicy: "shared",
        outputChunkSize: defaultTmuxTerminalOutputChunkSize,
      }),
    );
  });

  const invalidOutputChunkSizeCases = [
    { name: "zero", outputChunkSize: 0 },
    { name: "negative", outputChunkSize: -1 },
    { name: "fractional", outputChunkSize: 1.5 },
    { name: "infinite", outputChunkSize: Number.POSITIVE_INFINITY },
    { name: "unsafe", outputChunkSize: Number.MAX_SAFE_INTEGER + 1 },
  ];

  testCases.each(invalidOutputChunkSizeCases)(
    "rejects a $name output chunk size",
    ({ outputChunkSize }) => {
      expect(() =>
        tmuxStream({ ...terminalStreamOptions, outputChunkSize }),
      ).toThrow("Tmux terminal output chunk size must be a positive integer");
    },
  );
});
