import {
  defineStreamContract,
  defineStreamHandler,
  type StreamHandlerDefinition,
} from "overmux";
import type { PtyFactory } from "@overmux/pty/server";

import {
  zellijTerminalClientMessageSchema,
  zellijTerminalOpenInputSchema,
  zellijTerminalServerMessageSchema,
} from "../../shared/terminal-contracts";
import type { ZellijBackend } from "../backend";
import {
  createZellijTerminalSession,
  defaultZellijTerminalOutputChunkSize,
} from "./session";

export type ZellijTerminalStream = StreamHandlerDefinition<
  typeof zellijTerminalOpenInputSchema,
  typeof zellijTerminalClientMessageSchema,
  typeof zellijTerminalServerMessageSchema
>;
export type ZellijTerminalStreamOptions = {
  allowInput: boolean;
  backend: ZellijBackend;
  outputChunkSize?: number;
  ptyFactory?: PtyFactory;
};

const terminalContract = defineStreamContract({
  clientMessage: zellijTerminalClientMessageSchema,
  input: zellijTerminalOpenInputSchema,
  serverMessage: zellijTerminalServerMessageSchema,
});

export const zellijTerminalStream = ({
  allowInput,
  backend,
  outputChunkSize = defaultZellijTerminalOutputChunkSize,
  ptyFactory,
}: ZellijTerminalStreamOptions): ZellijTerminalStream => {
  if (!Number.isSafeInteger(outputChunkSize) || outputChunkSize < 1) {
    throw new Error(
      "Zellij terminal output chunk size must be a positive integer",
    );
  }
  return defineStreamHandler(
    terminalContract,
    ({ sessionName }, { emit, fail, signal }) =>
      createZellijTerminalSession({
        allowInput,
        backend,
        emit,
        fail,
        outputChunkSize,
        ptyFactory,
        sessionName,
        signal,
      }),
  );
};
