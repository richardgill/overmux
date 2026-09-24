import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  new URL("./update-popover.css", import.meta.url),
  "utf8",
);

describe("update popover styles", () => {
  it("uses scoped public theme tokens", () => {
    expect(css).toContain("@scope (");
    [
      "--om-color-border",
      "--om-color-muted",
      "--om-color-panel",
      "--om-color-surface",
      "--om-elevation",
      "--om-radius",
      "--om-spacing",
    ].forEach((token) => expect(css).toContain(token));
  });

  it("layers lifecycle screens above update UI", () => {
    expect(css).toContain("[data-om-update]");
    expect(css).toContain("z-index: 1001");
    expect(css).toContain("[data-om-reconnecting]");
    expect(css).toContain("z-index: 1002");
    expect(css).toContain("[data-om-restarting]");
    expect(css).toContain("z-index: 1003");
  });
});
