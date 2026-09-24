import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterEach, expect, test as testCases } from "vitest";

const checker = resolve(import.meta.dirname, "check-changesets.ts");
const fixtureRoot = resolve(import.meta.dirname, "..", ".test-tmp");
const fixtures: string[] = [];

const write = (root: string, file: string, content = "changed\n") => {
  const target = `${root}/${file}`;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
};

const createFixture = () => {
  mkdirSync(fixtureRoot, { recursive: true });
  const root = mkdtempSync(`${fixtureRoot}/overmux-check-changesets-`);
  fixtures.push(root);
  write(root, "pnpm-workspace.yaml", "packages:\n  - apps/*\n");
  write(
    root,
    "package.json",
    JSON.stringify({ name: "fixture", private: true }),
  );
  write(
    root,
    ".changeset/config.json",
    JSON.stringify({
      changelog: false,
      commit: false,
      access: "public",
      baseBranch: "main",
      updateInternalDependencies: "patch",
      ignore: [],
      privatePackages: { version: true, tag: false },
    }),
  );
  write(
    root,
    "apps/desktop/package.json",
    JSON.stringify({
      name: "@overmux/desktop",
      version: "1.0.0",
      private: true,
    }),
  );
  write(
    root,
    "apps/unrelated/package.json",
    JSON.stringify({
      name: "@test/unrelated",
      version: "1.0.0",
      private: true,
    }),
  );
  write(
    root,
    "apps/public/package.json",
    JSON.stringify({ name: "@test/public", version: "1.0.0" }),
  );
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "initial"], { cwd: root });
  return root;
};

const addDesktopChangeset = (root: string) =>
  write(
    root,
    ".changeset/desktop.md",
    '---\n"@overmux/desktop": patch\n---\n\nDesktop release input.\n',
  );

const addEmptyChangeset = (root: string) =>
  write(root, ".changeset/no-release.md", "---\n---\n\nNo release needed.\n");

const runChecker = (root: string) => {
  const result = spawnSync(process.execPath, [checker], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CHANGESET_BASE_REF: "HEAD" },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { force: true, recursive: true });
  }
});

const checkerTestCases = [
  {
    name: "requires coverage for a desktop source change",
    change: "apps/desktop/src/main.ts",
    setup: () => {},
    status: 1,
    output: "Missing: `@overmux/desktop`",
  },
  {
    name: "accepts a new desktop changeset",
    change: "apps/desktop/src/main.ts",
    setup: addDesktopChangeset,
    status: 0,
    output: "All affected published packages are covered.",
  },
  {
    name: "preserves the empty changeset opt-out",
    change: "apps/desktop/src/main.ts",
    setup: addEmptyChangeset,
    status: 0,
    output: "A new empty changeset opts out of releases for this change.",
  },
  {
    name: "exempts unrelated private packages",
    change: "apps/unrelated/src/main.ts",
    setup: () => {},
    status: 0,
    output: "No affected published packages.",
  },
] as const;

testCases.each(checkerTestCases)(
  "$name",
  ({ change, setup, status, output }) => {
    const root = createFixture();
    write(root, change);
    setup(root);

    const result = runChecker(root);

    expect(result.status).toBe(status);
    expect(result.output).toContain(output);
  },
);

const workflowTestCases = [
  {
    change: ".github/workflows/desktop-release.yml",
    affectsPublicPackages: false,
  },
  { change: ".github/workflows/release.yml", affectsPublicPackages: true },
  { change: ".github/shared/action.yml", affectsPublicPackages: true },
];

testCases.each(workflowTestCases)(
  "requires desktop coverage for $change",
  ({ change, affectsPublicPackages }) => {
    const root = createFixture();
    write(root, change);

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing: `@overmux/desktop`");
    expect(result.output.includes("Missing: `@test/public`")).toBe(
      affectsPublicPackages,
    );
  },
);
