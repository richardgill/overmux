import {
  createTerminalStreamClient,
  type TerminalInput,
  type TerminalSink,
  type TerminalSize,
  type TerminalStreamClient,
  type TerminalStreamConnection,
  type TerminalStreamConnectionState,
  type TerminalStreamConnectionStatus,
} from "@overmux/terminal-stream/client";

export type ZellijTerminalSink = TerminalSink;
export type ZellijTerminalConnection = TerminalStreamConnection;
export type ZellijTerminalConnectionState = TerminalStreamConnectionState;
export type ZellijTerminalConnectionStatus = TerminalStreamConnectionStatus;
export type ZellijTerminalInput = TerminalInput;
export type ZellijTerminalSize = TerminalSize;
export type ZellijTerminalClient = TerminalStreamClient;
export type ZellijTerminalClientOptions = {
  connection: ZellijTerminalConnection;
  onConnectionStatusChange?: (status: ZellijTerminalConnectionStatus) => void;
  onError?: (error: Error) => void;
  sink: ZellijTerminalSink;
};

export const createZellijTerminalClient = (
  options: ZellijTerminalClientOptions,
): ZellijTerminalClient => createTerminalStreamClient(options);
