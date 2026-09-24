import { useLayoutEffect, useRef, useState } from "react";

import {
  createTmuxTerminalClient,
  type TmuxTerminalConnection,
  type TmuxTerminalClient,
  type TmuxTerminalConnectionStatus,
  type TmuxTerminalInput,
  type TmuxTerminalLocation,
  type TmuxTerminalTarget,
  type TmuxTerminalSink,
  type TmuxTerminalSize,
} from "../client/terminal-client";
import { createSessionReattachment } from "./session-reattachment";

// Adds layout fitting to the renderer-neutral terminal output sink.
export type TmuxTerminalRenderer = TmuxTerminalSink & {
  // Fits the terminal dimensions to its container.
  fit: () => void;
};

// Configures the terminal hook's transport and notifications.
// Renderer attachment and navigation are imperative methods on the hook result.
export type UseTmuxTerminalOptions = {
  // Reports each distinct transport status.
  onConnectionStatusChange?: (status: TmuxTerminalConnectionStatus) => void;
  // Reports transport, output-processing, and automatic recovery failures.
  onError?: (error: Error) => void;
  stream: TmuxTerminalConnection;
};

// Exposes user input and renderer resize events to a headless terminal integration.
export type UseTmuxTerminalResult = {
  // Attaches one renderer; cleanup detaches only that attachment, not the connection.
  attachRenderer: (renderer: TmuxTerminalRenderer) => () => void;
  error: Error | undefined;
  // May wait for initial opening. Resolves on confirmation; interruption, navigation
  // failure, supersession or unmount rejects it. Interrupted requests are not replayed.
  goTo: (target: TmuxTerminalTarget) => Promise<TmuxTerminalLocation>;
  // Reports the complete session/window/pane location observed by the attached client.
  location: TmuxTerminalLocation | undefined;
  // Sends terminal input to the server.
  input: (data: TmuxTerminalInput) => void;
  // Records and sends the renderer's latest dimensions.
  resize: (size: TmuxTerminalSize) => void;
};

type BufferedWrite = {
  bytes: Uint8Array;
  // Tells the output processor it can acknowledge this chunk.
  complete: () => void;
  // Handed to a renderer, but not necessarily processed yet.
  delivered: boolean;
};

// Lets the connection outlive the screen: output can arrive before a renderer
// mounts, and the renderer can unmount without closing the connection.
const createRendererBridge = () => {
  let renderer: TmuxTerminalRenderer | undefined;

  // Tracks both waiting writes and writes awaiting the renderer's callback.
  // Set iteration preserves the order in which writes arrived.
  const writes = new Set<BufferedWrite>();

  const complete = (write: BufferedWrite) => {
    // Membership prevents duplicate or late callbacks from completing twice.
    if (writes.has(write)) {
      // Remove first: the callback can synchronously cause more output to arrive.
      writes.delete(write);
      write.complete();
    }
  };

  const deliver = (write: BufferedWrite) => {
    if (renderer && writes.has(write) && !write.delivered) {
      // Mark before calling write: a renderer may invoke its callback immediately.
      write.delivered = true;
      renderer.write(write.bytes, () => complete(write));
    }
  };

  // Used during reset/disposal. Discard old writes without acknowledging them;
  // the surrounding output processor handles invalidating the old stream state.
  const clear = () => writes.clear();

  return {
    clear,
    fit: () => renderer?.fit(),
    hasRenderer: () => Boolean(renderer),

    attach: (next: TmuxTerminalRenderer) => {
      // One connection feeds one screen at a time.
      if (renderer) {
        throw new Error("A tmux terminal can have only one renderer");
      }

      renderer = next;
      next.reset();

      // A screen is now available. Hand it the output that accumulated without one.
      Array.from(writes).forEach(deliver);
      let detached = false;

      // The caller uses this function as its renderer-unmount cleanup.
      return () => {
        if (detached) {
          return;
        }
        detached = true;
        renderer = undefined;

        // A destroyed renderer may never finish its outstanding writes.
        // Release those writes so the connection cannot remain blocked forever.
        //
        // This does NOT prove the user saw that output. The surrounding hook
        // requests a fresh tmux screen when another renderer attaches.
        //
        // Writes not yet handed to a renderer remain buffered. Late callbacks
        // from the old renderer are harmless because complete checks membership.
        Array.from(writes)
          .filter((write) => write.delivered)
          .forEach(complete);
      };
    },

    // The input side of the bridge: the output processor calls these methods.
    sink: {
      cancelPendingInput: () => renderer?.cancelPendingInput?.(),
      reset: () => {
        // The output processor has already invalidated the previous terminal
        // generation, so discard its pending writes and clear the screen.
        clear();
        renderer?.reset();
      },
      write: (bytes: Uint8Array, onProcessed: () => void) => {
        const write = { bytes, complete: onProcessed, delivered: false };
        writes.add(write);

        // Deliver now if a renderer exists; otherwise leave the write waiting.
        // Do not call onProcessed merely because we buffered it.
        //
        // Withholding completion applies backpressure: the output processor
        // limits outstanding writes, and the server limits unacknowledged bytes.
        // Those limits prevent unlimited buffering while no screen is attached.
        deliver(write);
      },
    },
  };
};

type Notifications = {
  location: (location: TmuxTerminalLocation | undefined) => void;
  error: (error: Error | undefined) => void;
  status: (status: TmuxTerminalConnectionStatus) => void;
};

const sameStreamMethods = (
  left: TmuxTerminalConnection,
  right: TmuxTerminalConnection,
) =>
  left.close === right.close &&
  left.send === right.send &&
  left.subscribe === right.subscribe;

const createHookTerminal = (
  notify: Notifications,
  getStream: () => TmuxTerminalConnection,
) => {
  const bridge = createRendererBridge();
  let client: TmuxTerminalClient | undefined;
  let connection: TmuxTerminalConnection | undefined;
  let connectionId: symbol | undefined;
  let clientStatus: TmuxTerminalConnectionStatus | undefined;
  let receive: Parameters<TmuxTerminalConnection["subscribe"]>[0] | undefined;
  let unsubscribe: (() => void) | undefined;
  let disposed = false;
  let lease = 0;
  let earlySize: TmuxTerminalSize | undefined;
  let recoveryError: Error | undefined;
  let transportError: Error | undefined;
  const reattachment = createSessionReattachment((error) => {
    recoveryError = error;
    notify.error(recoveryError ?? transportError);
  });
  const fitRenderer = () => {
    if (bridge.hasRenderer() && connection?.status === "open") {
      client?.fitAndReportSize(bridge.fit);
      client?.redraw();
    }
  };
  const attachRenderer = (renderer: TmuxTerminalRenderer) => {
    const detach = bridge.attach(renderer);
    fitRenderer();
    return detach;
  };
  const resize = (size: TmuxTerminalSize) => {
    earlySize = size;
    client?.resize(size);
  };
  const dispose = () => {
    disposed = true;
    reattachment.reset();
    client?.dispose();
    client = undefined;
    bridge.clear();
  };
  const bindConnection = (stream: TmuxTerminalConnection) => {
    if (
      client &&
      connection &&
      unsubscribe &&
      sameStreamMethods(connection, stream)
    ) {
      return client;
    }
    unsubscribe?.();
    // The stream owner retires old handles. An old method wrapper may still close
    // the reused live handle, so rebinding must never call it. Identity/status
    // updates reset protocol state separately, without resetting request IDs.
    connection = stream;
    if (!client) {
      connectionId = stream.connectionId;
      client = createTmuxTerminalClient({
        connection: {
          ...connection,
          close: () => connection?.close(),
          send: (message) => connection?.send(message) ?? false,
          subscribe: (listener) => {
            receive = listener;
            return () => {
              receive = undefined;
            };
          },
        },
        sink: bridge.sink,
        onLocationChange: (location) => {
          reattachment.observe(location);
          notify.location(location);
        },
        onError: (error) => {
          transportError = error;
          notify.error(recoveryError ?? transportError);
        },
        onConnectionStatusChange: (status) => {
          clientStatus = status;
          if (status === "closed") {
            bridge.clear();
          }
          notify.status(status);
        },
      });
      if (earlySize && bridge.hasRenderer()) {
        client.resize(earlySize);
      }
      fitRenderer();
    }
    let active = true;
    const stopDelivery = stream.subscribe((message) => {
      const rendered = getStream();
      // Ignore delivery from an old transport, or between rendering a new
      // connection and resetting this client's request/revision state.
      if (
        active &&
        sameStreamMethods(stream, rendered) &&
        rendered.connectionId === connectionId &&
        rendered.status === "open"
      ) {
        receive?.(message);
      }
    });
    unsubscribe = () => {
      active = false;
      stopDelivery();
    };
    return client;
  };
  const synchronize = (stream: TmuxTerminalConnection) => {
    const current = bindConnection(stream);
    const connectionChanged =
      connectionId !== undefined && connectionId !== stream.connectionId;
    connectionId = stream.connectionId;
    // We may see "open" before and after a reconnect, missing the disconnect.
    // Forget the old connection's state before accepting the new one.
    // This resets the client locally; it does not close the actual connection.
    if (
      connectionChanged ||
      (stream.status === "closed" && clientStatus !== "closed")
    ) {
      reattachment.reset();
    }
    if (connectionChanged) {
      current.updateConnection({ status: "closed" });
    }
    const becameOpen = clientStatus !== "open";
    const shouldFitRenderer =
      stream.status === "open" && (becameOpen || connectionChanged);
    connection = stream;
    transportError = stream.error;
    notify.error(recoveryError ?? transportError);
    current.updateConnection(stream);
    if (shouldFitRenderer) {
      fitRenderer();
    }
    return current;
  };
  const connect = (stream: TmuxTerminalConnection) => {
    lease += 1;
    synchronize(stream);
    return () => {
      unsubscribe?.();
      unsubscribe = undefined;
      const closingLease = ++lease;
      // StrictMode immediately replays setup with the same transport. Delay irreversible
      // stream closure one microtask, but dispose real unmounts and reject pending goTo.
      queueMicrotask(() => {
        if (lease === closingLease) {
          dispose();
        }
      });
    };
  };
  const goTo = (target: TmuxTerminalTarget) => {
    if (disposed) {
      return Promise.reject(new Error("Tmux terminal disposed"));
    }
    // Child layout effects may navigate before the owner's effects. Bind the rendered
    // stream first so the low-level client can queue opening requests or send safely.
    const stream = getStream();
    const current = synchronize(stream);
    return stream.status === "closed" || stream.error
      ? current.goTo(target)
      : reattachment.goTo(current, target);
  };
  return {
    attachRenderer,
    connect,
    goTo,
    input: (data: TmuxTerminalInput) => client?.input(data),
    resize,
    updateConnection: (stream: TmuxTerminalConnection) => {
      const current = synchronize(stream);
      if (stream.status === "open" && !stream.error) {
        reattachment.restore(current);
      }
    },
  };
};

export const useTmuxTerminal = ({
  onConnectionStatusChange,
  onError,
  stream,
}: UseTmuxTerminalOptions): UseTmuxTerminalResult => {
  const [location, setLocation] = useState<TmuxTerminalLocation>();
  const [error, setError] = useState<Error>();
  // Forwards to the latest callbacks without recreating the client.
  const callbacksRef = useRef({ onConnectionStatusChange, onError, stream });
  callbacksRef.current = { onConnectionStatusChange, onError, stream };
  const [terminal] = useState(() =>
    createHookTerminal(
      {
        location: setLocation,
        error: (next) => {
          setError(next);
          if (next) {
            callbacksRef.current.onError?.(next);
          }
        },
        status: (status) =>
          callbacksRef.current.onConnectionStatusChange?.(status),
      },
      () => callbacksRef.current.stream,
    ),
  );

  // Owns the client lifecycle when its connection functions change; renderers attach independently.
  // Rebinding methods preserves the client; only actual connection state resets navigation.
  useLayoutEffect(
    () => terminal.connect(stream),
    [terminal, stream.close, stream.send, stream.subscribe],
  );

  // Synchronizes connection state and fits the renderer when the connection opens.
  useLayoutEffect(
    () => terminal.updateConnection(stream),
    [
      terminal,
      stream.close,
      stream.send,
      stream.subscribe,
      stream.connectionId,
      stream.error,
      stream.status,
    ],
  );

  return {
    attachRenderer: terminal.attachRenderer,
    error,
    goTo: terminal.goTo,
    input: terminal.input,
    location,
    resize: terminal.resize,
  };
};
