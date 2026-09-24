import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, test as testCases } from "vitest";

import * as tmuxClient from "../client";
import * as tmuxServer from "./index";
import * as tmuxShared from "../shared";

const packageDirectory = resolve(import.meta.dirname, "../..");

describe("tmux public API", () => {
  testCases(
    "publishes focused client, server, shared, and React entry points",
    async () => {
      const packageJson = JSON.parse(
        await readFile(resolve(packageDirectory, "package.json"), "utf8"),
      ) as { exports: Record<string, unknown> };

      expect(Object.keys(packageJson.exports)).toEqual([
        "./client",
        "./react",
        "./shared",
        "./server",
      ]);
    },
  );

  testCases("exports the server composition surface", () => {
    expect(Object.keys(tmuxServer).sort()).toEqual([
      "createTmuxControlClient",
      "createTmuxControlParser",
      "decodeTmuxEscapes",
      "defineTmuxControlBackend",
      "serializeTmuxCommand",
      "tmuxOperationResultSchema",
      "tmuxOperations",
      "tmuxResource",
      "tmuxSocketArguments",
      "tmuxStateSchema",
      "tmuxStream",
    ]);
  });

  testCases("exports the renderer-neutral browser client", () => {
    expect(Object.keys(tmuxClient).sort()).toEqual([
      "createTmuxTerminalClient",
    ]);
  });

  testCases("exports browser-safe contracts", () => {
    expect(Object.keys(tmuxShared).sort()).toEqual([
      "tmuxOperationResultSchema",
      "tmuxStateSchema",
      "tmuxTerminalClientMessageSchema",
      "tmuxTerminalLocationSchema",
      "tmuxTerminalOpenInputSchema",
      "tmuxTerminalServerMessageSchema",
      "tmuxTerminalTargetSchema",
    ]);
  });
});
