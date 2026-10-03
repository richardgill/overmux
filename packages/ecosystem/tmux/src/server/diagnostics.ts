import type { HandlerLogger } from "overmux";

import type { TmuxBackend } from "./backend";

export const logTmuxDiagnostic = (
  logger: HandlerLogger | undefined,
  level: "debug" | "warn" | "error",
  event: string,
  details: Record<string, unknown>,
) => {
  try {
    logger?.[level](event, details);
  } catch {
    // Diagnostics must not affect command parsing, settlement, or cleanup, even with a custom sink.
  }
};

export const tmuxErrorContext = (cause: unknown) => {
  try {
    // Error messages can contain command arguments, output, or environment values. Retain only
    // bounded original stack frames, not the message (including multiline message continuations).
    if (!(cause instanceof Error)) {
      return {};
    }
    const header = cause.message
      ? `${cause.name}: ${cause.message}`
      : cause.name;
    const stack = cause.stack;
    if (typeof stack !== "string" || !stack.startsWith(header)) {
      return {};
    }
    return {
      stack: stack
        .slice(header.length, header.length + 4_096)
        .split("\n")
        .filter((line) => /^\s+at /.test(line))
        .slice(0, 12)
        .map((line) => line.slice(0, 240))
        .join("\n"),
    };
  } catch {
    return {};
  }
};

export const observeTmuxDiagnostics = (
  backend: TmuxBackend,
  logger: HandlerLogger | undefined,
  signal: AbortSignal,
) => {
  if (!logger || signal.aborted) {
    return () => undefined;
  }
  let stop = backend.observeDiagnostics?.(logger);
  const release = () => {
    stop?.();
    stop = undefined;
    signal.removeEventListener("abort", release);
  };
  signal.addEventListener("abort", release, { once: true });
  return release;
};
