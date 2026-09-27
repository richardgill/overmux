import { describe, expect, it } from "vitest";
import { navigateChange, orderedChanges } from "./source-control-navigation";
import type { GitChanges, GitFileChange } from "../shared";

const change = (path: string): GitFileChange => ({
  path,
  binary: false,
  status: "modified",
  lineStats: { added: 1, deleted: 1 },
  diffParams: {
    repoRoot: "/repo",
    file: path,
    comparison: { base: { kind: "index" }, target: { kind: "workingTree" } },
  },
});
const status: GitChanges = {
  branch: { ahead: 0, behind: 0, name: "main", unborn: false, upstream: null },
  comparisons: {
    review: [change("b.ts"), change("a.ts")],
    committed: [change("z.ts")],
  },
  repoRoot: "/repo",
};
describe("source-control navigation", () => {
  it("preserves caller group order and sorts paths within groups", () => {
    expect(
      orderedChanges(status).map(({ group, path }) => `${group}:${path}`),
    ).toEqual(["review:a.ts", "review:b.ts", "committed:z.ts"]);
  });
  it("cycles selected files across named groups", () => {
    expect(
      navigateChange({
        direction: 1,
        selectedChange: { group: "review", path: "b.ts" },
        status,
      }),
    ).toMatchObject({ group: "committed", path: "z.ts" });
    expect(
      navigateChange({
        direction: -1,
        selectedChange: { group: "review", path: "a.ts" },
        status,
      }),
    ).toMatchObject({ group: "committed", path: "z.ts" });
  });
});
