import { useCallback, useEffect, useRef } from "react";

import {
  createZellijTerminalClient,
  type ZellijTerminalClient,
  type ZellijTerminalConnection,
  type ZellijTerminalConnectionStatus,
  type ZellijTerminalInput,
  type ZellijTerminalSink,
  type ZellijTerminalSize,
} from "../client/terminal-client";

export type ZellijTerminalRenderer = ZellijTerminalSink & { fit: () => void };
export type UseZellijTerminalOptions = {
  onConnectionStatusChange?: (status: ZellijTerminalConnectionStatus) => void;
  onError?: (error: Error) => void;
  renderer: ZellijTerminalRenderer;
  stream: ZellijTerminalConnection;
};
export type UseZellijTerminalResult = {
  input: (data: ZellijTerminalInput) => void;
  resize: (size: ZellijTerminalSize) => void;
};

export const useZellijTerminal = ({
  onConnectionStatusChange,
  onError,
  renderer,
  stream,
}: UseZellijTerminalOptions): UseZellijTerminalResult => {
  const clientRef = useRef<ZellijTerminalClient | undefined>(undefined);
  const callbacksRef = useRef({ onConnectionStatusChange, onError });
  callbacksRef.current = { onConnectionStatusChange, onError };

  useEffect(() => {
    const client = createZellijTerminalClient({
      connection: stream,
      onConnectionStatusChange: (status) =>
        callbacksRef.current.onConnectionStatusChange?.(status),
      onError: (error) => callbacksRef.current.onError?.(error),
      sink: renderer,
    });
    clientRef.current = client;
    return () => {
      client.dispose();
      if (clientRef.current === client) {
        clientRef.current = undefined;
      }
    };
  }, [
    renderer.reset,
    renderer.write,
    stream.close,
    stream.send,
    stream.subscribe,
  ]);

  useEffect(() => {
    const client = clientRef.current;
    client?.updateConnection(stream);
    if (stream.status === "open") {
      client?.fitAndReportSize(renderer.fit);
    }
  }, [renderer.fit, stream.error, stream.status]);

  const input = useCallback(
    (data: ZellijTerminalInput) => clientRef.current?.input(data),
    [],
  );
  const resize = useCallback(
    (size: ZellijTerminalSize) => clientRef.current?.resize(size),
    [],
  );
  return { input, resize };
};
