import type { PtyFactory } from "@overmux/pty/server";
import { describe, expect, it, vi } from "vitest";

import type { ZellijBackend } from "../backend";
import {
  zellijTerminalClientMessageSchema,
  zellijTerminalOpenInputSchema,
  zellijTerminalServerMessageSchema,
} from "../../shared/terminal-contracts";

const session = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("./session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session")>()),
  createZellijTerminalSession: session.create,
}));

import { zellijTerminalStream } from "./stream";

const context = () => ({
  instance: {
    getInstanceId: () => "test",
    getDeepLinkPrefix: () => "overmux://test",
  },
  emit: vi.fn(),
  fail: vi.fn(),
  invalidate: vi.fn(),
  signal: new AbortController().signal,
});

describe("Zellij terminal stream", () => {
  it("uses sessionName as fixed opening input and delegates shared terminal contracts", () => {
    const backend = {} as ZellijBackend;
    const ptyFactory = vi.fn() as unknown as PtyFactory;
    session.create.mockReturnValue({});
    const stream = zellijTerminalStream({
      allowInput: true,
      backend,
      outputChunkSize: 1_024,
      ptyFactory,
    });
    const streamContext = context();

    stream.open({ sessionName: "demo" }, streamContext);

    expect(stream.contract.input).toBe(zellijTerminalOpenInputSchema);
    expect(stream.contract.clientMessage).toBe(
      zellijTerminalClientMessageSchema,
    );
    expect(stream.contract.serverMessage).toBe(
      zellijTerminalServerMessageSchema,
    );
    expect(session.create).toHaveBeenCalledWith({
      allowInput: true,
      backend,
      emit: streamContext.emit,
      fail: streamContext.fail,
      outputChunkSize: 1_024,
      ptyFactory,
      sessionName: "demo",
      signal: streamContext.signal,
    });
  });

  it("rejects invalid output chunk sizes", () => {
    expect(() =>
      zellijTerminalStream({
        allowInput: true,
        backend: {} as ZellijBackend,
        outputChunkSize: 0,
      }),
    ).toThrow("positive integer");
  });
});
