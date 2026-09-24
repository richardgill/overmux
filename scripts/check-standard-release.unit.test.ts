import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { expect, test as testCases } from "vitest";

const root = resolve(import.meta.dirname, "..");
const cases = [
  {
    name: "package-owned fork notes are isolated",
    target: undefined,
    allowed: true,
  },
  {
    name: "standard fork versioning is rejected",
    target: "@overmux/xterm-fork",
    allowed: false,
  },
  {
    name: "desktop private versioning stays enabled",
    target: "desktop",
    allowed: true,
  },
  {
    name: "detached CI checkout needs no local main branch",
    target: undefined,
    allowed: true,
    detached: true,
  },
  {
    name: "detached CI checkout still rejects standard fork versioning",
    target: "@overmux/xterm-fork",
    allowed: false,
    detached: true,
  },
];

testCases.each(cases)("$name", ({ target, allowed, detached }) => {
  mkdirSync(resolve(root, ".test-tmp"), { recursive: true });
  const fixture = mkdtempSync(resolve(root, ".test-tmp/fork-isolation-"));
  try {
    mkdirSync(resolve(fixture, "scripts"));
    cpSync(
      resolve(root, "scripts/check-standard-release.ts"),
      resolve(fixture, "scripts/check-standard-release.ts"),
    );
    symlinkSync(
      resolve(root, "node_modules"),
      resolve(fixture, "node_modules"),
      "dir",
    );
    writeFileSync(
      resolve(fixture, "package.json"),
      JSON.stringify({ name: "fixture", private: true, type: "module" }),
    );
    writeFileSync(
      resolve(fixture, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
    );
    for (const [directory, name, version, dependencies] of [
      ["fork", "@overmux/xterm-fork", "6.0.0-overmux.1", {}],
      [
        "consumer",
        "consumer",
        "1.0.0",
        { "@overmux/xterm-fork": "workspace:*" },
      ],
      ["desktop", "desktop", "1.0.0", {}],
    ] as const) {
      mkdirSync(resolve(fixture, "packages", directory), { recursive: true });
      writeFileSync(
        resolve(fixture, "packages", directory, "package.json"),
        JSON.stringify({
          name,
          version,
          private: directory !== "consumer",
          dependencies,
        }),
      );
    }
    mkdirSync(resolve(fixture, ".changeset"));
    const config = JSON.parse(
      readFileSync(resolve(root, ".changeset/config.json"), "utf8"),
    );
    writeFileSync(
      resolve(fixture, ".changeset/config.json"),
      JSON.stringify({ ...config, changelog: false }),
    );
    mkdirSync(resolve(fixture, "packages/fork/.changeset"));
    writeFileSync(
      resolve(fixture, "packages/fork/.changeset/local.md"),
      '---\n"@overmux/xterm-fork": patch\n---\n\nLocal note.\n',
    );
    if (target) {
      writeFileSync(
        resolve(fixture, ".changeset/root.md"),
        `---\n"${target}": patch\n---\n\nRoot note.\n`,
      );
    }
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: fixture });
    git("init", "-b", "main");
    git("config", "user.email", "release-test@example.invalid");
    git("config", "user.name", "Release Test");
    git("config", "commit.gpgsign", "false");
    git("config", "core.hooksPath", "/dev/null");
    writeFileSync(resolve(fixture, ".gitignore"), "node_modules\n.test-tmp\n");
    git("add", ".");
    git("commit", "-m", "Fixture");
    if (detached) {
      git("checkout", "--detach");
      git("branch", "-d", "main");
    }

    const result = spawnSync(
      process.execPath,
      ["scripts/check-standard-release.ts"],
      { cwd: fixture, encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(allowed ? 0 : 1);
    expect(
      JSON.parse(
        readFileSync(resolve(fixture, "packages/fork/package.json"), "utf8"),
      ).version,
    ).toBe("6.0.0-overmux.1");
    if (!allowed) {
      expect(result.stderr).toContain("must never be versioned");
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
