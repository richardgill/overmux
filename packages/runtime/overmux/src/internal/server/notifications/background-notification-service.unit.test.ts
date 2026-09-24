import { describe, expect, it, vi } from "vitest";

import { createBackgroundNotificationService } from "./background-notification-service";
import type { BackgroundNotificationStore } from "./background-notification-store";

const subscription = (endpoint: string) => ({
  endpoint,
  expirationTime: null,
  keys: { auth: "auth-key", p256dh: "p256-key" },
});

const createStore = (subscriptions: ReturnType<typeof subscription>[]) => {
  const removeSubscription = vi.fn().mockResolvedValue(undefined);
  const store: BackgroundNotificationStore = {
    getOrCreateKeys: vi.fn().mockResolvedValue({
      privateKey: "private-key",
      publicKey: "public-key",
    }),
    listSubscriptions: vi.fn().mockResolvedValue(
      subscriptions.map((entry, index) => ({
        sessionId: `session-${index}`,
        subscription: entry,
      })),
    ),
    removeSessionSubscriptions: vi.fn(),
    removeSubscription,
    upsertSubscription: vi.fn(),
  };
  return { removeSubscription, store };
};

const sendFunction = (mock: ReturnType<typeof vi.fn>) =>
  mock as unknown as typeof import("web-push").sendNotification;

describe("background notification delivery", () => {
  it("does not create signing keys until background delivery is needed", async () => {
    const { store } = createStore([]);

    await createBackgroundNotificationService({ store }).send({
      title: "Finished",
    });

    expect(store.getOrCreateKeys).not.toHaveBeenCalled();
  });

  it("enables a validated subscription without creating signing keys", async () => {
    const { store } = createStore([]);
    const enabled = subscription("https://push.test/enabled");

    const service = createBackgroundNotificationService({ store });
    await service.enable("session-a", enabled);
    await service.disableSessions(new Set(["session-a"]));

    expect(store.getOrCreateKeys).not.toHaveBeenCalled();
    expect(store.upsertSubscription).toHaveBeenCalledWith("session-a", enabled);
    expect(store.removeSessionSubscriptions).toHaveBeenCalledWith(
      new Set(["session-a"]),
    );
  });

  it("does not deliver subscriptions owned by expired authentication sessions", async () => {
    const { store } = createStore([
      subscription("https://push.test/expired-session"),
    ]);
    const sendWebPush = vi.fn();

    await createBackgroundNotificationService({
      isSessionActive: async () => false,
      sendWebPush: sendFunction(sendWebPush),
      store,
    }).send({ title: "Finished" });

    expect(sendWebPush).not.toHaveBeenCalled();
  });

  it("isolates provider failures and removes expired endpoints", async () => {
    const { removeSubscription, store } = createStore([
      subscription("https://push.test/expired"),
      subscription("https://push.test/failing"),
      subscription("https://push.test/delivered"),
    ]);
    const sendWebPush = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 410 })
      .mockRejectedValueOnce({ statusCode: 400 })
      .mockResolvedValueOnce({});

    await createBackgroundNotificationService({
      sendWebPush: sendFunction(sendWebPush),
      store,
    }).send({ title: "Finished" });

    expect(sendWebPush).toHaveBeenCalledTimes(3);
    expect(removeSubscription).toHaveBeenCalledOnce();
    expect(removeSubscription).toHaveBeenCalledWith(
      "https://push.test/expired",
    );
  });
});
