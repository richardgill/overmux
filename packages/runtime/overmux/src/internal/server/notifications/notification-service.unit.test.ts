import { describe, expect, it, vi } from "vitest";

import type { BackgroundNotificationService } from "./background-notification-service";
import { createNotificationService } from "./notification-service";

const createBackgroundNotifications = (): BackgroundNotificationService => ({
  disable: vi.fn(),
  disableSessions: vi.fn(),
  enable: vi.fn(),
  publicKey: vi.fn(),
  send: vi.fn(),
});

describe("notification service", () => {
  it("keeps background delivery independent from a live adapter failure", async () => {
    const backgroundNotifications = createBackgroundNotifications();
    const notifications = createNotificationService({
      backgroundNotifications,
    });
    notifications.attachLiveDelivery(() => {
      throw new Error("socket failed");
    });

    await notifications.send({ title: "Finished" });

    expect(backgroundNotifications.send).toHaveBeenCalledWith({
      title: "Finished",
    });
  });

  it("keeps live delivery independent from a background failure", async () => {
    const backgroundNotifications = createBackgroundNotifications();
    const deliverLive = vi.fn();
    vi.mocked(backgroundNotifications.send).mockRejectedValueOnce(
      new Error("push failed"),
    );
    const notifications = createNotificationService({
      backgroundNotifications,
    });
    notifications.attachLiveDelivery(deliverLive);

    expect(() => notifications.attachLiveDelivery(vi.fn())).toThrow(
      "Live delivery is already attached",
    );

    await notifications.send({ title: "Finished" });

    expect(deliverLive).toHaveBeenCalledWith({ title: "Finished" });
  });
});
