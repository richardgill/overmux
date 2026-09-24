// Presents update availability and coordinates browser-side restart recovery.
// Every browser follows the server broadcast and reloads only after health returns.

import "./update-popover.css";

import { delay } from "@overmux/lib";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import type { ServerLifecycleEvent } from "../../shared/index";
import type { ClientTransport, TransportStatus } from "../transport";

type UpdateState =
  | { type: "current" }
  | { type: "available"; error?: string }
  | { type: "requesting" }
  | { type: "restarting" };
type UpdateAction =
  | ServerLifecycleEvent
  | { type: "restart-requested" }
  | { type: "restart-failed"; error: string };
type ConnectionState = "initial" | "connected" | "reconnecting";

const reduceUpdateState = (
  _state: UpdateState,
  action: UpdateAction,
): UpdateState => {
  if (action.type === "update-available") {
    return { type: "available" };
  }
  if (action.type === "restart-requested") {
    return { type: "requesting" };
  }
  if (action.type === "restart-failed") {
    return { type: "available", error: action.error };
  }
  return { type: "restarting" };
};

const pollUntilHealthy = async (signal: AbortSignal): Promise<void> => {
  if (signal.aborted) {
    return;
  }
  try {
    const response = await fetch("/api/health", {
      cache: "no-store",
      signal,
    });
    if (response.ok) {
      location.reload();
      return;
    }
  } catch {}
  await delay(250);
  return pollUntilHealthy(signal);
};

const ReconnectingScreen = () => (
  <main aria-live="polite" data-om-reconnecting="" role="status">
    <section data-om-reconnecting-panel="">
      <h1 data-om-reconnecting-title="">Reconnecting</h1>
      <p data-om-reconnecting-message="">
        Reconnecting to Overmux. Your workspace will resume shortly.
      </p>
    </section>
  </main>
);

const useUpdateState = (transport: ClientTransport) => {
  const [state, dispatch] = useReducer(reduceUpdateState, { type: "current" });

  useEffect(
    () => transport.subscribeLifecycle((event) => dispatch(event)),
    [transport],
  );
  useEffect(() => {
    if (state.type !== "restarting") {
      return;
    }
    const controller = new AbortController();
    void pollUntilHealthy(controller.signal);
    return () => controller.abort();
  }, [state.type]);

  const requestRestart = useCallback(async () => {
    dispatch({ type: "restart-requested" });
    try {
      const response = await fetch("/api/restart", { method: "POST" });
      if (!response.ok) {
        throw new Error(`Restart request failed: ${response.status}`);
      }
      dispatch({ type: "restarting" });
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      dispatch({ type: "restart-failed", error });
    }
  }, []);

  return { requestRestart, state };
};

const useConnectionState = (transport: ClientTransport) => {
  const connected = useRef(false);
  const [connection, setConnection] = useState<ConnectionState>("initial");

  useEffect(
    () =>
      transport.subscribeStatus((status: TransportStatus) => {
        if (status === "connected") {
          connected.current = true;
          setConnection("connected");
          return;
        }
        if (!connected.current) {
          return;
        }
        connected.current = false;
        setConnection("reconnecting");
      }),
    [transport],
  );

  return connection;
};

export const UpdatePopover = ({
  transport,
}: {
  transport: ClientTransport;
}) => {
  const connection = useConnectionState(transport);
  const { requestRestart, state } = useUpdateState(transport);

  if (state.type === "restarting") {
    return (
      <main aria-live="polite" data-om-restarting="" role="status">
        <section data-om-restarting-panel="">
          <h1 data-om-restarting-title="">Restarting Overmux</h1>
          <p data-om-restarting-message="">Waiting for the new version.</p>
        </section>
      </main>
    );
  }
  if (connection === "reconnecting") {
    return <ReconnectingScreen />;
  }
  if (state.type === "current") {
    return null;
  }

  const error = state.type === "available" ? state.error : undefined;

  return (
    <aside data-om-update="" role="status">
      <p>A new version is available. Reload to update.</p>
      <button
        data-om-update-reload=""
        disabled={state.type === "requesting"}
        onClick={() => void requestRestart()}
        type="button"
      >
        Reload
      </button>
      {error ? <p data-om-update-error="">{error}</p> : null}
    </aside>
  );
};
