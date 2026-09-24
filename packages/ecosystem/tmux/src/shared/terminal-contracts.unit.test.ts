import { describe, expect, test as testCases } from "vitest";

import {
  tmuxTerminalClientMessageSchema,
  tmuxTerminalInputLimit,
  tmuxTerminalOpenInputSchema,
  tmuxTerminalServerMessageSchema,
} from "./terminal-contracts";

describe("tmux terminal delivery contracts", () => {
  testCases("opens one stable backend-bound terminal", () => {
    expect(tmuxTerminalOpenInputSchema.parse(undefined)).toBeUndefined();
  });

  testCases.each([
    { data: "input", type: "input" },
    { data: "x".repeat(tmuxTerminalInputLimit), type: "input" },
    { data: Uint8Array.from([0, 128, 255]), type: "input" },
    { cols: 120, rows: 40, type: "resize" },
    { target: { sessionId: "$1" }, requestId: 0, type: "go-to" },
    {
      target: { sessionId: "$1", windowId: "@3" },
      requestId: 1,
      type: "go-to",
    },
    {
      target: { sessionId: "$1", windowId: "@3", paneId: "%7" },
      requestId: 2,
      type: "go-to",
    },
    { type: "redraw" },
    { sequence: 3, terminalId: "terminal-1", type: "rendered" },
  ])("accepts client message $type", (message) => {
    expect(tmuxTerminalClientMessageSchema.parse(message)).toStrictEqual(
      message,
    );
  });

  testCases.each([
    { target: { sessionId: "1" }, requestId: 0, type: "go-to" },
    { target: { sessionId: "$1", paneId: "%7" }, requestId: 0, type: "go-to" },
    { target: { sessionId: "$1" }, requestId: -1, type: "go-to" },
    {
      target: { sessionId: "$1", windowId: "%3" },
      requestId: 0,
      type: "go-to",
    },
    { sessionId: "$1", type: "unknown" },
  ])("rejects invalid client message $type", (message) => {
    expect(() => tmuxTerminalClientMessageSchema.parse(message)).toThrow();
  });

  testCases.each([
    "x".repeat(tmuxTerminalInputLimit + 1),
    new Uint8Array(tmuxTerminalInputLimit + 1),
  ])("rejects oversized terminal input", (data) => {
    expect(() =>
      tmuxTerminalClientMessageSchema.parse({ data, type: "input" }),
    ).toThrow();
  });

  testCases.each([
    {
      type: "location-changed",
      revision: 1,
      location: { sessionId: "$1", windowId: "@3", paneId: "%7" },
    },
    {
      type: "go-to-result",
      requestId: 0,
      result: {
        outcome: "success",
        revision: 1,
        location: { sessionId: "$1", windowId: "@3", paneId: "%7" },
      },
    },
    {
      type: "go-to-result",
      requestId: 0,
      result: { outcome: "error", message: "not found" },
    },
  ])("accepts $type outside xterm output flow control", (message) => {
    expect(tmuxTerminalServerMessageSchema.parse(message)).toStrictEqual(
      message,
    );
  });

  testCases("accepts binary terminal output", () => {
    const message = {
      bytes: new Uint8Array([1, 2, 3]),
      sequence: 0,
      terminalId: "terminal-1",
      type: "data",
    };
    expect(tmuxTerminalServerMessageSchema.parse(message)).toStrictEqual(
      message,
    );
  });
});
