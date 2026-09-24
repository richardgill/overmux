import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { release } from "../scripts/release-command.mts";
import { releaseFixture } from "./release-fixture.mts";

const tag = "xterm-fork-v6.0.0-overmux.2";
const packagePath = "packages/ecosystem/xterm-fork";
const fixture = (t: { after: (fn: () => void) => void }) =>
  releaseFixture(t, { releaseNote: true, unrelatedChangeset: true });

type Scenario = {
  failure?: string;
  remoteTag?: boolean;
  published?: boolean;
  emptyRuns?: boolean;
  ambiguous?: boolean;
  staleRun?: boolean;
  isPrivate?: boolean;
};
const harness = (
  t: { after: (fn: () => void) => void },
  scenario: Scenario = {},
) => {
  const { cwd, git } = fixture(t);
  const calls: string[] = [];
  const logs: string[] = [];
  let dispatched = false;
  const exec = (command: string, args: string[], directory: string) => {
    const call = `${command} ${args.join(" ")}`;
    calls.push(call);
    if (scenario.failure && call.startsWith(scenario.failure)) {
      throw new Error(`Injected failure: ${scenario.failure}`);
    }
    if (command === "npm") {
      return JSON.stringify(
        scenario.published ? ["6.0.0-overmux.2"] : ["6.0.0-overmux.1"],
      );
    }
    if (command === "pnpm") {
      return execFileSync(process.execPath, ["scripts/prepare-release.mts"], {
        cwd: directory,
        encoding: "utf8",
      });
    }
    if (command === "git" && args[0] === "ls-remote") {
      return scenario.remoteTag ? `abcdef\trefs/tags/${tag}` : "";
    }
    if (command === "git" && args[0] === "push") {
      return "";
    }
    if (command === "git") {
      return execFileSync(command, args, { cwd: directory, encoding: "utf8" });
    }
    assert.equal(command, "gh", `Unexpected external command ${call}`);
    if (args[0] === "repo") {
      return JSON.stringify({
        nameWithOwner: "richardgill/overmux",
        isPrivate: scenario.isPrivate ?? true,
      });
    }
    if (args[0] === "workflow") {
      dispatched = true;
      return "";
    }
    if (args[1] === "watch") {
      return "";
    }
    assert.equal(args[1], "list");
    const old = {
      databaseId: 11,
      headSha: git("rev-parse", "HEAD"),
      headBranch: tag,
      event: "workflow_dispatch",
    };
    const current = { ...old, databaseId: 42 };
    const runs = !dispatched || scenario.emptyRuns ? [old] : [old, current];
    if (scenario.ambiguous && dispatched) {
      runs.push({ ...current, databaseId: 43 });
    }
    if (scenario.staleRun && dispatched) {
      return JSON.stringify([old, { ...current, headSha: "unrelated" }]);
    }
    return JSON.stringify(runs);
  };
  const options = {
    cwd,
    upstreamVersion: "6.0.0",
    interactive: true,
    exec,
    log: (message: string) => logs.push(message),
    pause: async () => {},
    confirm: async () => {
      calls.push("confirm");
      return true;
    },
  };
  return { cwd, git, calls, logs, options };
};
const mutations = (calls: string[]) =>
  calls.filter((call) =>
    /^(git (commit|push|tag xterm-fork-v)|gh workflow|gh run watch)/.test(call),
  );
const errors = (error: unknown): string =>
  error instanceof Error ? `${error.message}\n${errors(error.cause)}` : "";

test("release prepares, reviews, commits only release paths, pushes, tags, dispatches and watches correlated run", async (t) => {
  const h = harness(t);
  await release(h.options);
  assert.deepEqual(
    h.calls.filter(
      (call) =>
        call === "confirm" ||
        call.startsWith("pnpm ") ||
        mutations([call]).length,
    ),
    [
      "pnpm run prepare-release",
      "confirm",
      `git commit --only -m Release xterm fork 6.0.0-overmux.2 -- ${packagePath}/package.json ${packagePath}/CHANGELOG.md ${packagePath}/.changeset/fix.md`,
      "git push origin HEAD:refs/heads/main",
      `git tag ${tag} ${h.git("rev-parse", "HEAD")}`,
      `git push origin refs/tags/${tag}:refs/tags/${tag}`,
      `gh workflow run xterm-fork-release.yml --repo richardgill/overmux --ref ${tag}`,
      "gh run watch 42 --repo richardgill/overmux --exit-status",
    ],
  );
  assert.equal(h.git("status", "--porcelain"), "");
  assert.equal(h.git("rev-list", "--count", "HEAD"), "2");
  assert.equal(h.git("rev-parse", tag), h.git("rev-parse", "HEAD"));
  assert.match(
    h.logs.join("\n"),
    /Commit: Release xterm fork 6\.0\.0-overmux\.2[\s\S]*diff --git[\s\S]*Fix input/,
  );
  assert.ok(
    h.calls.some((call) =>
      call.includes(
        `--branch ${tag} --commit ${h.git("rev-parse", "HEAD")} --event workflow_dispatch`,
      ),
    ),
  );
});

test("declining preserves preparation without any release mutation", async (t) => {
  const h = harness(t);
  await release({ ...h.options, confirm: async () => false });
  assert.deepEqual(mutations(h.calls), []);
  assert.match(h.git("diff"), /6\.0\.0-overmux\.2/);
  assert.match(h.logs.at(-1)!, /Cancelled.*remain/);
});

for (const isPrivate of [true, false]) {
  test(`releases from a ${isPrivate ? "private" : "public"} GitHub repository`, async (t) => {
    const h = harness(t, { isPrivate });
    await release(h.options);
    assert.ok(h.calls.some((call) => call.startsWith("gh workflow run")));
  });
}

for (const scenario of [
  "noninteractive",
  "dirty",
  "no-notes",
  "remote-tag",
  "npm-missing",
  "published",
  "wrong-origin",
  "edited-at-prompt",
]) {
  test(`refuses ${scenario} without commit/push/tag/dispatch`, async (t) => {
    const h = harness(t, {
      remoteTag: scenario === "remote-tag",
      failure: scenario === "npm-missing" ? "npm view" : undefined,
      published: scenario === "published",
    });
    if (scenario === "noninteractive") {
      h.options.interactive = false;
    }
    if (scenario === "dirty") {
      writeFileSync(resolve(h.cwd, "untracked"), "dirty");
    }
    if (scenario === "no-notes") {
      h.git("rm", `${packagePath}/.changeset/fix.md`);
      h.git("commit", "-m", "No notes");
    }
    if (scenario === "wrong-origin") {
      h.git("remote", "set-url", "origin", "git@github.com:other/repo.git");
    }
    if (scenario === "edited-at-prompt") {
      h.options.confirm = async () => {
        writeFileSync(resolve(h.cwd, "CHANGELOG.md"), "Changed after review");
        return true;
      };
    }
    await assert.rejects(release(h.options), (error) => {
      if (scenario === "npm-missing") {
        assert.match(errors(error), /trusted-publisher configuration/);
      }
      return true;
    });
    assert.deepEqual(mutations(h.calls), []);
  });
}

for (const [failure, stage] of [
  ["pnpm run", "prepare-release"],
  ["git push origin refs/tags/", "push tag"],
  ["gh workflow run", "dispatch xterm-fork-release.yml"],
]) {
  test(`stops at ${stage} with recovery advice and no later calls`, async (t) => {
    const h = harness(t, { failure });
    await assert.rejects(release(h.options), (error) => {
      assert.match(
        errors(error),
        new RegExp(`Release stopped at ${stage.replaceAll(".", "\\.")}`),
      );
      assert.match(errors(error), /CONTRIBUTING.md recovery/);
      return true;
    });
    assert.ok(h.calls.at(-1)!.startsWith(failure));
  });
}
for (const scenario of ["emptyRuns", "ambiguous", "staleRun"] as const) {
  test(`never watches an unrelated or ambiguous run: ${scenario}`, async (t) => {
    const h = harness(t, { [scenario]: true });
    await assert.rejects(release(h.options), /locate dispatched run/);
    assert.ok(!h.calls.some((call) => call.startsWith("gh run watch")));
    assert.equal(
      h.calls.filter((call) => call.startsWith("gh workflow run")).length,
      1,
    );
  });
}
test("CLI refuses piped input before preparation", (t) => {
  const { cwd, git } = fixture(t);
  const result = spawnSync(process.execPath, ["scripts/release.mts"], {
    cwd,
    encoding: "utf8",
    input: "yes\n",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires an interactive terminal/);
  assert.equal(git("status", "--porcelain"), "");
});
