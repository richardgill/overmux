import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test as testCases,
  vi,
} from "vitest";

import {
  GitSourceControlSidebar,
  type GitSourceControlSidebarProps,
} from "./index";

const styles = readFileSync(
  resolve(process.cwd(), "src/react/styles.css"),
  "utf8",
);

const status = {
  branch: { ahead: 0, behind: 0, name: "main" },
  changes: [
    {
      area: "unstaged" as const,
      binary: false,
      deletions: 0,
      insertions: 0,
      path: "src/components/button.tsx",
      status: "modified" as const,
    },
    {
      area: "staged" as const,
      binary: false,
      deletions: 0,
      insertions: 0,
      path: "README.md",
      status: "added" as const,
    },
  ],
  comparison: "uncommitted" as const,
  diffs: {},
  revision: "revision",
  root: "/repo",
};

let container: HTMLDivElement;
let root: Root;

const renderSidebar = async (props: GitSourceControlSidebarProps) => {
  await act(async () => root.render(<GitSourceControlSidebar {...props} />));
};

const tree = (area: "staged" | "unstaged") => {
  const host = container.querySelector<HTMLElement>(`[data-om-area="${area}"]`);
  if (!host?.shadowRoot) {
    throw new Error(`Missing ${area} file tree`);
  }
  return { host, shadowRoot: host.shadowRoot };
};

const row = (shadowRoot: ShadowRoot, path: string) => {
  const item = shadowRoot.querySelector<HTMLButtonElement>(
    `[data-item-path="${path}"]`,
  );
  if (!item) {
    throw new Error(`Missing file tree row: ${path}`);
  }
  return item;
};

const openContextMenu = async (area: "staged" | "unstaged", path: string) => {
  const { host, shadowRoot } = tree(area);
  await act(async () => {
    row(shadowRoot, path).dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        button: 2,
        clientX: 20,
        clientY: 20,
      }),
    );
  });
  return host;
};

const action = (host: HTMLElement, label: string) => {
  const button = [
    ...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ].find((item) => item.textContent === label);
  if (!button) {
    throw new Error(`Missing ${label} action`);
  }
  return button;
};

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Pierre Git change trees", () => {
  testCases(
    "renders hierarchy, git status, selection, and text renderers",
    async () => {
      await renderSidebar({
        classNames: { change: "custom-change" },
        flattenEmptyDirectories: false,
        getChangeLabel: (change) => `custom:${change.path}`,
        selectedChange: {
          area: "unstaged",
          path: "src/components/button.tsx",
        },
        sourceControl: status,
      });

      const { host, shadowRoot } = tree("unstaged");
      const fileRow = row(shadowRoot, "src/components/button.tsx");

      expect(host.classList).toContain("custom-change");
      expect(row(shadowRoot, "src/").getAttribute("aria-expanded")).toBe(
        "true",
      );
      expect(
        row(shadowRoot, "src/components/").getAttribute("aria-expanded"),
      ).toBe("true");
      expect(fileRow.dataset.itemGitStatus).toBe("modified");
      expect(fileRow.dataset.itemSelected).toBe("true");
      expect(host.style.height).toBe("84px");
      expect(host.style.minHeight).toBe("");
      expect(fileRow.getAttribute("aria-label")).toBe(
        "src/components/button.tsx",
      );
      const decoration = fileRow.querySelector(
        '[data-item-section="decoration"] > span',
      );
      expect(decoration?.textContent).toBe(
        "custom:src/components/button.tsx+0-0",
      );
      expect(decoration?.getAttribute("title")).toBe(
        "src/components/button.tsx",
      );
      expect(decoration?.children).toHaveLength(3);
      expect((decoration?.children[1] as HTMLElement).style.color).toBe(
        "#3fb950",
      );
      expect((decoration?.children[2] as HTMLElement).style.color).toBe(
        "#f85149",
      );
    },
  );

  testCases(
    "flows complete staged and unstaged trees through one sidebar scroll surface",
    async () => {
      const manyChanges = (["unstaged", "staged"] as const).flatMap((area) =>
        Array.from({ length: 15 }, (_, index) => ({
          area,
          binary: false,
          deletions: index,
          insertions: index,
          path: `${area}-${index}.ts`,
          status: "modified" as const,
        })),
      );
      await renderSidebar({
        sourceControl: { ...status, changes: manyChanges },
      });

      const sidebar = container.querySelector<HTMLElement>(
        "[data-om-git-changes-sidebar]",
      );
      const unstaged = tree("unstaged");
      const staged = tree("staged");
      expect(sidebar?.querySelectorAll(".om-git-changes-group")).toHaveLength(
        2,
      );
      expect(unstaged.host.style.height).toBe(`${15 * 28}px`);
      expect(staged.host.style.height).toBe(`${15 * 28}px`);
      expect(
        unstaged.shadowRoot.querySelectorAll("[data-item-path]"),
      ).toHaveLength(15);
      expect(
        staged.shadowRoot.querySelectorAll("[data-item-path]"),
      ).toHaveLength(15);
      for (const { shadowRoot } of [unstaged, staged]) {
        expect(
          [...shadowRoot.querySelectorAll("style")].some((style) =>
            style.textContent?.includes("overflow-y: hidden"),
          ),
        ).toBe(true);
      }
      expect(styles).toMatch(
        /\[data-om-git-changes-sidebar\][\s\S]*overflow-y: auto;/,
      );
      expect(styles).toMatch(/\.om-git-changes-group[\s\S]*flex: none;/);
      expect(styles).toMatch(/\.om-git-change-tree[\s\S]*flex: none;/);
    },
  );

  testCases(
    "renders file stats without a context-menu action lane",
    async () => {
      await renderSidebar({ sourceControl: status });

      const { shadowRoot } = tree("unstaged");
      expect(
        row(shadowRoot, "src/components/button.tsx").querySelector(
          '[data-item-section="decoration"]',
        )?.textContent,
      ).toBe("button.tsx+0-0");
      expect(
        shadowRoot.querySelector(
          "[data-file-tree-has-context-menu-action-lane]",
        ),
      ).toBeNull();
      expect(
        [...shadowRoot.querySelectorAll("style")].some((style) =>
          style.textContent?.includes(
            '[data-item-contains-git-change="true"]:not([data-item-git-status]) > [data-item-section="git"]',
          ),
        ),
      ).toBe(true);
    },
  );

  testCases("passes compact-directory policy through to Pierre", async () => {
    await renderSidebar({
      flattenEmptyDirectories: true,
      sourceControl: status,
    });

    const { shadowRoot } = tree("unstaged");
    expect(shadowRoot.querySelector('[data-item-path="src/"]')).toBeNull();
    expect(
      row(shadowRoot, "src/components/").querySelector(
        "[data-item-flattened-subitems]",
      ),
    ).not.toBeNull();
  });

  testCases(
    "renders base comparison files without mutation actions",
    async () => {
      await renderSidebar({
        sourceControl: {
          base: "base",
          changes: [
            {
              binary: false,
              deletions: 1,
              insertions: 1,
              path: "src/base.ts",
              status: "modified",
            },
          ],
          comparison: "base",
          diffs: {},
          revision: "revision",
          root: "/repo",
        },
        onDiscard: vi.fn(),
        onStage: vi.fn(),
        onUnstage: vi.fn(),
      });

      const host = container.querySelector<HTMLElement>(".om-git-change-tree");
      if (!host?.shadowRoot) {
        throw new Error("Missing base file tree");
      }
      const baseRow = row(host.shadowRoot, "src/base.ts");
      expect(baseRow).toBeDefined();
      await act(async () => {
        baseRow.dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, button: 2 }),
        );
      });
      expect(host.querySelector('[role="menuitem"]')).toBeNull();
    },
  );

  testCases(
    "selects files and runs actions from the row context menu",
    async () => {
      const onDiscard = vi.fn();
      const onSelectChange = vi.fn();
      const onStage = vi.fn();
      const onUnstage = vi.fn();
      await renderSidebar({
        classNames: { actions: "custom-actions" },
        onDiscard,
        onSelectChange,
        onStage,
        onUnstage,
        sourceControl: status,
      });

      const { shadowRoot } = tree("unstaged");
      await act(async () =>
        row(shadowRoot, "src/components/button.tsx").click(),
      );
      expect(onSelectChange).toHaveBeenCalledWith(status.changes[0]);

      const unstagedHost = await openContextMenu(
        "unstaged",
        "src/components/button.tsx",
      );
      expect(unstagedHost.querySelector(".custom-actions")).not.toBeNull();
      await act(async () => action(unstagedHost, "Stage").click());
      expect(onStage).toHaveBeenCalledWith(status.changes[0]);

      await openContextMenu("unstaged", "src/components/button.tsx");
      await act(async () => action(unstagedHost, "Discard").click());
      expect(onDiscard).toHaveBeenCalledWith(status.changes[0]);

      const stagedHost = await openContextMenu("staged", "README.md");
      await act(async () => action(stagedHost, "Unstage").click());
      expect(onUnstage).toHaveBeenCalledWith(status.changes[1]);
    },
  );

  testCases("updates paths, statuses, and controlled selection", async () => {
    await renderSidebar({ sourceControl: status });
    const nextStatus = {
      ...status,
      changes: [
        {
          ...status.changes[0],
          path: "src/new.ts",
          status: "untracked" as const,
        },
      ],
    };

    await renderSidebar({
      getChangeLabel: (change) => `next:${change.path}`,
      selectedChange: { area: "unstaged", path: "src/new.ts" },
      sourceControl: nextStatus,
    });

    const { shadowRoot } = tree("unstaged");
    expect(shadowRoot.querySelector('[data-item-path="README.md"]')).toBeNull();
    const newRow = row(shadowRoot, "src/new.ts");
    expect(newRow.dataset.itemGitStatus).toBe("untracked");
    expect(newRow.dataset.itemSelected).toBe("true");
    expect(
      newRow.querySelector('[data-item-section="decoration"]')?.textContent,
    ).toBe("next:src/new.ts+0-0");

    await renderSidebar({
      getChangeLabel: (change) => `updated:${change.path}`,
      selectedChange: { area: "unstaged", path: "src/new.ts" },
      sourceControl: nextStatus,
    });

    expect(
      row(tree("unstaged").shadowRoot, "src/new.ts").querySelector(
        '[data-item-section="decoration"]',
      )?.textContent,
    ).toBe("updated:src/new.ts+0-0");
  });
});
