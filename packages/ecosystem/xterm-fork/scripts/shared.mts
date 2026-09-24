import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const root = resolve(import.meta.dirname, "..");

export type Build = {
  work: string;
  source: string;
  stage: string;
};

export const text = (path: string) => readFileSync(path, "utf8");

export const run = (command: string, args: string[], cwd = root) =>
  execFileSync(command, args, { cwd, stdio: "inherit" });

export const runOutput = (command: string, args: string[], cwd: string) =>
  execFileSync(command, args, { cwd, encoding: "utf8" });
