import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { OvermuxPortal, OvermuxThemeScope } from "./theme-scope";

const containers: HTMLElement[] = [];
const roots: ReturnType<typeof createRoot>[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => root.unmount());
  containers.splice(0).forEach((container) => container.remove());
});

const render = async (content: React.ReactNode) => {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(content));
  return container;
};

describe("OvermuxPortal", () => {
  it("renders beneath the nearest theme scope", async () => {
    const container = await render(
      <OvermuxThemeScope>
        <OvermuxThemeScope scheme="light">
          <OvermuxPortal>
            <p data-test-overlay="">Overlay</p>
          </OvermuxPortal>
        </OvermuxThemeScope>
      </OvermuxThemeScope>,
    );
    const scopes = container.querySelectorAll("[data-om-scope]");

    expect(scopes).toHaveLength(2);
    expect(
      scopes[1]
        ?.querySelector("[data-om-overlay-root]")
        ?.querySelector("[data-test-overlay]"),
    ).not.toBeNull();
    expect(
      scopes[0]
        ?.querySelector(":scope > [data-om-overlay-root]")
        ?.querySelector("[data-test-overlay]"),
    ).toBeNull();
  });

  it("supports caller-owned external containers", async () => {
    const external = document.createElement("div");
    document.body.append(external);
    containers.push(external);

    await render(
      <OvermuxPortal
        external={{
          container: external,
          scopeAttributesAndVariables: "caller-owned",
        }}
      >
        External overlay
      </OvermuxPortal>,
    );

    expect(external.textContent).toBe("External overlay");
  });
});
