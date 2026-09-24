import { describe, expect, test as testCases, vi } from "vitest";

import { createXtermKeyEventHandler, type XtermKeyMapping } from "./keyboard";

type TestCase = {
  event: Partial<KeyboardEvent>;
  expected: boolean;
  input?: string;
  mappings?: readonly XtermKeyMapping[];
  name: string;
};

const defaultMappings: readonly XtermKeyMapping[] = [
  ["Alt+ArrowLeft", "\u001b[1;3D"],
  ["Control+ArrowRight", "\u001b[1;5C"],
];
const testCasesByName: readonly TestCase[] = [
  {
    event: { altKey: true, key: "ArrowLeft" },
    expected: false,
    input: "\u001b[1;3D",
    name: "maps Alt+Left",
  },
  {
    event: { ctrlKey: true, key: "ArrowRight" },
    expected: false,
    input: "\u001b[1;5C",
    name: "maps Control+Right",
  },
  {
    event: { key: "ArrowLeft" },
    expected: true,
    name: "leaves unmapped keys to xterm",
  },
  {
    event: { altKey: true, key: "ArrowLeft", shiftKey: true },
    expected: true,
    name: "requires an exact modifier match",
  },
  {
    event: { altKey: true, key: "ArrowLeft", type: "keyup" },
    expected: true,
    name: "leaves non-keydown events to xterm",
  },
  {
    event: { altKey: true, key: "ArrowLeft" },
    expected: false,
    input: "first",
    mappings: [
      ["Alt+ArrowLeft", "first"],
      ["Alt+ArrowLeft", "second"],
    ],
    name: "uses the first matching mapping",
  },
];

describe("createXtermKeyEventHandler", () => {
  testCases.each(testCasesByName)(
    "$name",
    ({ event, expected, input, mappings = defaultMappings }) => {
      const inputTerminal = { input: vi.fn() };
      const preventDefault = vi.fn();
      const handler = createXtermKeyEventHandler(inputTerminal, mappings);

      expect(
        handler({
          altKey: false,
          ctrlKey: false,
          key: "",
          metaKey: false,
          preventDefault,
          shiftKey: false,
          type: "keydown",
          ...event,
        } as KeyboardEvent),
      ).toBe(expected);
      expect(preventDefault).toHaveBeenCalledTimes(input ? 1 : 0);
      expect(inputTerminal.input).toHaveBeenCalledTimes(input ? 1 : 0);
      if (input) {
        expect(inputTerminal.input).toHaveBeenCalledWith(input);
      }
    },
  );
});
