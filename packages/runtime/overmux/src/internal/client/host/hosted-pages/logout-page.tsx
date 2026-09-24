import { useEffect, useState } from "react";

import { HostedPage } from "./hosted-page";

const logoutRequests = new WeakMap<Document, Promise<void>>();
const minimumLogoutDuration = 3_000;

const requestLogout = () => {
  const existing = logoutRequests.get(document);
  if (existing) {
    return existing;
  }
  const request = fetch("/api/auth/logout", { method: "POST" }).then(
    (response) => {
      if (!response.ok) {
        throw new Error(`Logout failed: ${response.status}`);
      }
    },
  );
  logoutRequests.set(document, request);
  return request;
};

const minimumDelay = () =>
  new Promise<void>((resolve) => setTimeout(resolve, minimumLogoutDuration));

export const HostedLogoutPage = () => {
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setError(false);
    void Promise.allSettled([requestLogout(), minimumDelay()]).then(
      ([logout]) => {
        if (!active) {
          return;
        }
        if (logout?.status === "fulfilled") {
          location.replace("/login");
          return;
        }
        setError(true);
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  return (
    <HostedPage>
      <h1>{error ? "Log out failed" : "Logging out…"}</h1>
      {error ? (
        <>
          <p role="alert">
            Overmux could not log you out. Check your connection and try again.
          </p>
          <button
            data-om-hosted-retry=""
            onClick={() => {
              logoutRequests.delete(document);
              setAttempt((current) => current + 1);
            }}
            type="button"
          >
            Retry
          </button>
        </>
      ) : (
        <p>Please wait while Overmux ends your session.</p>
      )}
    </HostedPage>
  );
};
