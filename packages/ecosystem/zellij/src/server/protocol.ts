// Validates one connection's NDJSON stream before any snapshot reaches backend state.
// Connection IDs and exact wire sequences reject stale, duplicated, or reordered plugin output.
// Protocol failures are typed so installation and permission remedies remain actionable.

import {
  parsePluginMessage,
  ZELLIJ_PROTOCOL_VERSION,
  type PluginMessage,
} from "../shared/plugin-protocol";
import {
  ZellijMalformedOutputError,
  ZellijPermissionError,
  ZellijPipeExitedError,
  ZellijProtocolMismatchError,
  ZellijStartupTimeoutError,
} from "../install/errors";

export const pluginMessageError = (line: string, connectionId: string) => {
  try {
    const value = JSON.parse(line) as {
      connectionId?: unknown;
      protocolVersion?: unknown;
    };
    if (value.protocolVersion !== ZELLIJ_PROTOCOL_VERSION) {
      return new ZellijProtocolMismatchError(
        `Zellij plugin protocol ${String(value.protocolVersion)} is incompatible with runtime protocol ${ZELLIJ_PROTOCOL_VERSION}.`,
      );
    }
    if (value.connectionId !== connectionId) {
      return new ZellijProtocolMismatchError(
        `Zellij plugin output belongs to connection ${String(value.connectionId)}, not ${connectionId}.`,
      );
    }
  } catch {}
  return new ZellijMalformedOutputError(
    `The Zellij plugin emitted malformed output: ${line}`,
  );
};

export const parseConnectionPluginMessage = (
  line: string,
  connectionId: string,
) => {
  let message: PluginMessage;
  try {
    message = parsePluginMessage(line);
  } catch {
    throw pluginMessageError(line, connectionId);
  }
  if (message.connectionId !== connectionId) {
    throw pluginMessageError(JSON.stringify(message), connectionId);
  }
  return message;
};

export const pluginFatalError = (
  message: Extract<PluginMessage, { type: "fatal" }>,
) => {
  if (message.code === "permission_denied") {
    return new ZellijPermissionError(
      `Zellij did not grant ReadApplicationState and ReadCliPipes: ${message.message}`,
    );
  }
  if (message.code === "protocol_mismatch") {
    return new ZellijProtocolMismatchError(message.message);
  }
  if (message.code === "initialization_timeout") {
    return new ZellijStartupTimeoutError(message.message);
  }
  return new ZellijPipeExitedError(
    `Zellij plugin failed (${message.code}): ${message.message}`,
  );
};

export type RuntimeProtocolEvent =
  | Extract<PluginMessage, { type: "hello" | "snapshot" | "bye" }>
  | { error: Error; type: "error" };

export const createRuntimeProtocolDecoder = (connectionId: string) => {
  let helloReceived = false;
  let lastSequence = 0;
  let byeReceived = false;

  const accept = (line: string): RuntimeProtocolEvent => {
    let message: PluginMessage;
    try {
      message = parseConnectionPluginMessage(line, connectionId);
    } catch (error) {
      return { error: error as Error, type: "error" };
    }
    if (byeReceived) {
      return {
        error: new ZellijMalformedOutputError(
          "The Zellij plugin emitted output after bye.",
        ),
        type: "error",
      };
    }
    if (message.type === "fatal") {
      return { error: pluginFatalError(message), type: "error" };
    }
    if (message.type === "hello") {
      if (helloReceived || lastSequence > 0) {
        return {
          error: new ZellijMalformedOutputError(
            "The Zellij plugin emitted hello out of sequence.",
          ),
          type: "error",
        };
      }
      helloReceived = true;
      return message;
    }
    if (message.type === "snapshot") {
      if (!helloReceived || message.sequence !== lastSequence + 1) {
        return {
          error: new ZellijMalformedOutputError(
            `The Zellij plugin emitted snapshot sequence ${message.sequence}; expected ${lastSequence + 1} after hello.`,
          ),
          type: "error",
        };
      }
      lastSequence = message.sequence;
      return message;
    }
    if (message.type === "bye") {
      if (!helloReceived) {
        return {
          error: new ZellijMalformedOutputError(
            "The Zellij plugin emitted bye before hello.",
          ),
          type: "error",
        };
      }
      byeReceived = true;
      return message;
    }
    return {
      error: new ZellijMalformedOutputError(
        `Unexpected ${message.type} message during runtime.`,
      ),
      type: "error",
    };
  };

  return { accept };
};
