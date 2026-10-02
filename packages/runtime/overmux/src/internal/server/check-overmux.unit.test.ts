import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import { checkOvermux } from "./check-overmux";

// Keep consumers in the runtime package's dependency scope, not the workspace root's.
const testTemporaryRoot = fileURLToPath(
  new URL("../../../.test-tmp/", import.meta.url),
);
const directories: string[] = [];

const createProject = async ({
  config,
  server,
}: {
  config?: string;
  server: string;
}) => {
  await mkdir(testTemporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(testTemporaryRoot, "check-project-"));
  directories.push(directory);
  const configPath = join(directory, "overmux.config.ts");
  await writeFile(
    configPath,
    config ??
      `
import { defineOvermuxConfig } from "overmux";
import server from "./overmux.server";
export default defineOvermuxConfig({ auth: { mode: "cli-login" }, server });
`,
  );
  await writeFile(join(directory, "overmux.server.ts"), server);
  return configPath;
};

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("overmux check", () => {
  test("reports source diagnostics from reachable server files", async () => {
    const configPath = await createProject({
      server: "const wrong: string = 42; export default wrong;",
    });

    const result = await checkOvermux({ configPath, typesOnly: true });

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 2322,
          file: join(dirname(configPath), "overmux.server.ts"),
        }),
      ]),
    );
  });

  test("reports runtime schema diagnostics without a stack", async () => {
    const configPath = await createProject({
      server: `
import { defineOvermuxServer } from "overmux";
export default defineOvermuxServer({ resources: { count: { kind: "query" } as any } });
`,
    });

    const result = await checkOvermux({ configPath });

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics[0]).toMatchObject({
      phase: "runtime",
    });
    expect(result.diagnostics[0]?.message).not.toContain("\n    at ");
  });

  test("checks missing server imports", async () => {
    const configPath = await createProject({
      config: `import { defineOvermuxConfig } from "overmux";
export default defineOvermuxConfig({ auth: { mode: "cli-login" }, server: (await import("./missing.ts")).default });`,
      server: "export default { resources: {} };",
    });
    const result = await checkOvermux({ configPath });
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(({ message }) => message.includes("missing.ts")),
    ).toBe(true);
  });

  test("follows server value imports regardless of filename", async () => {
    const configPath = await createProject({
      config: `import { defineOvermuxConfig } from "overmux";
import server from "./plain";
export default defineOvermuxConfig({ auth: { mode: "cli-login" }, server });`,
      server: "export default { resources: {} };",
    });
    await writeFile(
      join(dirname(configPath), "plain.ts"),
      'import { createOvermuxHooks } from "overmux/client"; export default { resources: {} };',
    );
    const result = await checkOvermux({ configPath });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "OVERMUX_IMPORT_BOUNDARY",
          phase: "imports",
        }),
      ]),
    );
  });

  test("rejects server imports from reachable shared modules", async () => {
    const configPath = await createProject({
      server: 'import "./overmux.shared"; export default { resources: {} };',
    });
    const sharedPath = join(dirname(configPath), "overmux.shared.ts");
    await writeFile(sharedPath, 'import "node:fs";');

    const result = await checkOvermux({ configPath, typesOnly: true });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "OVERMUX_IMPORT_BOUNDARY",
          file: sharedPath,
        }),
      ]),
    );
  });
});
