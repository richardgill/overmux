import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, it } from "vitest";

it("bundles keybindings and its Zod peer into main and preload JavaScript", async () => {
  const manifest = JSON.parse(
    await readFile(resolve("package.json"), "utf8"),
  ) as { dependencies: Record<string, string> };
  const outputDirectory = resolve("dist/main");
  const files = (await readdir(outputDirectory, { recursive: true })).filter(
    (file) => /\.(?:cjs|js)$/u.test(file),
  );

  expect(manifest.dependencies).not.toHaveProperty("@overmux/keybindings");
  expect(manifest.dependencies).not.toHaveProperty("zod");
  expect(files).toEqual(
    expect.arrayContaining([
      "index.js",
      "preload.cjs",
      "remote-notifications.cjs",
    ]),
  );
  for (const file of files) {
    const code = await readFile(resolve(outputDirectory, file), "utf8");
    expect(code, file).not.toMatch(
      /\b(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)["'](?:@overmux\/keybindings|zod)(?:\/[^"']*)?["']/u,
    );
  }
});
