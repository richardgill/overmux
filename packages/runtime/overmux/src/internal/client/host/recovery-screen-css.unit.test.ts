import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  new URL("./recovery-screen.css", import.meta.url),
  "utf8",
);

describe("recovery screen styles", () => {
  it("uses scoped public tokens and accessible motion modes", () => {
    expect(css).toContain("@scope ([data-om-recovery])");
    [
      "--om-color-accent",
      "--om-color-canvas",
      "--om-color-danger",
      "--om-color-fg",
      "--om-focus-ring",
      "--om-font-mono",
      "--om-motion-duration",
      "--om-radius",
      "--om-spacing",
      "--om-elevation",
    ].forEach((token) => expect(css).toContain(token));
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});
