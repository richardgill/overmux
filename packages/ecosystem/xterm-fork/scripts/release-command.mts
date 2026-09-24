import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import {
  nextVersion,
  packageName,
  validateVersionBase,
} from "./versioning.mts";

const repository = "richardgill/overmux";
const workflow = "xterm-fork-release.yml";
const remote = "origin";
type Exec = (
  command: string,
  args: string[],
  cwd: string,
  inherit?: boolean,
) => string;
type Options = {
  cwd: string;
  upstreamVersion: string;
  interactive: boolean;
  confirm: () => Promise<boolean>;
  exec?: Exec;
  log?: (message: string) => void;
  pause?: () => Promise<unknown>;
};
type Context = Required<Options> & { repositoryRoot: string };
type ReleaseSource = { branch: string; version: string; directory: string };
type Plan = {
  branch: string;
  head: string;
  version: string;
  tag: string;
  paths: string[];
  message: string;
};
type Run = {
  databaseId: number;
  headSha: string;
  headBranch: string;
  event: string;
};

const execute: Exec = (command, args, cwd, inherit) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  }) ?? "";
const git = (ctx: Context, ...args: string[]) =>
  ctx.exec("git", args, ctx.repositoryRoot).trim();
const gh = (ctx: Context, ...args: string[]) =>
  ctx.exec("gh", args, ctx.cwd).trim();
const manifest = (ctx: Context) =>
  JSON.parse(readFileSync(resolve(ctx.cwd, "package.json"), "utf8"));
const assertTagAvailable = (ctx: Context, tag: string) => {
  assert.equal(
    git(ctx, "tag", "--list", tag),
    "",
    `Local tag ${tag} already exists; inspect it, do not replace it.`,
  );
  assert.equal(
    git(
      ctx,
      "ls-remote",
      "--tags",
      remote,
      `refs/tags/${tag}`,
      `refs/tags/${tag}^{}`,
    ),
    "",
    `Remote tag ${tag} already exists; inspect it, do not replace it.`,
  );
};

const validateReleaseRepository = (ctx: Context): ReleaseSource => {
  assert.ok(
    ctx.interactive,
    "pnpm release requires an interactive terminal; no CI or piped approval.",
  );
  assert.equal(
    git(ctx, "status", "--porcelain"),
    "",
    "Working tree must be clean. Commit your changes and release notes first.",
  );
  const branch = git(ctx, "branch", "--show-current");
  assert.ok(branch, "Detached HEAD: check out the release branch first.");
  const pkg = manifest(ctx);
  assert.equal(pkg.name, packageName);
  assert.equal(pkg.private, true, "Recipe root must remain private");
  assert.equal(pkg.repository?.url, `git+https://github.com/${repository}.git`);
  assert.equal(
    relative(ctx.repositoryRoot, ctx.cwd),
    pkg.repository?.directory,
    "Run release from the nested fork recipe",
  );
  const allowed = [
    `https://github.com/${repository}.git`,
    `git@github.com:${repository}.git`,
    `ssh://git@github.com/${repository}.git`,
  ];
  for (const args of [
    ["remote", "get-url", "--all", remote],
    ["remote", "get-url", "--push", "--all", remote],
  ]) {
    assert.ok(
      allowed.includes(git(ctx, ...args)),
      "origin must have one fetch/push URL pointing to the canonical recipe repository.",
    );
  }
  const repo = JSON.parse(
    gh(ctx, "repo", "view", repository, "--json", "nameWithOwner"),
  );
  assert.equal(repo.nameWithOwner, repository);
  return { branch, version: pkg.version, directory: pkg.repository.directory };
};

const assertRegistryVersionAvailable = (ctx: Context, version: string) => {
  let versions: string | string[];
  try {
    versions = JSON.parse(
      ctx.exec(
        "npm",
        [
          "view",
          packageName,
          "versions",
          "--json",
          "--registry=https://registry.npmjs.org",
        ],
        ctx.cwd,
      ),
    );
  } catch (error) {
    throw new Error(
      "Cannot read the public npm package. Check npm connectivity/access and trusted-publisher configuration in CONTRIBUTING.md. Nothing will be published locally.",
      { cause: error },
    );
  }
  assert.ok(
    Array.isArray(versions)
      ? versions.length
      : typeof versions === "string" && versions.length,
    "npm package has no published baseline; see CONTRIBUTING.md.",
  );
  assert.ok(
    ![versions].flat().includes(version),
    `${packageName}@${version} is already published; do not reuse it.`,
  );
};

const planRelease = (ctx: Context, source: ReleaseSource): Plan => {
  const notes = readdirSync(resolve(ctx.cwd, ".changeset"))
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort();
  assert.ok(
    notes.length,
    "No pending release notes. Add and commit a pnpm changeset first.",
  );
  const version = nextVersion(source.version, ctx.upstreamVersion);
  const tag = `xterm-fork-v${version}`;
  assertTagAvailable(ctx, tag);
  assertRegistryVersionAvailable(ctx, version);
  return {
    branch: source.branch,
    head: git(ctx, "rev-parse", "HEAD"),
    version,
    tag,
    paths: [
      "package.json",
      "CHANGELOG.md",
      ...notes.map((name) => `.changeset/${name}`),
    ].map((path) => `${source.directory}/${path}`),
    message: `Release xterm fork ${version}`,
  };
};

const preparedDiff = (ctx: Context, plan: Plan) => {
  assert.equal(
    git(ctx, "rev-parse", "HEAD"),
    plan.head,
    "HEAD changed during release preparation.",
  );
  assert.equal(
    git(ctx, "symbolic-ref", "--quiet", "--short", "HEAD"),
    plan.branch,
    "Branch changed during release preparation.",
  );
  assert.equal(
    git(ctx, "diff", "--cached", "--name-only"),
    "",
    "Index changed during release preparation.",
  );
  assert.equal(
    git(ctx, "ls-files", "--others", "--exclude-standard"),
    "",
    "Untracked files appeared during release preparation.",
  );
  const changed = git(ctx, "diff", "--name-only", "-z")
    .split("\0")
    .filter(Boolean)
    .sort();
  assert.deepEqual(
    changed,
    [...plan.paths].sort(),
    "Preparation must change only the manifest, changelog and consumed notes.",
  );
  assert.equal(
    manifest(ctx).version,
    plan.version,
    "Preparation did not produce the planned version.",
  );
  validateVersionBase(manifest(ctx).version, ctx.upstreamVersion);
  return git(
    ctx,
    "--no-pager",
    "diff",
    "--no-ext-diff",
    "--no-color",
    "--",
    ...plan.paths,
  );
};

const releaseRuns = (ctx: Context, plan: Plan, sha: string): Run[] =>
  JSON.parse(
    gh(
      ctx,
      "run",
      "list",
      "--repo",
      repository,
      "--workflow",
      workflow,
      "--branch",
      plan.tag,
      "--commit",
      sha,
      "--event",
      "workflow_dispatch",
      "--limit",
      "100",
      "--json",
      "databaseId,headSha,headBranch,event",
    ),
  );

const findDispatchedRun = async (
  ctx: Context,
  plan: Plan,
  sha: string,
  previous: Run[],
) => {
  for (let attempt = 0; attempt < 12; attempt++) {
    const matches = releaseRuns(ctx, plan, sha).filter(
      (run) =>
        run.headSha === sha &&
        run.headBranch === plan.tag &&
        run.event === "workflow_dispatch" &&
        !previous.some((old) => old.databaseId === run.databaseId),
    );
    assert.ok(
      matches.length <= 1,
      "Multiple matching dispatches appeared; inspect GitHub Actions instead of guessing which run to watch.",
    );
    if (matches.length === 1) {
      return matches[0].databaseId;
    }
    await ctx.pause();
  }
  throw new Error(
    "Dispatched run did not appear within one minute. Inspect GitHub Actions before dispatching again.",
  );
};

export const release = async (options: Options) => {
  const exec = options.exec ?? execute;
  const repositoryRoot = exec(
    "git",
    ["rev-parse", "--show-toplevel"],
    options.cwd,
  ).trim();
  const ctx: Context = {
    exec,
    log: console.log,
    pause: () => setTimeout(5000),
    ...options,
    repositoryRoot,
  };
  let stage =
    "preflight (check terminal, clean branch, origin, tags, published baseline and gh authentication)";
  let recovery = "Fix the prerequisite and run pnpm release again.";
  try {
    const source = validateReleaseRepository(ctx);
    const plan = planRelease(ctx, source);
    stage = "prepare-release";
    recovery =
      "Prepared edits may remain. Inspect git status/diff; do not reset or rerun preparation blindly. See CONTRIBUTING.md recovery.";
    ctx.exec("pnpm", ["run", "prepare-release"], ctx.cwd, true);
    const diff = preparedDiff(ctx, plan);
    ctx.log(
      `\nPackage: ${packageName}@${plan.version}\nCommit: ${plan.message}\nBranch: ${plan.branch}\nTag: ${plan.tag}\nRemote: ${remote} (${repository})\n\n${diff}\n\nGitHub builds/tests, then publishes publicly to npm (latest). Trusted publisher setup must already be complete; it cannot be verified locally.`,
    );
    stage = "confirmation";
    if (!(await ctx.confirm())) {
      ctx.log(
        "Cancelled. Prepared version/changelog and removed notes remain for review; no commit, push, tag or dispatch was performed. See CONTRIBUTING.md recovery.",
      );
      return;
    }
    stage = "revalidate approval";
    assert.equal(
      preparedDiff(ctx, plan),
      diff,
      "Prepared diff changed after review; refusing to commit.",
    );
    assertTagAvailable(ctx, plan.tag);
    stage = "commit";
    git(ctx, "commit", "--only", "-m", plan.message, "--", ...plan.paths);
    const sha = git(ctx, "rev-parse", "HEAD");
    recovery = `Release commit may exist locally/remotely. Inspect status and history; resume only missing steps for ${plan.tag}. Never recreate an existing tag or reuse a published version. See CONTRIBUTING.md recovery.`;
    stage = "push branch";
    git(ctx, "push", remote, `HEAD:refs/heads/${plan.branch}`);
    stage = "create tag";
    git(ctx, "tag", plan.tag, sha);
    stage = "push tag";
    git(ctx, "push", remote, `refs/tags/${plan.tag}:refs/tags/${plan.tag}`);
    stage = "dispatch xterm-fork-release.yml";
    const previous = releaseRuns(ctx, plan, sha);
    recovery = `Tag ${plan.tag} is pushed; the workflow may already be publishing. Inspect GitHub Actions before any redispatch. See CONTRIBUTING.md recovery.`;
    gh(
      ctx,
      "workflow",
      "run",
      workflow,
      "--repo",
      repository,
      "--ref",
      plan.tag,
    );
    stage = "locate dispatched run";
    const runId = await findDispatchedRun(ctx, plan, sha, previous);
    ctx.log(`Watching https://github.com/${repository}/actions/runs/${runId}`);
    stage = `watch run ${runId}`;
    recovery = `Inspect gh run view ${runId} --repo ${repository} --log-failed and npm before retrying. Resume watching with gh run watch ${runId} --repo ${repository} --exit-status. See CONTRIBUTING.md recovery.`;
    ctx.exec(
      "gh",
      ["run", "watch", String(runId), "--repo", repository, "--exit-status"],
      ctx.cwd,
      true,
    );
  } catch (error) {
    throw new Error(`Release stopped at ${stage}. ${recovery}`, {
      cause: error,
    });
  }
};
