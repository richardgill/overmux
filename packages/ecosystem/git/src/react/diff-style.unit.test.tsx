import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("./pierre-diff", () => ({
  PierreFileDiff: ({
    diffStyle,
    options,
  }: {
    diffStyle: string;
    options: { theme?: string };
  }) => (
    <span
      data-pierre-diff-style={diffStyle}
      data-pierre-theme={options.theme}
    />
  ),
  PierrePatchDiff: () => null,
}));

import { SourceControlView } from "./index";
import type { GitSourceControl } from "../shared";

const sourceControl: GitSourceControl = {
  branch: { ahead: 0, behind: 0, name: "main" },
  changes: [
    {
      area: "unstaged",
      binary: false,
      deletions: 1,
      insertions: 1,
      path: "file.ts",
      status: "modified",
    },
  ],
  comparison: "uncommitted",
  diffs: {
    "unstaged:file.ts": {
      binary: false,
      newContent: "new\n",
      oldContent: "old\n",
      patch: "@@ -1 +1 @@\n-old\n+new",
      path: "file.ts",
    },
  },
  revision: "revision",
  root: "/repo",
};

describe("diff style", () => {
  test("passes presentation through every snapshot diff", () => {
    const markup = renderToStaticMarkup(
      <SourceControlView
        diffOptions={{ theme: "github-dark" }}
        diffStyle="split"
        sourceControl={sourceControl}
      />,
    );
    expect(markup).toContain('data-pierre-diff-style="split"');
    expect(markup).toContain('data-pierre-theme="github-dark"');
  });
});
