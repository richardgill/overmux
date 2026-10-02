import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { getOvermuxPaths } from "./paths";

import type { LogLevel } from "../../public/index";

export type ServerLogEntry = {
  // Groups related request, connection, and operation logs for diagnostics.
  correlationId?: string;
  details?: Record<string, unknown>;
  durationMs?: number;
  event: string;
  level?: LogLevel;
  message?: string;
  source?: "browser" | "server";
  timestamp?: string;
};

export type ServerLogger = {
  logLevel: LogLevel;
  id: () => string;
  log: (entry: ServerLogEntry) => void;
};

const severity = { debug: 10, info: 20, warn: 30, error: 40 } satisfies Record<
  LogLevel,
  number
>;

export const getServerLogFile = ({
  homeDir,
  xdgStateHome,
}: {
  homeDir?: string;
  xdgStateHome?: string;
} = {}) =>
  join(getOvermuxPaths({ homeDir, xdgStateHome }).stateDir, "overmux.log");

const safeJson = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      event: "log-serialization-error",
      level: "error",
      source: "server",
      timestamp: new Date().toISOString(),
    });
  }
};

export const createServerLogger = ({
  logLevel,
  logFile,
}: {
  logLevel: LogLevel;
  logFile: string;
}): ServerLogger => {
  return {
    logLevel,
    id: randomUUID,
    log: (entry) => {
      const level = entry.level ?? "info";
      if (severity[level] < severity[logLevel]) {
        return;
      }
      const record = safeJson({
        ...entry,
        timestamp: entry.timestamp ?? new Date().toISOString(),
        level,
        source: entry.source ?? "server",
      });
      mkdirSync(dirname(logFile), { recursive: true });
      appendFileSync(logFile, `${record}\n`, "utf8");
      process.stderr.write(`[overmux] ${record}\n`);
    },
  };
};

export const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

export const errorDetails = (cause: unknown) => ({
  message: errorMessage(cause),
  ...(cause instanceof Error && cause.stack ? { stack: cause.stack } : {}),
});
