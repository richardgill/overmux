import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test, test as testCases } from "vitest";

import { configDefinitionRuntimeSchema, loadOvermuxConfig } from "./config";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

test("loads app-relative and workspace TypeScript paths through a symlinked root", async () => {
  await mkdir(join(process.cwd(), ".test-tmp"), { recursive: true });
  const workspace = await mkdtemp(
    join(process.cwd(), ".test-tmp/config-loader-"),
  );
  directories.push(workspace);
  const realRoot = join(workspace, "store-application");
  const logicalRoot = join(workspace, "application");
  const sharedRoot = join(workspace, "shared");
  await Promise.all([mkdir(realRoot), mkdir(sharedRoot)]);
  await symlink(realRoot, logicalRoot, "dir");
  await writeFile(
    join(realRoot, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@workspace/*": ["../shared/*"] },
      },
    }),
  );
  await writeFile(
    join(sharedRoot, "server.ts"),
    "export default { resources: {} };\n",
  );
  await writeFile(
    join(realRoot, "application.ts"),
    'export const development = { host: "0.0.0.0", port: 4242 };\n',
  );
  const configPath = join(logicalRoot, "overmux.config.ts");
  await writeFile(
    configPath,
    'import server from "@workspace/server"; import { development } from "./application"; export default { ...development, auth: { mode: "cli-login" }, server };\n',
  );

  const loaded = await loadOvermuxConfig({ configPath });

  expect(loaded.config).toMatchObject({
    auth: { mode: "cli-login", sessionLifetime: "forever" },
    host: "0.0.0.0",
    port: 4242,
    server: { resources: {} },
  });
  expect(loaded.paths).toStrictEqual({
    logicalApplicationRoot: logicalRoot,
    logicalConfigPath: configPath,
    realApplicationRoot: await realpath(realRoot),
    realConfigPath: await realpath(configPath),
  });
});

const configWithSessionLifetime = (sessionLifetime: string) => ({
  auth: { mode: "cli-login", sessionLifetime },
  server: { resources: {} },
});

const invalidSessionLifetimes = ["0m", "-1h", "1s", "Infinityd", "never"];

test("validates unlimited and finite authentication session lifetimes", () => {
  expect(
    configDefinitionRuntimeSchema.parse(configWithSessionLifetime("forever"))
      .auth.sessionLifetime,
  ).toBe("forever");
  expect(
    configDefinitionRuntimeSchema.parse(configWithSessionLifetime("30d")).auth
      .sessionLifetime,
  ).toBe("30d");
});

testCases.each(invalidSessionLifetimes)(
  "rejects invalid session lifetime %s",
  (sessionLifetime) => {
    expect(
      configDefinitionRuntimeSchema.safeParse(
        configWithSessionLifetime(sessionLifetime),
      ).success,
    ).toBe(false);
  },
);

test("accepts unique exact browser origins and a loopback trusted proxy peer", () => {
  const origins = ["http://localhost:4242", "https://machine.example.com"];

  const parsed = configDefinitionRuntimeSchema.parse({
    auth: {
      mode: "cli-login",
      origins,
      trustedProxyPeer: "127.0.0.1",
    },
    server: { resources: {} },
  });

  expect(parsed.auth.origins).toEqual(origins);
  expect(parsed.auth.trustedProxyPeer).toBe("127.0.0.1");
});

const invalidOrigins = [
  { name: "an empty array", origins: [] },
  { name: "a path", origins: ["http://localhost:4242/path"] },
  { name: "non-loopback HTTP", origins: ["http://machine.example.com"] },
  {
    name: "duplicates",
    origins: ["https://machine.example.com", "https://machine.example.com"],
  },
];

testCases.each(invalidOrigins)("rejects $name", ({ origins }) => {
  expect(
    configDefinitionRuntimeSchema.safeParse({
      auth: { mode: "cli-login", origins },
      server: { resources: {} },
    }).success,
  ).toBe(false);
});

test("rejects the removed singular auth origin", () => {
  expect(
    configDefinitionRuntimeSchema.safeParse({
      auth: { mode: "cli-login", origin: "http://localhost:4242" },
      server: { resources: {} },
    }).success,
  ).toBe(false);
});

test("rejects a non-loopback trusted proxy peer", () => {
  expect(
    configDefinitionRuntimeSchema.safeParse({
      auth: {
        mode: "cli-login",
        trustedProxyPeer: "100.64.0.1",
      },
      server: { resources: {} },
    }).success,
  ).toBe(false);
});

test("accepts only known AI context snippets", () => {
  expect(
    configDefinitionRuntimeSchema.parse({
      aiContextSnippets: ["package-source", "tech-stack-recommendations"],
      auth: { mode: "cli-login" },
      server: { resources: {} },
    }).aiContextSnippets,
  ).toEqual(["package-source", "tech-stack-recommendations"]);
  expect(
    configDefinitionRuntimeSchema.safeParse({
      aiContextSnippets: ["unknown"],
      auth: { mode: "cli-login" },
      server: { resources: {} },
    }).success,
  ).toBe(false);
});

test("requires explicit CLI login authentication", () => {
  expect(
    configDefinitionRuntimeSchema.safeParse({
      server: { resources: {} },
    }).success,
  ).toBe(false);
});
