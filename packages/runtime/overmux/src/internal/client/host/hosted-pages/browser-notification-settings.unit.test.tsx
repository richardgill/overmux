import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  disableBackgroundNotifications,
  enableBackgroundNotifications,
} from "../../background-notifications";
import { BrowserNotificationSettings } from "./browser-notification-settings";

const subscription = {
  endpoint: "https://push.test/browser",
  expirationTime: null,
  options: { applicationServerKey: Uint8Array.from([1, 2, 3]).buffer },
  toJSON: () => ({
    endpoint: "https://push.test/browser",
    expirationTime: null,
    keys: { auth: "auth-key", p256dh: "p256-key" },
  }),
  unsubscribe: vi.fn().mockResolvedValue(true),
};

let container: HTMLDivElement;
let root: Root;
let serviceWorkerDescriptor: PropertyDescriptor | undefined;
let secureContextDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  localStorage.clear();
  serviceWorkerDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "serviceWorker",
  );
  secureContextDescriptor = Object.getOwnPropertyDescriptor(
    window,
    "isSecureContext",
  );
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  if (serviceWorkerDescriptor) {
    Object.defineProperty(navigator, "serviceWorker", serviceWorkerDescriptor);
  }
  if (secureContextDescriptor) {
    Object.defineProperty(window, "isSecureContext", secureContextDescriptor);
  }
});

describe("background notification controls", () => {
  it("keeps disable intent and retries after a server failure", async () => {
    localStorage.setItem("overmux.backgroundNotificationsEnabled", "true");
    const getSubscription = vi.fn().mockResolvedValue(subscription);
    const fetchRequest = vi
      .fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal("fetch", fetchRequest);
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: vi.fn(async () => ({
          pushManager: { getSubscription },
        })),
        ready: Promise.resolve({ pushManager: { getSubscription } }),
      },
    });

    await expect(disableBackgroundNotifications()).rejects.toThrow(
      "unavailable",
    );
    expect(
      localStorage.getItem("overmux.backgroundNotificationsEnabled"),
    ).toBeNull();
    expect(subscription.unsubscribe).not.toHaveBeenCalled();

    await disableBackgroundNotifications();
    expect(fetchRequest).toHaveBeenCalledTimes(2);
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it("replaces subscriptions created with an old server key", async () => {
    const staleSubscription = {
      ...subscription,
      endpoint: "https://push.test/stale",
      options: { applicationServerKey: Uint8Array.from([9]).buffer },
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
    const subscribe = vi.fn().mockResolvedValue(subscription);
    const getSubscription = vi.fn().mockResolvedValue(staleSubscription);
    const fetchRequest = vi.fn(
      async (input: string | URL | Request, _init?: RequestInit) =>
        new Response(
          String(input).endsWith("/public-key")
            ? JSON.stringify({ publicKey: "AQID" })
            : JSON.stringify({ ok: true }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("Notification", {
      permission: "granted",
      requestPermission: vi.fn(),
    });
    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal("fetch", fetchRequest);
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: vi.fn(),
        ready: Promise.resolve({
          pushManager: { getSubscription, subscribe },
        }),
      },
    });

    await expect(enableBackgroundNotifications()).resolves.toBe(true);

    expect(staleSubscription.unsubscribe).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledWith({
      applicationServerKey: Uint8Array.from([1, 2, 3]),
      userVisibleOnly: true,
    });
    expect(
      fetchRequest.mock.calls.map(([, init]) => init?.method ?? "GET"),
    ).toEqual(["GET", "DELETE", "PUT"]);
  });

  it("requests permission only after the user selects Enable", async () => {
    let permission: NotificationPermission = "default";
    const requestPermission = vi.fn(async () => {
      permission = "granted";
      return permission;
    });
    const getSubscription = vi
      .fn()
      .mockResolvedValue(subscription)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const subscribe = vi.fn().mockResolvedValue(subscription);
    let controllerChange = () => undefined;
    const addEventListener = vi.fn(
      (type: string, listener: () => undefined) => {
        if (type === "controllerchange") {
          controllerChange = listener;
        }
      },
    );
    vi.stubGlobal("Notification", {
      get permission() {
        return permission;
      },
      requestPermission,
    });
    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (input: string | URL | Request) =>
          new Response(
            String(input).endsWith("/public-key")
              ? JSON.stringify({ publicKey: "AQID" })
              : JSON.stringify({ ok: true }),
            { headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        addEventListener,
        getRegistration: vi.fn(async () => ({
          pushManager: { getSubscription, subscribe },
        })),
        ready: Promise.resolve({
          pushManager: { getSubscription, subscribe },
        }),
        removeEventListener: vi.fn(),
      },
    });

    await act(async () => root.render(<BrowserNotificationSettings />));
    expect(requestPermission).not.toHaveBeenCalled();
    expect(getSubscription).toHaveBeenCalledOnce();

    await act(async () => {
      (
        container.querySelector(
          "[data-om-background-notifications-enable]",
        ) as HTMLElement
      ).click();
    });

    expect(requestPermission).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledOnce();
    expect(container.textContent).toContain(
      "Background notifications are enabled",
    );

    await act(async () => controllerChange());
    expect(getSubscription).toHaveBeenCalledTimes(3);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(getSubscription).toHaveBeenCalledTimes(4);
    expect(subscribe).toHaveBeenCalledOnce();
    expect(
      vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT"),
    ).toHaveLength(3);

    await act(async () => {
      container
        .querySelector<HTMLElement>(
          "[data-om-background-notifications-disable]",
        )
        ?.click();
    });
    expect(container.textContent).toContain(
      "Background notifications are disabled",
    );
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });
});
