import { describe, expect, test as testCases } from "vitest";

import {
  terminalDataMessageSchema,
  terminalInputLimit,
  terminalInputMessageSchema,
  terminalRenderedMessageSchema,
  terminalResizeMessageSchema,
} from "./contracts";

describe("terminal transport contracts", () => {
  testCases.each([
    { data: "input", type: "input" },
    { data: "x".repeat(terminalInputLimit), type: "input" },
    { data: Uint8Array.from([0, 128, 255]), type: "input" },
  ])("accepts terminal input", (message) => {
    expect(terminalInputMessageSchema.parse(message)).toStrictEqual(message);
  });

  testCases.each([
    "x".repeat(terminalInputLimit + 1),
    new Uint8Array(terminalInputLimit + 1),
  ])("rejects oversized terminal input", (data) => {
    expect(() =>
      terminalInputMessageSchema.parse({ data, type: "input" }),
    ).toThrow();
  });

  testCases("accepts a positive terminal size", () => {
    const message = { cols: 120, rows: 40, type: "resize" };
    expect(terminalResizeMessageSchema.parse(message)).toStrictEqual(message);
  });

  testCases("accepts an ordered rendered acknowledgement", () => {
    const message = {
      sequence: 3,
      terminalId: "terminal-1",
      type: "rendered",
    };
    expect(terminalRenderedMessageSchema.parse(message)).toStrictEqual(message);
  });

  testCases("accepts binary terminal output", () => {
    const message = {
      bytes: new Uint8Array([1, 2, 3]),
      sequence: 0,
      terminalId: "terminal-1",
      type: "data",
    };
    expect(terminalDataMessageSchema.parse(message)).toStrictEqual(message);
  });
});
