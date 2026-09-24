import { describe, expect, it, vi } from "vitest";

import type { BackgroundNotificationService } from "../notifications/background-notification-service";
import { createAuthenticatedTestHttpApp } from "./authenticated-http-app-test-helper";

const subscription = {
  endpoint: "https://push.test/browser",
  expirationTime: null,
  keys: { auth: "auth-key", p256dh: "p256-key" },
};

const createService = (): BackgroundNotificationService => ({
  disable: vi.fn(),
  disableSessions: vi.fn(),
  enable: vi.fn(),
  publicKey: vi.fn().mockResolvedValue("public-key"),
  send: vi.fn(),
});

const createApp = (backgroundNotifications: BackgroundNotificationService) =>
  createAuthenticatedTestHttpApp({
    backgroundNotifications,
    runtime: {} as never,
  });

describe("background notification HTTP contracts", () => {
  it("enables and disables a subscription owned by the authenticated session", async () => {
    const backgroundNotifications = createService();
    const app = createApp(backgroundNotifications);

    const keyResponse = await app.request(
      "https://overmux.test/api/background-notifications/public-key",
    );
    const enableResponse = await app.request(
      "https://overmux.test/api/background-notifications/subscription",
      {
        body: JSON.stringify(subscription),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      },
    );
    const disableResponse = await app.request(
      "https://overmux.test/api/background-notifications/subscription",
      {
        body: JSON.stringify({ endpoint: subscription.endpoint }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      },
    );

    expect(await keyResponse.json()).toEqual({ publicKey: "public-key" });
    expect(enableResponse.status).toBe(200);
    expect(disableResponse.status).toBe(200);
    expect(backgroundNotifications.enable).toHaveBeenCalledWith(
      "test-session",
      subscription,
    );
    expect(backgroundNotifications.disable).toHaveBeenCalledWith(
      subscription.endpoint,
    );
  });

  it("rejects malformed subscription payloads", async () => {
    const backgroundNotifications = createService();
    const app = createApp(backgroundNotifications);
    const response = await app.request(
      "https://overmux.test/api/background-notifications/subscription",
      {
        body: JSON.stringify({ endpoint: "not-an-endpoint" }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      },
    );

    expect(response.status).toBe(400);
    expect(backgroundNotifications.enable).not.toHaveBeenCalled();
  });
});
