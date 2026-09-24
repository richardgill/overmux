// stream.ts is the thin public entry point from Overmux to tmux:
//
// - A stream is a long-lived browser-server connection. Its contract validates
//   the opening input plus all messages in both directions. Each opened connection
//   creates one terminal attachment through createTmuxTerminalSession.
// - A PTY is a server-side pseudo-terminal - it lets tmux behave as though a real
//   terminal were attached. A navigation request attaches it to a tmux session (workspace).
//   Until renderer geometry arrives, the PTY's default size is excluded from shared sizing.
// - allowInput permits browser keystrokes or drops them.
// - geometryPolicy controls resizing: "shared" participates in tmux's normal
//   shared-window resizing, while "ignore-size" leaves shared geometry unaffected.
// - outputChunkSize sets the positive byte chunk size, with a default when omitted.
// - session.ts applies acknowledgements and cleanup when the connection ends.
//
// tmuxStream(options): TmuxTerminalStream
//   Creates the reusable validated handler; each open delegates to session.ts.
//   TmuxTerminalStreamOptions configures input, backend, size policy, and chunks.
import {
  defineStreamContract,
  defineStreamHandler,
  type StreamHandlerDefinition,
} from "overmux";
import type { PtyFactory } from "@overmux/pty/server";

import type { TmuxBackend } from "../backend";
import {
  tmuxTerminalClientMessageSchema,
  tmuxTerminalOpenInputSchema,
  tmuxTerminalServerMessageSchema,
} from "../../shared/terminal-contracts";
import {
  createTmuxTerminalSession,
  defaultTmuxTerminalOutputChunkSize,
  type TmuxGeometryPolicy,
} from "./session";

export type TmuxTerminalStream = StreamHandlerDefinition<
  typeof tmuxTerminalOpenInputSchema,
  typeof tmuxTerminalClientMessageSchema,
  typeof tmuxTerminalServerMessageSchema
>;

export type TmuxTerminalStreamOptions = {
  allowInput?: boolean;
  backend: TmuxBackend;
  geometryPolicy?: TmuxGeometryPolicy;
  outputChunkSize?: number;
  ptyFactory?: PtyFactory;
};

const resolveOutputChunkSize = (configuredSize: number | undefined) => {
  const outputChunkSize = configuredSize ?? defaultTmuxTerminalOutputChunkSize;
  if (!Number.isSafeInteger(outputChunkSize) || outputChunkSize < 1) {
    throw new Error(
      "Tmux terminal output chunk size must be a positive integer",
    );
  }
  return outputChunkSize;
};

const tmuxTerminalContract = defineStreamContract({
  clientMessage: tmuxTerminalClientMessageSchema,
  input: tmuxTerminalOpenInputSchema,
  serverMessage: tmuxTerminalServerMessageSchema,
});

export const tmuxStream = ({
  allowInput = true,
  backend,
  geometryPolicy = "shared",
  outputChunkSize: configuredOutputChunkSize,
  ptyFactory,
}: TmuxTerminalStreamOptions): TmuxTerminalStream => {
  const outputChunkSize = resolveOutputChunkSize(configuredOutputChunkSize);
  return defineStreamHandler(
    tmuxTerminalContract,
    (_input, { emit, fail, signal }) =>
      createTmuxTerminalSession({
        allowInput,
        backend,
        emit,
        fail,
        geometryPolicy,
        outputChunkSize,
        ptyFactory,
        signal,
      }),
  );
};

export type { TmuxGeometryPolicy } from "./session";
