import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(resolve(process.cwd(), "src", path), "utf8");

const react = readSource("react.tsx");
const styles = readSource("styles.css");

describe("xterm styles", () => {
  it("loads upstream xterm defaults through the package stylesheet", () => {
    expect(react).toContain('import "./styles.css";');
    expect(styles).toContain(
      '@import "@overmux/xterm-fork/css/xterm.css" layer(om.components);',
    );
  });
});
