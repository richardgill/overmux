// Coordinates a terminal renderer with a transport carrying the shared terminal primitives.
// Integrations with additional messages adapt their connection at this boundary rather than
// forcing session selection or other multiplexer capabilities into this reusable lifecycle.
import type {
  TerminalDataMessage,
  TerminalInputMessage,
  TerminalRenderedMessage,
  TerminalResizeMessage,
} from "../shared/contracts";
import {
  createTerminalOutputProcessor,
  type TerminalSink,
} from "./output-processor";

export type TerminalStreamConnection = {
  // Requests that the underlying transport close.
  close: () => void;
  error?: Error;
  // Sends each shared primitive without claiming these messages form a complete protocol.
  send: {
    (message: TerminalInputMessage): boolean;
    (message: TerminalRenderedMessage): boolean;
    (message: TerminalResizeMessage): boolean;
  };
  status: "closed" | "open" | "opening";
  // Receives only terminal data; integrations route their domain messages separately.
  subscribe: (listener: (message: TerminalDataMessage) => void) => () => void;
};

export type TerminalStreamConnectionStatus = TerminalStreamConnection["status"];
export type TerminalStreamConnectionState = Pick<
  TerminalStreamConnection,
  "error" | "status"
>;
export type TerminalInput = TerminalInputMessage["data"];
export type TerminalSize = Omit<TerminalResizeMessage, "type">;

export type TerminalStreamClientOptions = {
  connection: TerminalStreamConnection;
  // Reports each distinct transport status.
  onConnectionStatusChange?: (status: TerminalStreamConnectionStatus) => void;
  // Reports transport or ordered-output processing failures.
  onError?: (error: Error) => void;
  sink: TerminalSink;
};

export type TerminalStreamClient = {
  // Stops message processing, unsubscribes, invalidates pending callbacks, and closes the transport.
  dispose: () => void;
  // Fits the renderer and resends dimensions if fitting did not synchronously resize it.
  fitAndReportSize: (fit: () => void) => void;
  input: (data: TerminalInput) => void;
  resize: (size: TerminalSize) => void;
  // Synchronizes the client after the external connection state changes.
  updateConnection: (state: TerminalStreamConnectionState) => void;
};

export const createTerminalStreamClient = ({
  connection,
  onConnectionStatusChange,
  onError,
  sink,
}: TerminalStreamClientOptions): TerminalStreamClient => {
  let connectionStatus = connection.status;
  let disposed = false;
  let latestSize: TerminalSize | undefined;
  let sizeRevision = 0;

  const reportConnectionStatus = (status: TerminalStreamConnectionStatus) => {
    if (connectionStatus === status) {
      return;
    }
    connectionStatus = status;
    onConnectionStatusChange?.(status);
  };
  const closeWithError = (error: Error) => {
    connection.close();
    reportConnectionStatus("closed");
    onError?.(error);
  };
  const outputProcessor = createTerminalOutputProcessor({
    onFailure: closeWithError,
    sendRendered: (message) => !disposed && connection.send(message),
    sink,
  });
  const unsubscribe = connection.subscribe(outputProcessor.enqueue);

  const resendSizeIfUnchanged = (revision: number) => {
    if (!disposed && sizeRevision === revision && latestSize) {
      connection.send({ ...latestSize, type: "resize" });
    }
  };
  const input = (data: TerminalInput) => {
    if (!disposed) {
      connection.send({ data, type: "input" });
    }
  };
  const resize = ({ cols, rows }: TerminalSize) => {
    latestSize = { cols, rows };
    sizeRevision += 1;
    if (!disposed) {
      connection.send({ cols, rows, type: "resize" });
    }
  };
  const updateConnection = ({
    error,
    status,
  }: TerminalStreamConnectionState) => {
    if (disposed) {
      return;
    }
    reportConnectionStatus(status);
    if (error) {
      onError?.(error);
    }
    if (status === "closed") {
      outputProcessor.connectionClosed();
      return;
    }
    outputProcessor.connectionOpening();
  };
  const fitAndReportSize = (fit: () => void) => {
    const revision = sizeRevision;
    fit();
    // Fitting can synchronously resize the renderer, which already reports its size.
    resendSizeIfUnchanged(revision);
  };
  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    // Unsubscribe before invalidating writes, then close transport last so no callback can escape cleanup.
    unsubscribe();
    outputProcessor.close();
    connection.close();
  };

  onConnectionStatusChange?.(connectionStatus);
  if (connectionStatus === "closed") {
    outputProcessor.connectionClosed();
  }

  return { dispose, fitAndReportSize, input, resize, updateConnection };
};
