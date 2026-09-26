import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import * as zellijClient from "../client";
import * as zellijServer from "./index";
import * as zellijShared from "../shared";

const packageDirectory = resolve(import.meta.dirname, "../..");

describe("Zellij public API", () => {
  it("publishes only explicit environment entry points", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(packageDirectory, "package.json"), "utf8"),
    ) as { exports: Record<string, unknown> };
    expect(Object.keys(packageJson.exports)).toEqual([
      "./client",
      "./react",
      "./install",
      "./shared",
      "./server",
    ]);
  });

  it("exports the approved server composition and browser-safe contracts", () => {
    expect(Object.keys(zellijServer).sort()).toEqual([
      "ZellijArtifactMissingError",
      "ZellijArtifactVerificationError",
      "ZellijMalformedOutputError",
      "ZellijNoSessionError",
      "ZellijPermissionError",
      "ZellijPipeExitedError",
      "ZellijProtocolMismatchError",
      "ZellijReconciliationTimeoutError",
      "ZellijStartupTimeoutError",
      "defineZellijBackend",
      "zellijOperationHandlers",
      "zellijOperationResultSchema",
      "zellijPaneInfoSchema",
      "zellijStateResource",
      "zellijStateSchema",
      "zellijTabInfoSchema",
      "zellijTerminalStream",
    ]);
    expect(Object.keys(zellijClient)).toEqual(["createZellijTerminalClient"]);
    expect(Object.keys(zellijShared).sort()).toEqual([
      "zellijOperationResultSchema",
      "zellijPaneInfoSchema",
      "zellijStateSchema",
      "zellijTabInfoSchema",
      "zellijTerminalClientMessageSchema",
      "zellijTerminalInputLimit",
      "zellijTerminalOpenInputSchema",
      "zellijTerminalServerMessageSchema",
    ]);
  });
});
