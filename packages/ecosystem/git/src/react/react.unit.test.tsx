import { readFileSync } from "node:fs";

import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test as testCases, vi } from "vitest";

vi.mock("./pierre-diff", () => ({
  PierreFileDiff: ({ newContent }: { newContent: string | null }) => (
    <pre data-om-pierre-diff>{newContent}</pre>
  ),
  PierrePatchDiff: ({ patch }: { patch: string }) => <pre>{patch}</pre>,
}));

import * as gitReact from "./index";
import { GitSourceControlSidebar, SourceControlView } from "./index";
import { gitChangeKey, type GitSourceControl } from "../shared";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

const changes: GitSourceControl = {
  branch: { ahead: 0, behind: 0, name: "main" },
  changes: [
    {
      area: "unstaged",
      binary: false,
      deletions: 1,
      insertions: 1,
      path: "src/file.ts",
      status: "modified",
    },
  ],
  comparison: "uncommitted",
  diffs: {
    ["unstaged:src/file.ts"]: {
      binary: false,
      newContent: "new\n",
      oldContent: "old\n",
      patch: "@@ -1 +1 @@\n-old\n+new",
      path: "src/file.ts",
    },
  },
  revision: "revision",
  root: "/repo",
};

describe("Git source control React API", () => {
  testCases("exports the clean snapshot API", () => {
    expect(Object.keys(gitReact).sort()).toEqual([
      "GitSourceControlSidebar",
      "PierreFileDiff",
      "PierrePatchDiff",
      "SourceControlView",
      "orderedChanges",
      "registerGitDiffTheme",
      "sourceControlCommands",
    ]);
  });

  testCases.each([
    {
      expected: "Loading changes",
      props: { loading: true },
      title: "loading",
    },
    { expected: "failed", props: { error: "failed" }, title: "error" },
    { expected: "No changes", props: {}, title: "empty" },
  ] satisfies {
    expected: string;
    props: ComponentProps<typeof GitSourceControlSidebar>;
    title: string;
  }[])("renders the sidebar $title state", ({ expected, props }) => {
    expect(
      renderToStaticMarkup(<GitSourceControlSidebar {...props} />),
    ).toContain(expected);
  });

  testCases.each([
    { expected: "Loading diff", props: { loading: true }, title: "loading" },
    { expected: "failed", props: { error: "failed" }, title: "error" },
    { expected: "No diff", props: {}, title: "empty" },
  ] satisfies {
    expected: string;
    props: ComponentProps<typeof SourceControlView>;
    title: string;
  }[])("renders the diff $title state", ({ expected, props }) => {
    expect(renderToStaticMarkup(<SourceControlView {...props} />)).toContain(
      expected,
    );
  });

  testCases("renders snapshot files and area-path keys", () => {
    const markup = renderToStaticMarkup(
      <SourceControlView
        renderDiffFileHeader={() => "custom file header"}
        sourceControl={changes}
      />,
    );
    expect(markup).toContain("src/file.ts");
    expect(markup).toContain(gitChangeKey(changes.changes[0]));
    expect(markup).toContain("custom file header");
    expect(markup).toContain("om-git-diff-header-content");
    expect(markup).toContain('om-git-diff-stat-additions">+1');
    expect(markup).toContain('om-git-diff-stat-deletions">-1');
    expect(markup).toContain("Insertions: 1; deletions: 1");
    expect(markup).toContain(">new\n</pre>");
  });

  testCases("renders change groups and area-less base trees", () => {
    const grouped: GitSourceControl = {
      ...changes,
      changes: [
        { ...changes.changes[0]!, area: "conflict", path: "conflict.ts" },
        { ...changes.changes[0]!, area: "unstaged", path: "unstaged.ts" },
        { ...changes.changes[0]!, area: "staged", path: "staged.ts" },
      ],
      diffs: {},
    };
    const groupedMarkup = renderToStaticMarkup(
      <GitSourceControlSidebar sourceControl={grouped} />,
    );
    ["Conflicts", "Unstaged", "Staged"].forEach((title) =>
      expect(groupedMarkup).toContain(title),
    );
    expect(groupedMarkup.match(/<file-tree-container/g)).toHaveLength(3);

    const base: GitSourceControl = {
      base: "base",
      changes: [
        {
          binary: false,
          deletions: 1,
          insertions: 1,
          path: "base.ts",
          status: "modified",
        },
      ],
      comparison: "base",
      diffs: {},
      revision: "revision",
      root: "/repo",
    };
    const baseMarkup = renderToStaticMarkup(
      <GitSourceControlSidebar sourceControl={base} />,
    );
    expect(baseMarkup).toContain("Changes");
    expect(baseMarkup.match(/<file-tree-container/g)).toHaveLength(1);
    expect(baseMarkup).not.toContain("data-om-area");
  });

  testCases("preserves root presentation", () => {
    const markup = renderToStaticMarkup(
      <SourceControlView
        className="custom-root"
        style={{ "--om-color-accent": "purple" }}
      />,
    );
    expect(markup).toContain("custom-root");
    expect(markup).toContain("--om-color-accent:purple");
  });

  testCases("preserves textual, empty, and binary file states", () => {
    expect(
      renderToStaticMarkup(<SourceControlView sourceControl={changes} />),
    ).toContain("data-om-pierre-diff");

    const empty = structuredClone(changes);
    empty.diffs["unstaged:src/file.ts"]!.newContent = "same\n";
    empty.diffs["unstaged:src/file.ts"]!.oldContent = "same\n";
    expect(
      renderToStaticMarkup(<SourceControlView sourceControl={empty} />),
    ).toContain("No textual changes.");

    const binary = structuredClone(changes);
    binary.changes[0]!.binary = true;
    binary.diffs["unstaged:src/file.ts"] = {
      binary: true,
      newContent: null,
      oldContent: null,
      patch: "",
      path: "src/file.ts",
    };
    expect(
      renderToStaticMarkup(<SourceControlView sourceControl={binary} />),
    ).toContain("Binary file.");
  });

  testCases("contains styles within public source-control roots", () => {
    expect(styles).toMatch(
      /@scope \(\s*\[data-om-git-changes-sidebar\],[\s\S]*\[data-om-git-diff\],[\s\S]*\[data-om-source-control-view\]/u,
    );
  });

  testCases(
    "defines sticky headers and non-interactive navigation flashes",
    () => {
      expect(styles).toMatch(
        /\.om-git-diff-header[\s\S]*position: sticky;[\s\S]*z-index: 2;[\s\S]*inset-block-start: 0;/,
      );
      expect(styles).toMatch(
        /\.om-git-diff-file\[data-om-file-flash\][\s\S]*pointer-events: none;[\s\S]*animation: om-git-file-flash 1400ms ease-out/,
      );
      const flashRule = styles.match(
        /\.om-git-diff-file\[data-om-file-flash\]\)::after \{([^}]*)\}/u,
      )?.[1];
      expect(flashRule).toContain("box-shadow");
      expect(flashRule).not.toContain("background");
      expect(styles).toContain("var(--om-color-surface, Canvas)");
      expect(styles).toMatch(
        /\.om-git-diff-header-content[\s\S]*min-inline-size: 0;[\s\S]*text-overflow: ellipsis;/,
      );
      expect(styles).toMatch(/\.om-git-diff-header-stats[\s\S]*flex: none;/);
    },
  );
});
