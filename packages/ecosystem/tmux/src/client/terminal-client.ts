// Coordinates tmux navigation and confirmed locations around the shared terminal transport.
// The shared client owns rendering, size, input, and disposal; this wrapper correlates navigation
// requests and applies ordered location observations.
//
// There are two separate outputs: goTo() resolves the result of one navigation request,
// while onLocationChange reports the newest server-observed location, including changes
// made through native tmux commands. Neither sending a request nor rendering its output
// proves navigation succeeded; only the server's go-to-result confirms that request.
import {
  createTerminalStreamClient,
  type TerminalInput,
  type TerminalSink,
  type TerminalSize,
  type TerminalStreamConnection,
  type TerminalStreamConnectionState,
  type TerminalStreamConnectionStatus,
} from "@overmux/terminal-stream/client";
import type { TerminalDataMessage } from "@overmux/terminal-stream/shared";

import {
  tmuxTerminalTargetSchema,
  type TmuxTerminalClientMessage,
  type TmuxTerminalServerMessage,
  type TmuxTerminalLocation,
  type TmuxTerminalTarget,
} from "../shared/terminal-contracts";

export type {
  TmuxTerminalLocation,
  TmuxTerminalTarget,
} from "../shared/terminal-contracts";

export type TmuxTerminalSink = TerminalSink & {
  // Cancels locally pending input before navigation, or when an ownership change is observed.
  // Native changes not yet observed by this client remain outside this cancellation boundary.
  cancelPendingInput?: () => void;
};

// Provides the transport used by the terminal client to exchange the composed tmux protocol.
export type TmuxTerminalConnection = {
  // Changes whenever a new server stream opens, including reconnects.
  connectionId: symbol | undefined;
  // Requests that the underlying transport close.
  close: () => void;
  error?: Error;
  // Sends one client message and reports whether the transport accepted it.
  send: (message: TmuxTerminalClientMessage) => boolean;
  status: "closed" | "open" | "opening";
  // Receives server messages and returns a function that stops delivery.
  subscribe: (
    listener: (message: TmuxTerminalServerMessage) => void,
  ) => () => void;
};

export type TmuxTerminalConnectionStatus = TerminalStreamConnectionStatus;
export type TmuxTerminalConnectionState = TerminalStreamConnectionState;
export type TmuxTerminalInput = TerminalInput;
export type TmuxTerminalSize = TerminalSize;

// Configures terminal rendering, transport, and lifecycle notifications.
export type TmuxTerminalClientOptions = {
  // Reports each distinct transport status.
  onConnectionStatusChange?: (status: TmuxTerminalConnectionStatus) => void;
  // Reports transport or output-processing failures.
  onError?: (error: Error) => void;
  // Reports the full location observed by the attached terminal client.
  // undefined clears the last known location after a disconnect or failure.
  // This reports server observations, not the target passed to goTo().
  onLocationChange?: (location: TmuxTerminalLocation | undefined) => void;
  // Receives terminal bytes and reports when they have been processed. The shared
  // client uses those callbacks to acknowledge output and limit outstanding data.
  sink: TmuxTerminalSink;
  connection: TmuxTerminalConnection;
};

// Coordinates terminal protocol messages, output rendering, and tmux session selection.
export type TmuxTerminalClient = {
  dispose: () => void;
  fitAndReportSize: (fit: () => void) => void;
  input: (data: TmuxTerminalInput) => void;
  resize: (size: TmuxTerminalSize) => void;
  // Confirms a fresh full tmux location, even for repeated targets.
  // A target may name just a session, a session/window, or a session/window/pane.
  // The server fills in omitted IDs and verifies that the supplied IDs belong together.
  // A newer valid call rejects the previous pending call with an AbortError.
  // A server-rejected target rejects this promise rather than calling onError.
  goTo: (target: TmuxTerminalTarget) => Promise<TmuxTerminalLocation>;
  redraw: () => void;
  updateConnection: (state: TmuxTerminalConnectionState) => void;
};

export const createTmuxTerminalClient = ({
  onConnectionStatusChange,
  onError,
  onLocationChange,
  sink,
  connection,
}: TmuxTerminalClientOptions): TmuxTerminalClient => {
  // These are the latest connection observations. The original connection object
  // supplies transport methods; subsequent status/error changes arrive via updateConnection.
  let connectionStatus = connection.status;
  let connectionError = connection.error;
  let disposed = false;

  // Request IDs are allocated locally and identify which goTo() a reply belongs to.
  // Keep increasing across reconnects so an old reply cannot match a new request.
  let nextRequestId = 0;

  // Revisions are allocated by the server and order location observations, whether
  // they come from navigation confirmations or native tmux changes. They are NOT
  // request IDs. -1 means no observation has been accepted on this connection yet.
  let locationRevision = -1;
  let observedLocation: TmuxTerminalLocation | undefined;

  // One pending intent, not a queue: a newer valid goTo() replaces the previous one.
  // sent distinguishes waiting for the connection from waiting for the server's reply.
  let pending:
    | {
        requestId: number;
        target: TmuxTerminalTarget;
        resolve: (location: TmuxTerminalLocation) => void;
        reject: (error: Error) => void;
        sent: boolean;
      }
    | undefined;

  const rejectPending = (error: Error) => {
    // Release ownership before settling the promise. Later replies must no longer
    // find this request, regardless of how the caller handles the rejection.
    const request = pending;
    pending = undefined;
    request?.reject(error);
  };
  const confirmLocation = (
    location: TmuxTerminalLocation,
    revision: number,
  ) => {
    // Duplicates and older observations must not move the reported location backwards.
    // Compare revisions, not IDs: revisiting the same pane can be a newer observation.
    if (revision <= locationRevision) {
      return;
    }
    locationRevision = revision;
    if (
      location.sessionId !== observedLocation?.sessionId ||
      location.windowId !== observedLocation?.windowId ||
      location.paneId !== observedLocation?.paneId
    ) {
      sink.cancelPendingInput?.();
    }
    observedLocation = location;
    onLocationChange?.(location);
  };
  const connectionFailed = (error: Error) => {
    // Transport/output failures invalidate pending navigation and the last known
    // location. An ordinary go-to-result error only rejects that individual request.
    rejectPending(error);
    sink.cancelPendingInput?.();
    observedLocation = undefined;
    onLocationChange?.(undefined);
    onError?.(error);
  };
  const sendPending = () => {
    // Opening is a valid state in which to accept navigation, but not to send it.
    // Leave the intent pending until open; never send the same request twice.
    if (
      !pending ||
      pending.sent ||
      connectionStatus !== "open" ||
      connectionError
    ) {
      return;
    }
    // Mark before calling transport code, which may synchronously deliver a reply.
    pending.sent = true;
    // Cancel before sending: the server can route subsequent input to the requested target
    // even before confirmation. Waiting for React's location effect is too late.
    sink.cancelPendingInput?.();
    try {
      // true means accepted by the transport, not confirmed by tmux. Keep the
      // promise pending until a matching go-to-result arrives; there is no blind retry.
      if (
        !connection.send({
          type: "go-to",
          requestId: pending.requestId,
          target: pending.target,
        })
      ) {
        rejectPending(new Error("Tmux navigation request could not be sent"));
      }
    } catch (cause) {
      rejectPending(cause instanceof Error ? cause : new Error(String(cause)));
    }
  };

  // Separate tmux-specific messages from terminal data on the same subscription.
  // The listener belongs to the shared client and must receive only terminal data messages.
  const handleServerMessage = (
    listener: (message: TerminalDataMessage) => void,
    message: TmuxTerminalServerMessage,
  ) => {
    // Ignore delivery that races with disconnect or disposal.
    if (disposed || connectionStatus !== "open") {
      return;
    }
    if (message.type === "location-changed") {
      // Native observations are independent of goTo(). Publish them even while a
      // request is pending, without sending navigation back to the server.
      confirmLocation(message.location, message.revision);
      return;
    }
    if (message.type === "go-to-result") {
      // Drop the entire reply if its request was superseded, failed, or already
      // completed. Even a high revision cannot make an unrelated reply authoritative.
      if (message.requestId !== pending?.requestId) {
        return;
      }
      const request = pending;
      // Clear before notifying user code: onLocationChange may synchronously call
      // goTo() again, and that new request must not be mistaken for this one.
      pending = undefined;
      if (message.result.outcome === "error") {
        request.reject(new Error(message.result.message));
        return;
      }
      // A successful request still resolves even if a newer native observation
      // arrived first. For example, revision 8 may already be visible when this
      // request's revision 7 arrives: resolve its promise, but do not publish 7 over 8.
      confirmLocation(message.result.location, message.result.revision);
      request.resolve(message.result.location);
      return;
    }
    listener(message);
  };
  // Adapt the composed tmux protocol to the smaller shared-terminal protocol.
  // Outgoing input/resize/output acknowledgements already fit the tmux message union;
  // incoming navigation/location messages are consumed above instead of reaching the sink.
  const terminalConnection: TerminalStreamConnection = {
    close: connection.close,
    error: connection.error,
    send: connection.send,
    status: connection.status,
    subscribe: (listener) =>
      connection.subscribe((message) => handleServerMessage(listener, message)),
  };
  const handleConnectionStatusChange = (
    status: TmuxTerminalConnectionStatus,
  ) => {
    connectionStatus = status;
    if (status === "closed") {
      // Disconnect ends the request rather than silently replaying it on reconnect.
      // A replacement server stream can start revisions from zero, so forget the
      // previous revision as well as the previous location. Request IDs stay unique.
      rejectPending(new Error("Tmux terminal disconnected"));
      locationRevision = -1;
      sink.cancelPendingInput?.();
      observedLocation = undefined;
      onLocationChange?.(undefined);
    }
    if (status === "open") {
      // Only explicit queued requests are sent; confirmed locations are never desired state.
      sendPending();
    }
    onConnectionStatusChange?.(status);
  };
  // The shared client owns the subscription, ordered output/acknowledgements,
  // renderer sizing, input and transport teardown. Keep that machinery out of this
  // navigation wrapper. It also reports the initial status during construction.
  const terminalClient = createTerminalStreamClient({
    connection: terminalConnection,
    onConnectionStatusChange: handleConnectionStatusChange,
    onError: connectionFailed,
    sink,
  });

  const goTo = (target: TmuxTerminalTarget): Promise<TmuxTerminalLocation> => {
    // "opening" is deliberately allowed: callers do not need a readiness guard or
    // an attached renderer. Closed/failed/disposed clients reject rather than queue.
    if (disposed || connectionStatus === "closed" || connectionError) {
      return Promise.reject(
        connectionError ??
          new Error(
            disposed ? "Tmux terminal disposed" : "Tmux terminal disconnected",
          ),
      );
    }
    // Validate before superseding: a malformed call must not cancel a valid pending
    // request. This checks shape/ID syntax; the server checks actual tmux membership.
    const parsed = tmuxTerminalTargetSchema.safeParse(target);
    if (!parsed.success) {
      return Promise.reject(new Error("Invalid tmux navigation target"));
    }
    // Supersession settles immediately; late results cannot resolve or overwrite a newer request.
    const superseded = new Error(
      "Tmux navigation superseded by a newer request",
    );
    // AbortError describes local promise cancellation, not a rollback of tmux
    // commands the server may already have executed for the previous request.
    superseded.name = "AbortError";
    rejectPending(superseded);
    return new Promise((resolve, reject) => {
      // Install the request before sending: even a synchronous reply must be able
      // to find its promise. Repeated targets get fresh IDs and fresh confirmation.
      pending = {
        requestId: nextRequestId++,
        target: parsed.data,
        resolve,
        reject,
        sent: false,
      };
      sendPending();
    });
  };
  const dispose = () => {
    if (disposed) {
      return;
    }
    // Stop accepting messages before transport cleanup can trigger callbacks.
    // Reject our promise first; the shared client then unsubscribes, invalidates
    // pending renderer callbacks, and closes the transport. Repeated disposal is safe.
    disposed = true;
    rejectPending(new Error("Tmux terminal disposed"));
    terminalClient.dispose();
  };

  return {
    dispose,
    fitAndReportSize: terminalClient.fitAndReportSize,
    input: terminalClient.input,
    resize: terminalClient.resize,
    goTo,
    redraw: () => {
      // Ask for a fresh screen after renderer attachment. This neither navigates nor
      // creates a pending promise, and requests made while not open are not queued.
      if (!disposed && connectionStatus === "open") {
        connection.send({ type: "redraw" });
      }
    },
    updateConnection: (state) => {
      // Store the error first: the shared update can synchronously report "open",
      // which calls sendPending(). An open status accompanied by an error must not
      // accidentally flush a queued navigation request before the error is handled.
      connectionError = state.error;
      terminalClient.updateConnection(state);
    },
  };
};
