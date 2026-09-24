import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  contents,
  entry,
  manifest,
  releaseFixture,
  snapshot,
} from "./release-fixture.mts";
import {
  nextVersion,
  releaseNote,
  validateVersionBase,
} from "../scripts/versioning.mts";

const testCases = [
  ["6.0.0-overmux.1", "6.0.0", "6.0.0-overmux.2"],
  ["6.0.0-overmux.9", "6.0.0", "6.0.0-overmux.10"],
  ["6.0.0-overmux.9", "6.0.1", "6.0.1-overmux.1"],
  ["6.0.0-overmux.9", "7.0.0", "7.0.0-overmux.1"],
];
for (const [current, upstream, expected] of testCases) {
  test(`${current} on ${upstream} prepares ${expected}`, () =>
    assert.equal(nextVersion(current, upstream), expected));
}
for (const [current, upstream] of [
  ["6.0.1", "6.0.0"],
  ["6.0.0-overmux.0", "6.0.0"],
  ["6.0.0-overmux.01", "6.0.0"],
  ["6.0.0-overmux.1.0", "6.0.0"],
  ["06.0.0-overmux.1", "6.0.0"],
  ["6.0.0-overmux.9007199254740991", "6.0.0"],
  ["6.0.0-overmux.9007199254740992", "6.0.0"],
  ["6.0.1-overmux.1", "6.0.0"],
  ["6.0.0-overmux.1", "6.0.1-beta.1"],
]) {
  test(`reject invalid version plan ${current} / ${upstream}`, () =>
    assert.throws(() => nextVersion(current, upstream)));
}
for (const contents of [
  entry("minor"),
  entry("major"),
  entry("none"),
  entry("patch", "other"),
  entry("patch", "@overmux/xterm-fork", ""),
  "---\n---\nEmpty",
  '---\n"@overmux/xterm-fork": patch\nother: patch\n---\nTwo packages',
  '---\n"@overmux/xterm-fork": patch\n"@overmux/xterm-fork": minor\n---\nDuplicate',
  "bad",
]) {
  test(`reject invalid entry ${JSON.stringify(contents)}`, () =>
    assert.throws(() => releaseNote(contents, "note.md")));
}
test("accept normal Changesets markdown", () =>
  assert.equal(releaseNote(entry(), "note.md"), "Fix terminal input."));
test("build rejects a base mismatch", () =>
  assert.throws(
    () => validateVersionBase("6.0.0-overmux.1", "6.0.1"),
    /base differs/,
  ));

const fixture = (t: { after: (fn: () => void) => void }) =>
  releaseFixture(t).cwd;
const commitFixture = (directory: string, version: string) => {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: directory });
  git("add", "--all");
  git("commit", "-m", "Fixture");
  git("tag", `xterm-fork-v${version}`);
};
const invoke = (
  directory: string,
  script: string,
  env = {},
  args: string[] = [],
) =>
  spawnSync(process.execPath, [`scripts/${script}.mts`, ...args], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

test("prepare consumes multiple notes once and keeps the note directory", (t) => {
  const directory = fixture(t);
  writeFileSync(resolve(directory, ".changeset/a.md"), entry());
  writeFileSync(
    resolve(directory, ".changeset/b.md"),
    entry("patch", "@overmux/xterm-fork", "Second fix.\n\nDetails."),
  );
  const version = nextVersion(manifest(directory).version, "6.0.0");
  const result = invoke(directory, "prepare-release");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(manifest(directory).version, version);
  assert.match(
    contents(directory, "CHANGELOG.md"),
    /Second fix\.\n  \n  Details\./,
  );
  assert.deepEqual(readdirSync(resolve(directory, ".changeset")).sort(), [
    ".gitkeep",
  ]);
  const prepared = snapshot(directory);
  assert.equal(invoke(directory, "prepare-release").status, 0);
  assert.deepEqual(snapshot(directory), prepared);
});
for (const invalid of [
  entry("minor"),
  entry("patch", "other"),
  "invalid yaml",
  entry("patch", "@overmux/xterm-fork", ""),
]) {
  test(`invalid plan changes nothing: ${JSON.stringify(invalid)}`, (t) => {
    const directory = fixture(t);
    writeFileSync(resolve(directory, ".changeset/a-valid.md"), entry());
    writeFileSync(resolve(directory, ".changeset/z-invalid.md"), invalid);
    const before = snapshot(directory);
    assert.notEqual(invoke(directory, "prepare-release").status, 0);
    assert.deepEqual(snapshot(directory), before);
  });
}
test("upstream bump resets counter only with a note", (t) => {
  const directory = fixture(t);
  writeFileSync(
    resolve(directory, "upstream.ts"),
    "export const upstream = { tag: '6.0.1' };\n",
  );
  const before = snapshot(directory);
  assert.equal(invoke(directory, "prepare-release").status, 0);
  assert.deepEqual(snapshot(directory), before);
  writeFileSync(resolve(directory, ".changeset/upstream.md"), entry());
  assert.equal(invoke(directory, "prepare-release").status, 0);
  assert.equal(manifest(directory).version, "6.0.1-overmux.1");
});
test("authoring only permits patch notes and produces consumable Changesets", (t) => {
  const directory = fixture(t);
  for (const args of [
    ["version"],
    ["publish"],
    ["--minor", "@overmux/xterm-fork"],
    ["--patch", "other"],
  ]) {
    assert.notEqual(invoke(directory, "changeset", {}, args).status, 0);
  }
  const result = invoke(directory, "changeset", {}, [
    "-m",
    "User-facing note.",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const note = readdirSync(resolve(directory, ".changeset")).find(
    (name) => name.endsWith(".md") && name !== "README.md",
  );
  assert.ok(note);
  assert.equal(
    releaseNote(contents(directory, `.changeset/${note}`), note),
    "User-facing note.",
  );
});
test("a rejected build removes stale workspace outputs and tarball", (t) => {
  const directory = fixture(t);
  mkdirSync(resolve(directory, "dist"));
  mkdirSync(resolve(directory, ".test-tmp"));
  writeFileSync(resolve(directory, "dist/stale.js"), "stale");
  const tarball = resolve(
    directory,
    ".test-tmp/overmux-xterm-fork-6.0.0-overmux.1.tgz",
  );
  writeFileSync(tarball, "stale");
  writeFileSync(
    resolve(directory, "upstream.ts"),
    "export const upstream = { tag: '6.0.1' };\n",
  );

  const result = invoke(directory, "build");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /base differs/);
  assert.equal(existsSync(resolve(directory, "dist")), false);
  assert.equal(existsSync(tarball), false);
});

test("builder rejects removed aliases instead of starting upstream work", (t) => {
  const directory = fixture(t);
  for (const command of ["test", "ci"]) {
    const result = invoke(directory, "build", {}, [command]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`Unknown command: ${command}`));
  }
});

test("root prepublish guard refuses publication", (t) => {
  const result = invoke(fixture(t), "publish-root-guard");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /private recipe root is not publishable/);
});
for (const scenario of [
  "valid",
  "repository",
  "event",
  "tag",
  "upstream",
  "pending",
  "dirty",
  "moved-head",
]) {
  test(`release identity guard: ${scenario}`, (t) => {
    const directory = fixture(t);
    const pkg = manifest(directory);
    const env = {
      GITHUB_REPOSITORY: "richardgill/overmux",
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REF: `refs/tags/xterm-fork-v${pkg.version}`,
    };
    if (scenario === "repository") {
      env.GITHUB_REPOSITORY = "other/repo";
    }
    if (scenario === "event") {
      env.GITHUB_EVENT_NAME = "push";
    }
    if (scenario === "tag") {
      env.GITHUB_REF = "refs/heads/main";
    }
    if (scenario === "upstream") {
      writeFileSync(
        resolve(directory, "upstream.ts"),
        "export const upstream = { tag: '6.0.1' };\n",
      );
    }
    if (scenario === "pending") {
      writeFileSync(resolve(directory, ".changeset/pending.md"), entry());
    }
    writeFileSync(resolve(directory, "package.json"), JSON.stringify(pkg));
    commitFixture(directory, pkg.version);
    if (scenario === "dirty") {
      writeFileSync(resolve(directory, "unexpected"), "dirty");
    }
    if (scenario === "moved-head") {
      execFileSync("git", ["commit", "--allow-empty", "-m", "After tag"], {
        cwd: directory,
      });
    }
    const result = invoke(directory, "release-guard", env);
    assert.equal(result.status === 0, scenario === "valid", result.stderr);
  });
}
