import { useLayoutEffect, useRef, useState } from "react";

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
  stream: ZellijTerminalConnection;
};
export type UseZellijTerminalResult = {
  // Cleanup detaches this renderer, not the connection. Remount does not restore screen contents.
  attachRenderer: (renderer: ZellijTerminalRenderer) => () => void;
  error: Error | undefined;
  input: (data: ZellijTerminalInput) => void;
  resize: (size: ZellijTerminalSize) => void;
};

type BufferedWrite = {
  bytes: Uint8Array;
  complete: () => void;
  delivered: boolean;
};

// Like tmux's bridge, retains pending output, not a replayable terminal screen.
// Zellij has no redraw primitive here: keep the renderer mounted for visual continuity.
const createRendererBridge = () => {
  let renderer: ZellijTerminalRenderer | undefined;
  const writes = new Set<BufferedWrite>();
  const complete = (write: BufferedWrite) => {
    if (writes.has(write)) {
      // Remove before completion, which can synchronously deliver more output.
      writes.delete(write);
      write.complete();
    }
  };
  const deliver = (write: BufferedWrite) => {
    if (renderer && writes.has(write) && !write.delivered) {
      write.delivered = true;
      renderer.write(write.bytes, () => complete(write));
    }
  };
  const clear = () => writes.clear();
  return {
    clear,
    fit: () => renderer?.fit(),
    hasRenderer: () => Boolean(renderer),
    attach: (next: ZellijTerminalRenderer) => {
      if (renderer) {
        throw new Error("A Zellij terminal can have only one renderer");
      }
      renderer = next;
      next.reset();
      Array.from(writes).forEach(deliver);
      let detached = false;
      return () => {
        if (detached) {
          return;
        }
        detached = true;
        renderer = undefined;
        // A destroyed renderer may never complete its writes. Release delivered writes
        // once to avoid deadlock, without claiming the user saw them. Undelivered writes
        // remain buffered; callbacks from the destroyed renderer become harmless.
        Array.from(writes)
          .filter((write) => write.delivered)
          .forEach(complete);
      };
    },
    sink: {
      reset: () => {
        // The output processor invalidated the previous generation before resetting us.
        clear();
        renderer?.reset();
      },
      write: (bytes: Uint8Array, onProcessed: () => void) => {
        const write = { bytes, complete: onProcessed, delivered: false };
        writes.add(write);
        // Buffering is not processing. Withheld callbacks cap bridge delivery at 11
        // writes; shared server byte watermarks pause the PTY, bounding queued output.
        deliver(write);
      },
    },
  };
};

type Notifications = {
  error: (error: Error | undefined) => void;
  status: (status: ZellijTerminalConnectionStatus) => void;
};
const sameTransport = (
  left: ZellijTerminalConnection,
  right: ZellijTerminalConnection,
) =>
  left.close === right.close &&
  left.send === right.send &&
  left.subscribe === right.subscribe;

const createTerminalController = (notify: Notifications) => {
  const bridge = createRendererBridge();
  let client: ZellijTerminalClient | undefined;
  let connection: ZellijTerminalConnection | undefined;
  let cleanupVersion = 0;
  let latestSize: ZellijTerminalSize | undefined;
  const fitRenderer = () => {
    if (bridge.hasRenderer() && connection?.status === "open") {
      client?.fitAndReportSize(bridge.fit);
    }
  };
  const attachRenderer = (renderer: ZellijTerminalRenderer) => {
    const detach = bridge.attach(renderer);
    fitRenderer();
    return detach;
  };
  const resize = (size: ZellijTerminalSize) => {
    latestSize = size;
    client?.resize(size);
  };
  const dispose = () => {
    client?.dispose();
    client = undefined;
    bridge.clear();
  };
  const connect = (stream: ZellijTerminalConnection) => {
    cleanupVersion += 1;
    if (connection && !sameTransport(connection, stream)) {
      dispose();
      notify.error(undefined);
    }
    connection = stream;
    if (!client) {
      client = createZellijTerminalClient({
        connection: stream,
        sink: bridge.sink,
        onError: notify.error,
        onConnectionStatusChange: (status) => {
          if (status === "closed") {
            bridge.clear();
          }
          notify.status(status);
        },
      });
      if (latestSize && bridge.hasRenderer()) {
        client.resize(latestSize);
      }
      fitRenderer();
    }
    return () => {
      const scheduledVersion = ++cleanupVersion;
      // StrictMode replays setup immediately. Defer irreversible transport closure
      // one microtask; replacement disposes synchronously and real unmount still closes.
      queueMicrotask(() => {
        if (cleanupVersion === scheduledVersion) {
          dispose();
        }
      });
    };
  };
  const updateConnection = (stream: ZellijTerminalConnection) => {
    const opened = connection?.status !== "open" && stream.status === "open";
    connection = stream;
    if (!stream.error && stream.status !== "closed") {
      notify.error(undefined);
    }
    client?.updateConnection(stream);
    if (opened) {
      fitRenderer();
    }
  };
  return {
    attachRenderer,
    connect,
    input: (data: ZellijTerminalInput) => client?.input(data),
    resize,
    updateConnection,
  };
};

export const useZellijTerminal = ({
  onConnectionStatusChange,
  onError,
  stream,
}: UseZellijTerminalOptions): UseZellijTerminalResult => {
  const [error, setError] = useState<Error>();
  const callbacksRef = useRef({ onConnectionStatusChange, onError });
  callbacksRef.current = { onConnectionStatusChange, onError };
  const [terminal] = useState(() =>
    createTerminalController({
      error: (next) => {
        setError(next);
        if (next) {
          callbacksRef.current.onError?.(next);
        }
      },
      status: (status) =>
        callbacksRef.current.onConnectionStatusChange?.(status),
    }),
  );
  useLayoutEffect(
    () => terminal.connect(stream),
    [terminal, stream.close, stream.send, stream.subscribe],
  );
  useLayoutEffect(
    () => terminal.updateConnection(stream),
    [
      terminal,
      stream.close,
      stream.send,
      stream.subscribe,
      stream.error,
      stream.status,
    ],
  );
  return {
    attachRenderer: terminal.attachRenderer,
    error,
    input: terminal.input,
    resize: terminal.resize,
  };
};
