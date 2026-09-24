import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { getOvermuxPaths } from "./paths";

export type ServerLogLevel = "debug" | "error" | "info" | "warn";

export type ServerLogEntry = {
  // Groups related request, connection, and operation logs for diagnostics.
  correlationId?: string;
  details?: Record<string, unknown>;
  durationMs?: number;
  event: string;
  level?: ServerLogLevel;
  message?: string;
  source?: "browser" | "server";
  timestamp?: string;
};

export type ServerLogger = {
  enabled: boolean;
  id: () => string;
  log: (entry: ServerLogEntry) => void;
};

type ConfigurableServerLogger = ServerLogger & {
  setEnabled: (enabled: boolean) => void;
};

const lifecycleEvents = new Set([
  "server-start",
  "server-stop",
  "websocket-close",
  "websocket-close-event",
  "websocket-connect",
  "websocket-open",
]);

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
  enabled,
  logFile,
}: {
  enabled: boolean;
  logFile: string;
}): ConfigurableServerLogger => {
  let debugEnabled = enabled;
  return {
    get enabled() {
      return debugEnabled;
    },
    id: randomUUID,
    log: (entry) => {
      if (
        !debugEnabled &&
        entry.level !== "error" &&
        !lifecycleEvents.has(entry.event)
      ) {
        return;
      }
      const record = safeJson({
        timestamp: entry.timestamp ?? new Date().toISOString(),
        level: entry.level ?? "info",
        source: entry.source ?? "server",
        ...entry,
      });
      mkdirSync(dirname(logFile), { recursive: true });
      appendFileSync(logFile, `${record}\n`, "utf8");
      process.stderr.write(`[overmux:debug] ${record}\n`);
    },
    setEnabled: (nextEnabled) => {
      debugEnabled = nextEnabled;
    },
  };
};

export const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

export const errorDetails = (cause: unknown) => ({
  message: errorMessage(cause),
  ...(cause instanceof Error && cause.stack ? { stack: cause.stack } : {}),
});
