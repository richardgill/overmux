import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("overmux/client", () => ({
  defineCommandRegistry: () => (commands: Record<string, { title: string }>) =>
    Object.fromEntries(
      Object.entries(commands).map(([id, command]) => [id, { ...command, id }]),
    ),
  useCommand: () => undefined,
}));

import { SourceControlView } from "./index";
import type { GitChange, GitStatus } from "../shared";

const changes: GitChange[] = [
  { area: "unstaged", binary: false, path: "a.ts", status: "modified" },
  { area: "staged", binary: false, path: "a.ts", status: "modified" },
  { area: "unstaged", binary: true, path: "image.png", status: "modified" },
];
const status: GitStatus = {
  branch: { ahead: 0, behind: 0, name: "main", unborn: false, upstream: null },
  changes,
  repoRoot: "/repo",
};
const diff = (file: string, newContent: string | null, binary = false) => ({
  binary,
  file,
  hunks: [],
  newContent,
  oldContent: "before\n",
});

const ControlledView = () => {
  const [selected, setSelected] = useState<GitChange>(changes[0]!);
  const [currentDiff, setCurrentDiff] = useState(diff("a.ts", "after\n"));
  return (
    <>
      <button
        onClick={() => setCurrentDiff(diff("a.ts", "live update\n"))}
        type="button"
      >
        Update diff
      </button>
      <SourceControlView
        diff={currentDiff}
        onSelectChange={setSelected}
        selectedChange={selected}
        status={status}
      />
    </>
  );
};

let container: HTMLDivElement;
let root: Root;

const diffText = () =>
  container.querySelector<HTMLElement>("[data-om-pierre-diff]")?.shadowRoot
    ?.textContent;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("SourceControlView", () => {
  test("renders read-only areas, navigates selected files, and replaces a live diff", async () => {
    await act(async () => root.render(<ControlledView />));

    expect(container.textContent).toContain("Unstaged");
    expect(container.textContent).toContain("Staged");
    expect(
      container.querySelector("[data-om-git-file]")?.textContent,
    ).not.toContain("Stage");
    await vi.waitFor(() => expect(diffText()).toContain("after"));

    await act(async () =>
      container.querySelector<HTMLButtonElement>("button")?.click(),
    );
    await vi.waitFor(() => expect(diffText()).toContain("live update"));

    const view = container.querySelector<HTMLElement>(
      "[data-om-source-control-view]",
    );
    await act(async () =>
      view?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }),
      ),
    );
    expect(container.textContent).toContain("No diff available.");
  });

  test("uses its pending selection for successive navigation before controlled props update", async () => {
    const onSelectChange = vi.fn();
    await act(async () =>
      root.render(
        <SourceControlView
          diff={diff("a.ts", "after\n")}
          onSelectChange={onSelectChange}
          selectedChange={changes[0]}
          status={status}
        />,
      ),
    );

    const view = container.querySelector<HTMLElement>(
      "[data-om-source-control-view]",
    );
    await act(async () => {
      view?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }),
      );
      view?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }),
      );
    });

    expect(onSelectChange).toHaveBeenNthCalledWith(1, changes[2]);
    expect(onSelectChange).toHaveBeenNthCalledWith(2, changes[1]);
  });

  test("falls back to an available selection for both sidebar and diff", async () => {
    const availableStatus = { ...status, changes: [changes[0]!] };
    await act(async () =>
      root.render(
        <SourceControlView
          diff={diff("a.ts", "after\n")}
          selectedChange={changes[2]}
          status={availableStatus}
        />,
      ),
    );

    expect(container.textContent).toContain("a.ts");
    expect(
      container
        .querySelector("[data-om-git-file]")
        ?.getAttribute("data-om-git-file"),
    ).toBe("unstaged:a.ts");
    expect(
      container
        .querySelector('[data-om-area="unstaged"]')
        ?.getAttribute("data-om-selected"),
    ).toBe("true");
  });
});
