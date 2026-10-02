import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, test as testCases, vi } from "vitest";

import { createServerLogger, getServerLogFile } from "./server-logger";
import type { LogLevel } from "../../public/index";

const thresholds = [
  {
    logLevel: "debug",
    expected: ["debug", "info", "warn", "error", "server-start"],
  },
  { logLevel: "info", expected: ["info", "warn", "error", "server-start"] },
  { logLevel: "warn", expected: ["warn", "error"] },
  { logLevel: "error", expected: ["error"] },
] satisfies { logLevel: LogLevel; expected: string[] }[];

describe("server logger", () => {
  it("uses the XDG state directory with a home fallback", () => {
    expect(
      getServerLogFile({ homeDir: "/home/test", xdgStateHome: "/state" }),
    ).toBe("/state/overmux/overmux.log");
    expect(
      getServerLogFile({ homeDir: "/home/test", xdgStateHome: "relative" }),
    ).toBe("/home/test/.local/state/overmux/overmux.log");
  });

  testCases.each(thresholds)(
    "writes only $logLevel and above to JSONL and stderr",
    async ({ logLevel, expected }) => {
      await mkdir(".test-tmp", { recursive: true });
      const directory = await mkdtemp(".test-tmp/server-logger-");
      const logFile = join(directory, "state", "overmux.log");
      const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      try {
        const logger = createServerLogger({ logLevel, logFile });
        for (const level of ["debug", "info", "warn", "error"] as const) {
          logger.log({
            event: level,
            level,
            correlationId: "request-1",
            durationMs: 12,
          });
        }
        logger.log({ event: "server-start", level: undefined });

        const records = (await readFile(logFile, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        expect(records.map(({ event }) => event)).toEqual(expected);
        expect(records.find(({ event }) => event === "error")).toMatchObject({
          correlationId: "request-1",
          durationMs: 12,
          level: "error",
          source: "server",
        });
        if (expected.includes("server-start")) {
          expect(records.at(-1)).toMatchObject({
            event: "server-start",
            level: "info",
          });
        }
        expect(stderr.mock.calls.map(([line]) => line)).toEqual(
          records.map((record) => `[overmux] ${JSON.stringify(record)}\n`),
        );
      } finally {
        stderr.mockRestore();
        await rm(directory, { force: true, recursive: true });
      }
    },
  );
});
