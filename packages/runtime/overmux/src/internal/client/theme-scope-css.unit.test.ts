import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./theme-scope.css", import.meta.url), "utf8");

describe("theme scope styles", () => {
  it("provides scoped defaults for foundational tokens", () => {
    ["--om-color-fg", "--om-color-success", "--om-font-sans"].forEach((token) =>
      expect(css).toContain(token),
    );
  });

  it("supports scoped layers and accessible display modes", () => {
    expect(css).toContain("@layer theme, base, om;");
    expect(css).toContain("@layer om.components");
    expect(css).toContain("@scope ([data-om-scope]) to ([data-om-scope])");
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toContain("prefers-contrast: more");
    expect(css).toContain("forced-colors: active");
    expect(css).toContain('[data-om-scheme="system"]');
    expect(css).toContain('[data-om-contrast="high"]');
  });
});
