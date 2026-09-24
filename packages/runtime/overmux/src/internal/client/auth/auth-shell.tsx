// SECURITY BOUNDARY: This directory is the public, Overmux-owned pre-authentication client.
// It may contain only locked/login/recovery UI and direct calls to the public authentication endpoints.
// It must never import userland, OvermuxHost, runtime manifests, protected application code, or user assets.
// The auth-only Vite build enforces that local imports cannot leave this directory.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";

// React Query is intentionally excluded to keep the public pre-authentication shell lightweight.
// Its mutations may still run concurrently, so it would not replace latest-request cancellation.
import { getAuthState, login, type LoginInput } from "./auth-api";
import { LoginCodeInput } from "./login-code-input";
import "./auth-shell.css";

type AuthStatus =
  | "idle"
  | "pending"
  | "invalid"
  | "expired"
  | "rate-limited"
  | "server-unavailable"
  | "session-expired";

type AuthShellProps = {
  ticket?: string;
};

type ExchangeOptions = {
  input: LoginInput;
  setStatus: (status: AuthStatus) => void;
  signal: AbortSignal;
};

const statusMessages: Record<Exclude<AuthStatus, "idle">, string> = {
  expired: "That login grant has expired. Generate a new one.",
  invalid: "That login code or link is invalid.",
  pending: "Signing in…",
  "rate-limited": "Too many attempts. Wait a moment and try again.",
  "server-unavailable": "The server is unavailable.",
  "session-expired": "Your session expired or was revoked. Sign in again.",
};

const initialStatus = (): AuthStatus =>
  new URLSearchParams(window.location.search).get("reason") ===
  "session-expired"
    ? "session-expired"
    : "idle";

// Login requests are latest-wins so an older response cannot overwrite newer UI state.
// Aborting cannot undo server processing; the server separately consumes one-time grants atomically.
const nextRequest = (request: RefObject<AbortController | undefined>) => {
  request.current?.abort();
  const controller = new AbortController();
  request.current = controller;
  return controller;
};

const exchangeLogin = async ({ input, setStatus, signal }: ExchangeOptions) => {
  setStatus("pending");
  try {
    const result = await login(input, signal);
    if (signal.aborted) {
      return;
    }
    if (result.status === "authenticated") {
      window.location.replace("/");
      return;
    }
    setStatus(
      result.status === "unknown" ? "server-unavailable" : result.status,
    );
  } catch {
    if (!signal.aborted) {
      setStatus("server-unavailable");
    }
  }
};

const isErrorStatus = (status: AuthStatus) =>
  status !== "idle" && status !== "pending";

const useAuthFlow = (ticket?: string) => {
  const [status, setStatus] = useState(initialStatus);
  const request = useRef<AbortController | undefined>(undefined);
  const authenticate = useCallback((input: LoginInput) => {
    const controller = nextRequest(request);
    void exchangeLogin({ input, setStatus, signal: controller.signal });
  }, []);

  // Cleanup also prevents ticket changes, unmounts, and development remounts from completing stale requests.
  useEffect(() => {
    if (ticket) {
      authenticate({ ticket });
      return () => request.current?.abort();
    }
    const controller = nextRequest(request);
    void getAuthState(controller.signal).then(
      (state) => {
        if (!controller.signal.aborted && state.authenticated) {
          window.location.replace("/");
        }
      },
      () => {
        if (!controller.signal.aborted) {
          setStatus("server-unavailable");
        }
      },
    );
    return () => request.current?.abort();
  }, [authenticate, ticket]);

  return { authenticate, status };
};

export const AuthShell = ({ ticket }: AuthShellProps) => {
  const { authenticate, status } = useAuthFlow(ticket);
  const submitCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get("code");
    if (typeof code === "string") {
      authenticate({ code });
    }
  };
  const message = status === "idle" ? undefined : statusMessages[status];
  const pending = status === "pending";

  return (
    <main aria-labelledby="auth-title" data-om-auth-shell="">
      <h1 id="auth-title">Overmux is locked</h1>
      <p>
        Generate a login code on the server with <code>overmux auth login</code>
        .
      </p>
      <p
        aria-atomic="true"
        aria-live="polite"
        data-om-auth-status={isErrorStatus(status) ? "error" : ""}
        id="auth-status"
        role="status"
      >
        {message}
      </p>
      <form aria-busy={pending} onSubmit={submitCode}>
        <label htmlFor="auth-code">Login code</label>
        <LoginCodeInput disabled={pending} />
        <button disabled={pending} type="submit">
          Unlock Overmux
        </button>
      </form>
    </main>
  );
};
