import { describe, expect, test as testCases } from "vitest";

import { resolveServeLogin } from "./serve";

const policyCases = [
  {
    expected: true,
    flags: {},
    isHumanUser: true,
    name: "creates a grant by default for a human",
  },
  {
    expected: false,
    flags: {},
    isHumanUser: false,
    name: "does not create a grant by default for a non-human",
  },
  {
    expected: true,
    flags: { login: true },
    isHumanUser: false,
    name: "forces a grant for a non-human with --login",
  },
  {
    expected: false,
    flags: { noLogin: true },
    isHumanUser: true,
    name: "suppresses a grant for a human with --no-login",
  },
];

describe("serve login policy", () => {
  testCases.each(policyCases)("$name", ({ expected, flags, isHumanUser }) => {
    expect(resolveServeLogin(flags, { isHumanUser })).toBe(expected);
  });

  testCases("rejects conflicting overrides", () => {
    expect(() =>
      resolveServeLogin({ login: true, noLogin: true }, { isHumanUser: true }),
    ).toThrow("Only set one of: --login and --no-login");
  });
});
