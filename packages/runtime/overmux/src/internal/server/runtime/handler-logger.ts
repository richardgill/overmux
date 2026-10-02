import { randomUUID } from "node:crypto";

import type { HandlerLogger, LogLevel } from "../../../public/index";
import type { ServerLogger } from "../server-logger";

// Transport-owned IDs connect handler events to existing request/session logs.
export type HandlerLogCorrelation = {
  correlationId?: string;
  connectionId?: string;
  subscriptionId?: string;
  streamId?: string;
};

type HandlerLogIdentity = {
  capabilityKind: "resource" | "stream" | "operation";
  registeredName: string;
  handler: "read" | "subscribe" | "open" | "handle";
};

export const createHandlerLogger = ({
  serverLogger,
  correlation = {},
  ...identity
}: HandlerLogIdentity & {
  serverLogger?: ServerLogger;
  correlation?: HandlerLogCorrelation;
}): HandlerLogger => {
  const { correlationId = randomUUID(), ...session } = correlation;
  // The captured identity outlives cancellation so message and cleanup closures
  // can still log. Caller details are nested, never merged into runtime metadata.
  const log = (
    level: LogLevel,
    event: string,
    data?: Record<string, unknown>,
  ): void => {
    try {
      serverLogger?.log({
        correlationId,
        details: { ...identity, ...session, data },
        event,
        level,
      });
    } catch {
      // Best effort only: sink failures must never interrupt handlers or cleanup.
      // Do not recursively report failures or include potentially sensitive data.
    }
  };
  return {
    debug: (event, details) => log("debug", event, details),
    info: (event, details) => log("info", event, details),
    warn: (event, details) => log("warn", event, details),
    error: (event, details) => log("error", event, details),
  };
};
