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

import { PierreFileDiff } from "./pierre-diff";

const oldContent = `${Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join("\n")}\n`;
const newContent = oldContent.replace("line 70\n", "changed 70\n");

const DiffHarness = ({ cacheKey = "revision:file" }: { cacheKey?: string }) => (
  <div className="om-source-control-diff">
    <article data-om-git-file="unstaged:file.txt">
      <PierreFileDiff
        cacheKey={cacheKey}
        diffStyle="unified"
        newContent={newContent}
        oldContent={oldContent}
        path="file.txt"
      />
    </article>
  </div>
);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
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

const expander = () =>
  container.querySelector<HTMLElement>(".om-git-diff-expander");

describe("Pierre full-content diff", () => {
  testCases("expands omitted context upward incrementally", async () => {
    await act(async () => root.render(<DiffHarness />));
    await vi.waitFor(() => expect(expander()).not.toBeNull());
    const separator = expander();
    const before = Number.parseInt(
      separator?.querySelector(".om-git-diff-expander-label")?.textContent ??
        "",
      10,
    );
    const separatorIdentity = separator?.dataset.omGitSeparator;
    const button = separator?.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand upward"]',
    );
    expect(button?.querySelector("svg path")).not.toBeNull();
    expect(button?.tabIndex).toBe(0);

    await act(async () => button?.click());
    await vi.waitFor(() => {
      const next = container.querySelector<HTMLElement>(
        `[data-om-git-separator="${separatorIdentity}"]`,
      );
      const after = Number.parseInt(
        next?.querySelector(".om-git-diff-expander-label")?.textContent ?? "",
        10,
      );
      expect(after).toBe(before - 20);
    });
  });

  testCases(
    "expands the complete file and preserves pane scrollTop",
    async () => {
      await act(async () => root.render(<DiffHarness />));
      await vi.waitFor(() => expect(expander()).not.toBeNull());
      const pane = container.querySelector<HTMLElement>(
        ".om-source-control-diff",
      );
      if (!pane) {
        throw new Error("Missing diff pane");
      }
      pane.scrollTop = 120;
      const button = expander()?.querySelector<HTMLButtonElement>(
        'button[aria-label="Expand whole file"]',
      );

      await act(async () => button?.click());
      await vi.waitFor(() => expect(expander()).toBeNull());
      expect(pane.scrollTop).toBe(120);
      expect(
        container.querySelector<HTMLElement>("[data-om-pierre-diff]")
          ?.shadowRoot?.textContent,
      ).toContain("line 1");
    },
  );

  testCases("resets whole-file expansion for a new cache key", async () => {
    await act(async () => root.render(<DiffHarness cacheKey="first" />));
    await vi.waitFor(() => expect(expander()).not.toBeNull());
    await act(async () =>
      expander()
        ?.querySelector<HTMLButtonElement>(
          'button[aria-label="Expand whole file"]',
        )
        ?.click(),
    );
    await vi.waitFor(() => expect(expander()).toBeNull());

    await act(async () => root.render(<DiffHarness cacheKey="second" />));
    await vi.waitFor(() => expect(expander()).not.toBeNull());
  });
});
