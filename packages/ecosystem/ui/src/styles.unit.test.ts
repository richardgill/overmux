import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("UI styles", () => {
  it("contains split view styles within its public root", () => {
    expect(css).toContain("@scope ([data-om-split-view])");
  });

  it("ships split view layout and separator styles", () => {
    expect(css).toContain("[data-om-split-view]");
    expect(css).toContain("[data-om-split-view-separator]");
  });
});
