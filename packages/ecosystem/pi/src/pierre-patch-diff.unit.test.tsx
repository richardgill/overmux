// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test as testCases, vi } from "vitest";

import { PierrePatchDiff } from "./pierre-patch-diff";

const patch = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1 +1 @@
-old value
+new value`;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

testCases("renders patches without Git UI dependencies", async () => {
  await act(async () => root.render(<PierrePatchDiff patch={patch} />));

  await vi.waitFor(() =>
    expect(
      container.querySelector("diffs-container")?.shadowRoot?.textContent,
    ).toContain("new value"),
  );
});
