import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authApi = vi.hoisted(() => ({
  getAuthState: vi.fn(),
  login: vi.fn(),
}));

vi.mock("./auth-api", () => authApi);

import { AuthShell } from "./auth-shell";

const roots: Root[] = [];
const containers: HTMLElement[] = [];

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, "", "/login");
  authApi.getAuthState.mockResolvedValue({ authenticated: false });
});

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  containers.splice(0).forEach((container) => container.remove());
  vi.resetAllMocks();
});

const render = async (props: React.ComponentProps<typeof AuthShell> = {}) => {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<AuthShell {...props} />));
  return container;
};

describe("AuthShell", () => {
  it("shows an accessible invalid-code error", async () => {
    authApi.login.mockResolvedValue({ status: "invalid" });
    const container = await render();
    const form = container.querySelector("form")!;
    const input = container.querySelector("input")!;

    input.value = "ABCD-EFGH";
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(authApi.login).toHaveBeenCalledWith(
      { code: "ABCD-EFGH" },
      expect.any(AbortSignal),
    );
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "That login code or link is invalid.",
    );
  });

  it("enables code entry after a ticket exchange fails without retrying it", async () => {
    authApi.login.mockResolvedValue({ status: "invalid" });

    const container = await render({ ticket: "secret" });

    expect(authApi.login).toHaveBeenCalledOnce();
    expect(container.querySelector("input")?.disabled).toBe(false);
    expect(container.querySelector("button")?.disabled).toBe(false);
  });

  it("aborts a pending ticket exchange when unmounted", async () => {
    authApi.login.mockImplementation(() => new Promise(() => undefined));

    await render({ ticket: "secret" });
    const signal = authApi.login.mock.calls[0]?.[1] as AbortSignal;
    const root = roots.pop()!;
    await act(async () => root.unmount());

    expect(signal.aborted).toBe(true);
  });

  it("explains an expired session before another login attempt", async () => {
    window.history.replaceState(null, "", "/login?reason=session-expired");

    const container = await render();

    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Your session expired or was revoked. Sign in again.",
    );
  });
});
