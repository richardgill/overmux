import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, test as testCases } from "vitest";

import { runCli } from "../../testing/e2e-utils";

const directories: string[] = [];

const createConfig = async (aiContextSnippets?: string) => {
  await mkdir(join(process.cwd(), ".test-tmp"), { recursive: true });
  const directory = await mkdtemp(join(process.cwd(), ".test-tmp/ai-context-"));
  directories.push(directory);
  const configPath = join(directory, "overmux.config.ts");
  await writeFile(
    configPath,
    `export default {
  auth: { mode: "cli-login" },
  server: { resources: {} },
  ${aiContextSnippets === undefined ? "" : `aiContextSnippets: ${aiContextSnippets},`}
};\n`,
  );
  return configPath;
};

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

it("documents only configuration for AI context", async () => {
  const result = await runCli(["docs", "ai-context", "--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("overmux docs ai-context");
  expect(result.stdout).toContain("--config");
  expect(result.stdout).not.toContain("--package-source");
});

testCases.each([
  {
    includesRecommendations: true,
    name: "the default selection",
    snippets: undefined,
  },
  {
    includesRecommendations: false,
    name: "the package source selection",
    snippets: '["package-source"]',
  },
])(
  "prints package guidance for $name",
  async ({ includesRecommendations, snippets }) => {
    const result = await runCli([
      "docs",
      "ai-context",
      "--config",
      await createConfig(snippets),
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("## package-source");
    expect(result.stdout).toContain("`overmux docs path`");
    expect(result.stdout).toContain("not source paths");
    expect(result.stdout).toContain("`node_modules/overmux/src`");
    expect(result.stdout).toContain("`node_modules/@overmux/xterm/src`");
    expect(result.stdout.includes("TanStack Router")).toBe(
      includesRecommendations,
    );
  },
);

it("prints nothing for an explicit empty selection", async () => {
  const result = await runCli([
    "docs",
    "ai-context",
    "-c",
    await createConfig("[]"),
  ]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toBe("");
});
