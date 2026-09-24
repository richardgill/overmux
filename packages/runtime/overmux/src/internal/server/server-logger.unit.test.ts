import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createServerLogger, getServerLogFile } from "./server-logger";

describe("server logger", () => {
  it("uses the XDG state directory with a home fallback", () => {
    expect(
      getServerLogFile({
        homeDir: "/home/test",
        xdgStateHome: "/state",
      }),
    ).toBe("/state/overmux/overmux.log");
    expect(
      getServerLogFile({
        homeDir: "/home/test",
        xdgStateHome: "relative",
      }),
    ).toBe("/home/test/.local/state/overmux/overmux.log");
  });

  it("writes lifecycle and error logs when debug is disabled", async () => {
    const directory = await mkdtemp(join(tmpdir(), "overmux-no-debug-"));
    const logFile = join(directory, "state", "overmux.log");
    try {
      const serverLogger = createServerLogger({ enabled: false, logFile });
      serverLogger.log({ event: "operation-start" });
      serverLogger.log({ event: "server-start" });
      serverLogger.log({ event: "operation-error", level: "error" });

      const records = (await readFile(logFile, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(records.map((record) => record.event)).toEqual([
        "server-start",
        "operation-error",
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("appends structured entries to a created directory and stderr", async () => {
    const directory = await mkdtemp(join(tmpdir(), "overmux-debug-"));
    const logFile = join(directory, "state", "overmux.log");
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const serverLogger = createServerLogger({ enabled: true, logFile });
      serverLogger.log({
        correlationId: "request-1",
        durationMs: 12,
        event: "operation-complete",
      });

      const record = JSON.parse(await readFile(logFile, "utf8")) as Record<
        string,
        unknown
      >;
      expect(record).toMatchObject({
        correlationId: "request-1",
        durationMs: 12,
        event: "operation-complete",
        level: "info",
        source: "server",
      });
      expect(stderr).toHaveBeenCalledOnce();
    } finally {
      stderr.mockRestore();
      await rm(directory, { force: true, recursive: true });
    }
  });
});
