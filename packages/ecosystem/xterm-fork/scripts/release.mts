import assert from "node:assert/strict";
import { createInterface } from "node:readline/promises";
import { upstream } from "../upstream.ts";
import { release } from "./release-command.mts";
import { root } from "./shared.mts";

const confirm = async () => {
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return (
      (
        await terminal.question(
          "Commit, push, tag and dispatch public npm release? Type yes: ",
        )
      ).trim() === "yes"
    );
  } finally {
    terminal.close();
  }
};

assert.equal(
  process.argv.length,
  2,
  "Usage: pnpm release (interactive; no --yes)",
);
await release({
  cwd: root,
  upstreamVersion: upstream.tag,
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  confirm,
});
