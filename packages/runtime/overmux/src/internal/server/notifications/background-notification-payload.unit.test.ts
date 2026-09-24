import { notificationEventSchema } from "../../shared/index";
import { describe, expect, it } from "vitest";

import { createBackgroundNotificationPayload } from "./background-notification-payload";

describe("background notification payload", () => {
  it("fits large Unicode payloads while preserving the notification contract", () => {
    const payload = createBackgroundNotificationPayload({
      body: "🚀".repeat(2_048),
      open: { link: "/agents/one" },
      title: "Task finished",
    });
    const parsed = notificationEventSchema.parse(JSON.parse(payload));

    expect(new TextEncoder().encode(payload).byteLength).toBeLessThanOrEqual(
      3_800,
    );
    expect(parsed.notification.title).toBe("Task finished");
    expect(parsed.notification.open).toEqual({ link: "/agents/one" });
    expect(parsed.notification.body?.endsWith("🚀")).toBe(true);

    const constrained = createBackgroundNotificationPayload({
      open: { link: `/${"a".repeat(4_095)}` },
      title: "🚀".repeat(2_048),
    });
    const constrainedNotification = notificationEventSchema.parse(
      JSON.parse(constrained),
    ).notification;
    expect(
      new TextEncoder().encode(constrained).byteLength,
    ).toBeLessThanOrEqual(3_800);
    expect(constrainedNotification.title.endsWith("🚀")).toBe(true);
  });
});
