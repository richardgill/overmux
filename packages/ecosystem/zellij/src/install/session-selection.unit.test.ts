import { describe, expect, test as testCases } from "vitest";

import {
  parseActiveSessionList,
  selectInstallSession,
} from "./session-selection";

describe("Zellij install session selection", () => {
  testCases.each([
    {
      expected: "inside",
      name: "current session wins inside Zellij",
      options: {
        currentSession: "inside",
        requestedSession: "other",
        sessions: ["inside", "other"],
      },
    },
    {
      expected: "beta",
      name: "explicit session resolves outside Zellij",
      options: { requestedSession: "beta", sessions: ["alpha", "beta"] },
    },
    {
      expected: "only",
      name: "the sole session is automatic",
      options: { sessions: ["only"] },
    },
  ])("selects $name", ({ expected, options }) => {
    expect(selectInstallSession(options)).toBe(expected);
  });

  testCases.each([
    {
      expected: "No active Zellij session",
      name: "no sessions",
      options: { sessions: [] },
    },
    {
      expected: "Multiple Zellij sessions are active: alpha, beta",
      name: "ambiguous sessions",
      options: { sessions: ["alpha", "beta"] },
    },
    {
      expected: 'session "missing" is not active',
      name: "unknown explicit session",
      options: { requestedSession: "missing", sessions: ["alpha"] },
    },
  ])("rejects $name", ({ expected, options }) => {
    expect(() => selectInstallSession(options)).toThrow(expected);
  });

  testCases.each([
    { name: "empty listing", expected: [], stdout: "\n" },
    {
      name: "active sessions sorted by name",
      expected: ["alpha", "beta"],
      stdout: "beta [Created 1m 2s ago] \nalpha [Created 0s ago] \n",
    },
    {
      name: "names containing spaces and status-like text",
      expected: [
        "my [Created 1s ago] session",
        "work (EXITED - attach to resurrect)",
      ],
      stdout:
        "work (EXITED - attach to resurrect) [Created 1s ago] \nmy [Created 1s ago] session [Created 2s ago] \n",
    },
    {
      name: "only resurrectable sessions",
      expected: [],
      stdout: "old [Created 1h 2m ago] (EXITED - attach to resurrect)\n",
    },
  ])("parses $name", ({ expected, stdout }) => {
    expect(parseActiveSessionList(stdout)).toEqual(expected);
  });

  testCases("rejects output without session status metadata", () => {
    expect(() => parseActiveSessionList("alpha\n")).toThrow(
      "Unrecognized Zellij session listing",
    );
  });
});
