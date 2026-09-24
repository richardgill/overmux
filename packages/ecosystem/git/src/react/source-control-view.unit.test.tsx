import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test as testCases,
  vi,
} from "vitest";

const registeredCommands = vi.hoisted(
  () => new Map<string, { enabled?: boolean; run: () => unknown }>(),
);

vi.mock("overmux/client", async () => {
  const { useEffect } = await import("react");
  return {
    defineCommandRegistry:
      () => (commands: Record<string, { title: string }>) =>
        Object.fromEntries(
          Object.entries(commands).map(([id, command]) => [
            id,
            { ...command, id },
          ]),
        ),
    useCommand: (
      command: { id: string },
      registration: { enabled?: boolean; run: () => unknown },
    ) =>
      useEffect(() => {
        registeredCommands.set(command.id, registration);
        return () => void registeredCommands.delete(command.id);
      }, [command, registration]),
  };
});

vi.mock("@overmux/ui", () => ({
  SplitView: ({
    first,
    second,
  }: {
    first: React.ReactNode;
    second: React.ReactNode;
  }) => (
    <div>
      {first}
      {second}
    </div>
  ),
}));

vi.mock("./pierre-tree", () => ({
  PierreGitChangeTree: ({
    changes,
    onSelectChange,
    selectedChange,
  }: {
    changes: GitChange[];
    onSelectChange?: (change: GitChange) => void;
    selectedChange?: { area?: GitChange["area"]; path: string };
  }) => (
    <div>
      {changes.map((change) => (
        <button
          aria-current={
            change.area === selectedChange?.area &&
            change.path === selectedChange?.path
              ? "true"
              : undefined
          }
          data-tree-file={gitChangeKey(change)}
          key={gitChangeKey(change)}
          onClick={() => onSelectChange?.(change)}
          type="button"
        >
          {change.path}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("./pierre-diff", () => ({
  PierreFileDiff: ({ cacheKey, path }: { cacheKey?: string; path: string }) => {
    const [expanded, setExpanded] = useState(false);
    useEffect(() => setExpanded(false), [cacheKey]);
    return (
      <div data-expanded={expanded ? "true" : "false"} data-pierre-file={path}>
        <button data-expand-up={path} type="button">
          Expand upward
        </button>
        <button
          data-expand-whole={path}
          onClick={() => setExpanded(true)}
          type="button"
        >
          Expand whole file
        </button>
      </div>
    );
  },
  PierrePatchDiff: () => null,
}));

import { SourceControlView, sourceControlCommands } from "./index";
import { gitChangeKey, type GitChange, type GitSourceControl } from "../shared";

const patch = (path: string) =>
  `diff --git a/${path} b/${path}\n@@ -1 +1 @@\n-old\n+new`;
const changes: Extract<
  GitSourceControl,
  { comparison: "uncommitted" }
>["changes"] = [
  {
    area: "unstaged",
    binary: false,
    deletions: 1,
    insertions: 1,
    path: "a.ts",
    status: "modified",
  },
  {
    area: "unstaged",
    binary: false,
    deletions: 1,
    insertions: 1,
    path: "b.ts",
    status: "modified",
  },
  {
    area: "staged",
    binary: false,
    deletions: 1,
    insertions: 1,
    path: "z.ts",
    status: "modified",
  },
];
const snapshot: GitSourceControl = {
  branch: { ahead: 0, behind: 0, name: "main" },
  changes,
  comparison: "uncommitted",
  diffs: Object.fromEntries(
    changes.map((change) => [
      gitChangeKey(change),
      {
        binary: false,
        newContent: "new\n",
        oldContent: "old\n",
        patch: patch(change.path),
        path: change.path,
      },
    ]),
  ),
  revision: "revision",
  root: "/repo",
};

const ControlledView = ({
  onSelect,
}: {
  onSelect: (change: GitChange) => void;
}) => {
  const [selectedChange, setSelectedChange] = useState<GitChange>(changes[0]);
  return (
    <SourceControlView
      commandHandles={sourceControlCommands}
      onSelectChange={(change) => {
        onSelect(change);
        setSelectedChange(change);
      }}
      selectedChange={selectedChange}
      sourceControl={snapshot}
    />
  );
};

let container: HTMLDivElement;
let root: Root;
let scrollIntoView: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  registeredCommands.clear();
  scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("all-file SourceControlView", () => {
  testCases(
    "renders every file and synchronously jumps from tree and commands",
    async () => {
      const onSelect = vi.fn();
      await act(async () =>
        root.render(<ControlledView onSelect={onSelect} />),
      );

      expect(container.querySelectorAll("[data-om-git-file]")).toHaveLength(3);
      expect(registeredCommands).toHaveLength(4);
      const view = container.querySelector<HTMLElement>(
        "[data-om-source-control-view]",
      );
      await act(async () =>
        view?.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }),
        ),
      );
      expect(onSelect).toHaveBeenLastCalledWith(changes[1]);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(
        container
          .querySelector('[data-om-git-file="unstaged:b.ts"]')
          ?.getAttribute("data-om-file-flash"),
      ).toBe("true");

      await act(async () =>
        view?.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            key: "Tab",
            shiftKey: true,
          }),
        ),
      );
      expect(onSelect).toHaveBeenLastCalledWith(changes[0]);
      expect(scrollIntoView).toHaveBeenCalledTimes(2);

      await act(async () =>
        view?.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            key: "Tab",
            shiftKey: true,
          }),
        ),
      );
      expect(onSelect).toHaveBeenLastCalledWith(changes[2]);
      expect(scrollIntoView).toHaveBeenCalledTimes(3);

      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('[data-tree-file="unstaged:b.ts"]')
          ?.click();
      });
      expect(onSelect).toHaveBeenLastCalledWith(changes[1]);
      expect(scrollIntoView).toHaveBeenCalledTimes(4);

      await act(async () =>
        registeredCommands.get("sourceControl.nextFile")?.run(),
      );
      expect(onSelect).toHaveBeenLastCalledWith(changes[2]);
      expect(scrollIntoView).toHaveBeenCalledTimes(5);
    },
  );

  testCases(
    "expands whole files independently and resets expansion on revision change",
    async () => {
      await act(async () =>
        root.render(<SourceControlView sourceControl={snapshot} />),
      );
      const first = () =>
        container.querySelector<HTMLElement>('[data-pierre-file="a.ts"]');
      const second = () =>
        container.querySelector<HTMLElement>('[data-pierre-file="b.ts"]');

      expect(first()?.dataset.expanded).toBe("false");
      expect(second()?.dataset.expanded).toBe("false");
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>('[data-expand-whole="a.ts"]')
          ?.click(),
      );
      expect(first()?.dataset.expanded).toBe("true");
      expect(second()?.dataset.expanded).toBe("false");

      await act(async () =>
        root.render(
          <SourceControlView
            sourceControl={{ ...snapshot, revision: "next-revision" }}
          />,
        ),
      );
      expect(first()?.dataset.expanded).toBe("false");
      expect(second()?.dataset.expanded).toBe("false");
    },
  );

  testCases(
    "selects the top reading file from scroll without scrolling again",
    async () => {
      const onSelect = vi.fn();
      await act(async () =>
        root.render(<ControlledView onSelect={onSelect} />),
      );
      const pane = container.querySelector<HTMLElement>(
        ".om-source-control-diff",
      );
      const sections =
        container.querySelectorAll<HTMLElement>("[data-om-git-file]");
      if (!pane || sections.length !== 3) {
        throw new Error("Missing diff sections");
      }
      await act(async () =>
        sections[0]?.querySelector<HTMLElement>("[data-expand-up]")?.click(),
      );
      const beforeScroll = scrollIntoView.mock.calls.length;
      pane.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
      sections[0].getBoundingClientRect = () => ({ top: -100 }) as DOMRect;
      sections[1].getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
      sections[2].getBoundingClientRect = () => ({ top: 500 }) as DOMRect;

      await act(async () => pane.dispatchEvent(new Event("scroll")));
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenLastCalledWith(changes[1]);
      expect(scrollIntoView).toHaveBeenCalledTimes(beforeScroll);
      expect(
        container
          .querySelector('[data-tree-file="unstaged:b.ts"]')
          ?.getAttribute("aria-current"),
      ).toBe("true");
      expect(container.querySelector("[data-om-file-flash]")).toBeNull();
      expect(container.querySelector('[data-om-selected="true"]')).toBeNull();

      await act(async () =>
        sections[1]?.querySelector<HTMLElement>("[data-expand-up]")?.click(),
      );
      expect(
        container
          .querySelector('[data-tree-file="unstaged:b.ts"]')
          ?.getAttribute("aria-current"),
      ).toBe("true");
    },
  );

  testCases("scrolls the diff by half its viewport", async () => {
    await act(async () =>
      root.render(<ControlledView onSelect={() => undefined} />),
    );
    const pane = container.querySelector<HTMLElement>(
      ".om-source-control-diff",
    );
    if (!pane) {
      throw new Error("Missing diff pane");
    }
    Object.defineProperty(pane, "clientHeight", {
      configurable: true,
      value: 600,
    });
    const scrollBy = vi.fn();
    pane.scrollBy = scrollBy;

    await act(async () =>
      registeredCommands.get("sourceControl.scrollDown")?.run(),
    );
    await act(async () =>
      registeredCommands.get("sourceControl.scrollUp")?.run(),
    );
    expect(scrollBy.mock.calls).toEqual([[{ top: 300 }], [{ top: -300 }]]);
  });

  testCases(
    "moves focus between complete panes from portals and shadow roots",
    async () => {
      await act(async () =>
        root.render(<ControlledView onSelect={() => undefined} />),
      );
      const sidebar = container.querySelector<HTMLElement>(
        ".om-source-control-sidebar",
      );
      const diff = container.querySelector<HTMLElement>(
        ".om-source-control-diff",
      );
      if (!sidebar || !diff) {
        throw new Error("Missing source control panes");
      }
      const header = document.body.appendChild(
        document.createElement("header"),
      );
      const treeHost = sidebar.appendChild(document.createElement("div"));
      const tree = treeHost.attachShadow({ mode: "open" });
      const treeItem = tree.appendChild(document.createElement("button"));
      const diffHost = diff.appendChild(document.createElement("div"));
      const pierre = diffHost.attachShadow({ mode: "open" });
      const pierreLine = pierre.appendChild(document.createElement("span"));
      const press = (target: EventTarget, key: "ArrowLeft" | "ArrowRight") => {
        const event = new KeyboardEvent("keydown", {
          bubbles: true,
          composed: true,
          ctrlKey: true,
          key,
          shiftKey: true,
        });
        target.dispatchEvent(event);
        return event;
      };

      expect(diff.dataset.omPaneActive).toBe("true");
      await act(async () => press(header, "ArrowLeft"));
      expect(document.activeElement).toBe(sidebar);
      expect(sidebar.dataset.omPaneActive).toBe("true");

      await act(async () => press(treeItem, "ArrowRight"));
      expect(document.activeElement).toBe(diff);
      expect(diff.dataset.omPaneActive).toBe("true");

      await act(async () => press(pierreLine, "ArrowLeft"));
      expect(document.activeElement).toBe(sidebar);

      await act(async () => press(sidebar, "ArrowLeft"));
      expect(document.activeElement).toBe(sidebar);
      await act(async () => press(diff, "ArrowRight"));
      expect(document.activeElement).toBe(diff);

      const input = header.appendChild(document.createElement("input"));
      await act(async () => press(input, "ArrowLeft"));
      expect(document.activeElement).toBe(diff);
      header.remove();
    },
  );

  testCases("repeats half-page scrolling while its key is held", async () => {
    await act(async () =>
      root.render(<ControlledView onSelect={() => undefined} />),
    );
    const view = container.querySelector<HTMLElement>(
      "[data-om-source-control-view]",
    );
    const pane = container.querySelector<HTMLElement>(
      ".om-source-control-diff",
    );
    if (!view || !pane) {
      throw new Error("Missing diff pane");
    }
    Object.defineProperty(pane, "clientHeight", {
      configurable: true,
      value: 600,
    });
    const scrollBy = vi.fn();
    pane.scrollBy = scrollBy;

    const repeat = () =>
      view.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          ctrlKey: true,
          key: "d",
          repeat: true,
        }),
      );
    await act(async () => {
      repeat();
      repeat();
    });
    expect(scrollBy.mock.calls).toEqual([[{ top: 300 }], [{ top: 300 }]]);
  });

  testCases("retriggers file flashes when a single file wraps", async () => {
    const single: GitSourceControl = {
      ...snapshot,
      changes: [changes[0]],
      diffs: {
        [gitChangeKey(changes[0])]: snapshot.diffs[gitChangeKey(changes[0])]!,
      },
    };
    await act(async () =>
      root.render(
        <SourceControlView
          commandHandles={sourceControlCommands}
          sourceControl={single}
        />,
      ),
    );
    const view = container.querySelector<HTMLElement>(
      "[data-om-source-control-view]",
    );
    const file = container.querySelector<HTMLElement>("[data-om-git-file]");
    if (!file) {
      throw new Error("Missing file section");
    }
    const setAttribute = vi.spyOn(file, "setAttribute");

    await act(async () =>
      view?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }),
      ),
    );
    await act(async () =>
      view?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }),
      ),
    );
    expect(
      setAttribute.mock.calls.filter(
        ([name, value]) => name === "data-om-file-flash" && value === "true",
      ),
    ).toHaveLength(2);
  });
});
