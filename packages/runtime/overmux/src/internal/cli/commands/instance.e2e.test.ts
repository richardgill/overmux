import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import { createAuthService } from "../../server/auth/auth-service";
import { startInstanceControl } from "../../server/auth/instance-control";
import {
  startApplicationServer,
  type ApplicationServer,
} from "../../server/start-application-server";
import { runCli } from "../../testing/e2e-utils";

let server: ApplicationServer | undefined;
let directory: string | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (directory) {
    await rm(directory, { force: true, recursive: true });
  }
  vi.unstubAllEnvs();
});

it("prints the live authenticated identity without evaluating local config again", async () => {
  const root = resolve(".test-tmp");
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(join(root, "identity-"));
  vi.stubEnv("XDG_RUNTIME_DIR", directory);
  vi.stubEnv("XDG_DATA_HOME", directory);
  vi.stubEnv("XDG_STATE_HOME", directory);
  const configPath = join(directory, "overmux.config.ts");
  await writeFile(
    configPath,
    `
    import { defineOvermuxConfig, defineOvermuxServer } from "overmux";
    export default defineOvermuxConfig({
      auth: { mode: "cli-login" }, host: "127.0.0.1", watch: false,
      instanceId: ({ port }) => \`cli-test-\${port}\`,
      server: defineOvermuxServer({ resources: {} }),
    });
  `,
  );
  server = await startApplicationServer({
    onRestartRequested: () => undefined,
    options: {
      configAliases: { overmux: import.meta.resolve("overmux") },
      configPath,
      port: 0,
    },
  });
  await writeFile(configPath, 'throw new Error("CLI must not reload config");');

  const json = await runCli([
    "instance",
    "--port",
    String(server.port),
    "--json",
  ]);
  const text = await runCli(["instance"]);

  const instanceId = `cli-test-${server.port}`;
  expect(json.exitCode).toBe(0);
  expect(json.stderr).toBe("");
  expect(JSON.parse(json.stdout)).toEqual({
    instanceId,
    deepLinkPrefix: `overmux://${instanceId}`,
  });
  expect(text.exitCode).toBe(0);
  expect(text.stdout).toBe(
    `Instance ID: ${instanceId}\nDeep-link prefix: overmux://${instanceId}\n`,
  );
}, 15_000);

it("prints identity through control without an HTTP endpoint", async () => {
  const root = resolve(".test-tmp");
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(join(root, "identity-control-"));
  vi.stubEnv("XDG_RUNTIME_DIR", directory);
  vi.stubEnv("XDG_DATA_HOME", directory);
  const url = "http://127.0.0.1:4242";
  const auth = createAuthService({
    config: { mode: "cli-login" },
    environment: { XDG_DATA_HOME: directory },
    homeDirectory: "/unused",
  });
  auth.setOrigins([url]);
  const control = await startInstanceControl({
    auth,
    apiUrl: url,
    instanceId: "control-only",
    port: 4242,
    url,
  });

  try {
    const result = await runCli(["instance", "--port", "4242", "--json"]);
    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout:
        '{"instanceId":"control-only","deepLinkPrefix":"overmux://control-only"}\n',
    });
  } finally {
    await control.close();
  }
});
