import { describe, expect, it, test as testCases } from "vitest";

import {
  createOvermuxSettingsPath,
  overmuxLogoutPath,
  overmuxSettingsPath,
  resolveOvermuxReturnTo,
} from "./hosted-routes";

const returnTargetCases = [
  {
    expected: "/workspace/one?tab=2#pane",
    name: "application path",
    value: "/workspace/one?tab=2#pane",
  },
  { expected: "/", name: "missing path", value: undefined },
  {
    expected: "/",
    name: "absolute URL",
    value: "https://attacker.test/workspace",
  },
  {
    expected: "/",
    name: "protocol-relative URL",
    value: "//attacker.test/workspace",
  },
  {
    expected: "/",
    name: "backslash authority URL",
    value: "/\\attacker.test/workspace",
  },
  { expected: "/", name: "settings route", value: "/_overmux/settings" },
  {
    expected: "/",
    name: "encoded internal route",
    value: "/%5fovermux/logout",
  },
  { expected: "/", name: "API route", value: "/api/health" },
  { expected: "/", name: "login route", value: "/login" },
] as const;

describe("hosted Overmux routes", () => {
  it("publishes stable route constants", () => {
    expect(overmuxSettingsPath).toBe("/_overmux/settings");
    expect(overmuxLogoutPath).toBe("/_overmux/logout");
  });

  testCases.each(returnTargetCases)(
    "resolves $name safely",
    ({ expected, value }) => {
      expect(resolveOvermuxReturnTo(value)).toBe(expected);
    },
  );

  it("adds only a safe non-default return target to the settings path", () => {
    expect(createOvermuxSettingsPath("/workspace?view=diff#file")).toBe(
      "/_overmux/settings?returnTo=%2Fworkspace%3Fview%3Ddiff%23file",
    );
    expect(createOvermuxSettingsPath("https://attacker.test/")).toBe(
      overmuxSettingsPath,
    );
  });
});
