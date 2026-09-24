import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createInstanceIdentity,
  type InstanceIdentity,
  overmuxLogoutPath,
  overmuxSettingsPath,
} from "@overmux/shared";

let statusListener: ((status: string) => void) | undefined;
const transport = {
  activate: vi.fn(),
  dispose: vi.fn(),
  reportDiagnostic: vi.fn(),
  getInstance: vi.fn<() => InstanceIdentity | undefined>(() => undefined),
  subscribeInstance: () => () => undefined,
  subscribeLifecycle: () => () => undefined,
  subscribeNotification: () => () => undefined,
  subscribeStatus: (listener: (status: string) => void) => {
    statusListener = listener;
    return () => {
      statusListener = undefined;
    };
  },
};

vi.mock("../transport", () => ({
  createClientTransport: () => transport,
  TransportContext: {
    Provider: ({ children }: { children: React.ReactNode }) => children,
  },
}));
vi.mock("./update-popover", () => ({
  UpdatePopover: () => <div data-system-update="" />,
}));

import { OvermuxHost } from "./overmux-host";

const roots: ReturnType<typeof createRoot>[] = [];
const manifest = {
  debug: false,
  operations: [],
  protocolVersion: 10,
  resources: [],
  streams: [],
};

const renderHost = async (
  component: () => React.ReactNode = () => null,
  navigate?: (route: string) => unknown,
) => {
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <OvermuxHost definition={{ commands: {}, component, navigate }} />,
    );
  });
  return container;
};

beforeEach(() => {
  vi.clearAllMocks();
  statusListener = undefined;
  window.overmuxHost = undefined;
});

afterEach(() => {
  roots.splice(0).forEach((root) => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("OvermuxHost", () => {
  it("sets environment selectors on import before mounting React or a theme scope", () => {
    expect(roots).toHaveLength(0);
    expect(document.documentElement.getAttribute("data-om-host")).toBe(
      "browser",
    );
    expect(document.documentElement.getAttribute("data-om-platform")).toMatch(
      /^(macos|windows|linux|android|ios|unknown)$/u,
    );
    expect(document.querySelector("[data-om-scope]")).toBeNull();
  });

  it("keeps lifecycle UI mounted when the user app fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest))),
    );
    const App = () => {
      throw new Error("user app failed");
    };

    const container = await renderHost(App);

    expect(container.querySelector("[data-om-recovery]")).not.toBeNull();
    expect(container.querySelector("[data-system-update]")).not.toBeNull();
  });

  it("redirects to login when the runtime manifest rejects the session", async () => {
    const replace = vi.fn();
    vi.stubGlobal("location", { pathname: "/", replace, search: "" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );

    await renderHost();

    expect(replace).toHaveBeenCalledWith("/login?reason=session-expired");
    expect(transport.activate).not.toHaveBeenCalled();
  });

  it("keeps session-expiry handling but removes page-level logout and notification controls", async () => {
    const replace = vi.fn();
    vi.stubGlobal("location", { pathname: "/", replace, search: "" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest))),
    );

    const container = await renderHost();

    expect(container.querySelector("[data-system-update]")).not.toBeNull();
    expect(container.querySelector("[data-om-auth-control]")).toBeNull();
    expect(
      container.querySelector("[data-om-background-notifications]"),
    ).toBeNull();
    act(() => statusListener?.("authentication-required"));
    expect(replace).toHaveBeenCalledWith("/login?reason=session-expired");
  });

  it("installs one deep-link router boundary for the app and cleans it up on unmount", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest))),
    );
    transport.getInstance.mockReturnValue(createInstanceIdentity("work-4242"));
    const navigate = vi.fn();
    const App = () => (
      <a href="overmux://work-4242/tmux/1/2/3?tab=terminal#pane">Pane</a>
    );
    const container = await renderHost(App, navigate);
    document.body.append(container);
    try {
      container.querySelector("a")!.click();
      expect(navigate).toHaveBeenCalledExactlyOnceWith(
        "/tmux/1/2/3?tab=terminal#pane",
      );
      await act(async () => roots.pop()!.unmount());
      const anchor = document.createElement("a");
      anchor.href = "overmux://work-4242/after-unmount";
      container.append(anchor);
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      anchor.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(navigate).toHaveBeenCalledOnce();
    } finally {
      container.remove();
    }
  });

  it("owns settings above userland without loading the runtime", async () => {
    const App = vi.fn(() => <div>userland</div>);
    const fetchRequest = vi.fn();
    vi.stubGlobal("fetch", fetchRequest);
    vi.stubGlobal("location", {
      pathname: overmuxSettingsPath,
      search: "?returnTo=%2Fworkspace%3Ftab%3D2",
    });

    const container = await renderHost(App);

    expect(container.textContent).toContain("Overmux settings");
    expect(container.textContent).toContain("Notifications");
    expect(container.textContent).toContain("Browser notifications");
    expect(container.textContent).toContain("Session");
    expect(
      container
        .querySelector<HTMLAnchorElement>("[data-om-hosted-header] a")
        ?.getAttribute("href"),
    ).toBe("/workspace?tab=2");
    expect(App).not.toHaveBeenCalled();
    expect(fetchRequest).not.toHaveBeenCalled();
    expect(transport.activate).not.toHaveBeenCalled();
  });

  it("owns logout above userland without loading the runtime", async () => {
    vi.useFakeTimers();
    const App = vi.fn(() => <div>userland</div>);
    const fetchRequest = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchRequest);
    vi.stubGlobal("location", { pathname: overmuxLogoutPath, search: "" });

    const container = await renderHost(App);

    expect(container.textContent).toContain("Logging out…");
    expect(fetchRequest).toHaveBeenCalledOnce();
    expect(fetchRequest).toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
    });
    expect(App).not.toHaveBeenCalled();
    expect(transport.activate).not.toHaveBeenCalled();
  });

  it("shows desktop notification guidance and rejects unsafe return targets", async () => {
    window.overmuxHost = {
      version: 1,
      platform: "linux",
      notifications: { show: vi.fn(), version: 1 },
    };
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("location", {
      pathname: overmuxSettingsPath,
      search: "?returnTo=https%3A%2F%2Fattacker.test%2F",
    });

    const container = await renderHost();

    expect(container.textContent).toContain("Desktop notifications");
    expect(container.textContent).toContain("managed by the OS");
    expect(container.textContent).not.toContain("Browser notifications");
    expect(
      container
        .querySelector<HTMLAnchorElement>("[data-om-hosted-header] a")
        ?.getAttribute("href"),
    ).toBe("/");
  });
});
