// Bound registration as well as activation: serviceWorker.ready can wait forever
// when no worker exists, and an installing worker can fail or stall indefinitely.
export const registerPushWorker = () =>
  new Promise<ServiceWorkerRegistration>((resolve, reject) => {
    let watched: ServiceWorker | null = null;
    let settled = false;
    const finish = (
      error?: Error,
      registration?: ServiceWorkerRegistration,
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      watched?.removeEventListener("statechange", onStateChange);
      if (error) {
        reject(error);
      } else {
        resolve(registration!);
      }
    };
    let registered: ServiceWorkerRegistration | undefined;
    const onStateChange = () => {
      if (watched?.state === "activated") {
        finish(undefined, registered);
      } else if (watched?.state === "redundant") {
        finish(
          new Error("The background notification worker failed to activate"),
        );
      }
    };
    const timeout = setTimeout(() => {
      finish(
        new Error("Timed out starting the background notification worker"),
      );
    }, 10_000);
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(
        (registration) => {
          // The browser registration itself cannot be cancelled; ignore late results.
          if (settled) {
            return;
          }
          registered = registration;
          watched =
            registration.active ??
            registration.installing ??
            registration.waiting;
          if (!watched) {
            finish(
              new Error("No background notification worker was installed"),
            );
            return;
          }
          watched.addEventListener("statechange", onStateChange);
          onStateChange();
        },
        (error: unknown) =>
          finish(error instanceof Error ? error : new Error(String(error))),
      );
  });
