import { describe, expect, it } from "vitest";

import { navigateChange, orderedChanges } from "./source-control-navigation";
import type { GitStatus } from "../shared";

const status: GitStatus = {
  branch: { ahead: 0, behind: 0, name: "main", unborn: false, upstream: null },
  changes: [
    { area: "staged", binary: false, path: "z.ts", status: "modified" },
    { area: "unstaged", binary: false, path: "b.ts", status: "modified" },
    { area: "unstaged", binary: false, path: "a.ts", status: "added" },
  ],
  repoRoot: "/repo",
};

describe("source-control navigation", () => {
  it("orders status areas and paths without a combined diff resource", () => {
    expect(
      orderedChanges(status).map(({ area, path }) => `${area}:${path}`),
    ).toEqual(["unstaged:a.ts", "unstaged:b.ts", "staged:z.ts"]);
  });

  it("cycles selected status files", () => {
    expect(
      navigateChange({
        direction: 1,
        selectedChange: { area: "unstaged", path: "b.ts" },
        status,
      }),
    ).toMatchObject({ area: "staged", path: "z.ts" });
    expect(
      navigateChange({
        direction: -1,
        selectedChange: { area: "unstaged", path: "a.ts" },
        status,
      }),
    ).toMatchObject({ area: "staged", path: "z.ts" });
  });
});
