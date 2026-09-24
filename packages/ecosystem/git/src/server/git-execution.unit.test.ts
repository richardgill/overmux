import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

import { GitCommandError, runGit } from "./git-execution";

const root = resolve(".test-tmp/git-execution");

const gitObjectHash = (input: Buffer) =>
  createHash("sha1")
    .update(`blob ${input.byteLength}\0`)
    .update(input)
    .digest("hex");

beforeEach(async () => {
  await rm(root, { force: true, recursive: true });
  await mkdir(root, { recursive: true });
  await runGit(root, ["init"]);
});

afterEach(() => rm(root, { force: true, recursive: true }));

test("returns buffered output and writes stdin", async () => {
  const input = Buffer.from("git input\0");

  const output = await runGit(root, ["hash-object", "--stdin"], { input });

  expect(output.stdout).toBeInstanceOf(Buffer);
  expect(output.stderr).toBeInstanceOf(Buffer);
  expect(output.stdout.toString("utf8").trim()).toBe(gitObjectHash(input));
});

test("allows configured non-zero exit codes", async () => {
  const output = await runGit(root, ["rev-parse", "--verify", "missing"], {
    acceptedExitCodes: [128],
  });

  expect(output.stderr.toString("utf8")).toContain("Needed a single revision");
});

test("reports unacceptable git statuses with buffered stderr", async () => {
  const result = runGit(root, ["rev-parse", "--verify", "missing"]);

  await expect(result).rejects.toMatchObject({
    status: 128,
    stderr: expect.any(Buffer),
  } satisfies Partial<GitCommandError>);
});

test("propagates abort errors", async () => {
  const controller = new AbortController();
  controller.abort();

  await expect(
    runGit(root, ["status"], { signal: controller.signal }),
  ).rejects.toMatchObject({
    name: "AbortError",
  });
});
