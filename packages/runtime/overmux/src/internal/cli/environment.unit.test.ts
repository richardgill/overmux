import { describe, expect, test as testCases } from "vitest";

import { classifyCliEnvironment } from "./environment";

const interactiveHumanSignals = {
  agent: undefined,
  isAgent: false,
  isCI: false,
  stdinIsTTY: true,
  stdoutIsTTY: true,
} as const;

const classificationTestCases = [
  {
    expectedHuman: true,
    expectedInteractive: true,
    name: "classifies both TTYs as an interactive human terminal",
    signals: interactiveHumanSignals,
  },
  {
    expectedHuman: false,
    expectedInteractive: false,
    name: "requires stdin to be a TTY",
    signals: { ...interactiveHumanSignals, stdinIsTTY: undefined },
  },
  {
    expectedHuman: false,
    expectedInteractive: false,
    name: "requires stdout to be a TTY",
    signals: { ...interactiveHumanSignals, stdoutIsTTY: undefined },
  },
  {
    expectedHuman: false,
    expectedInteractive: true,
    name: "does not classify CI as a human user",
    signals: { ...interactiveHumanSignals, isCI: true },
  },
  {
    expectedHuman: false,
    expectedInteractive: true,
    name: "does not classify an agent as a human user",
    signals: { ...interactiveHumanSignals, isAgent: true },
  },
  {
    expectedHuman: false,
    expectedInteractive: true,
    name: "preserves the detected agent name",
    signals: { ...interactiveHumanSignals, agent: "claude", isAgent: true },
  },
] as const;

describe("CLI environment classification", () => {
  testCases.each(classificationTestCases)(
    "$name",
    ({ expectedHuman, expectedInteractive, signals }) => {
      expect(classifyCliEnvironment(signals)).toEqual({
        agent: signals.agent,
        isAgent: signals.isAgent,
        isCI: signals.isCI,
        isHumanUser: expectedHuman,
        isInteractiveTerminal: expectedInteractive,
      });
    },
  );
});
