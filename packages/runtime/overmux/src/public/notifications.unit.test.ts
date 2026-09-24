import { describe, expect, it, test as testCases } from "vitest";

import { notificationSchema } from "./notifications";

const invalidLinks = [
  "//elsewhere.test",
  "file:///tmp/notification",
  "/\\elsewhere.test",
  "/%5celsewhere.test",
  "/%2f%2felsewhere.test",
  "/safe%00unsafe",
];

describe("notifications", () => {
  it("accepts relative and HTTP links", () => {
    expect(
      notificationSchema.parse({
        open: { link: "/workspaces/main" },
        title: "Finished",
      }),
    ).toEqual({ open: { link: "/workspaces/main" }, title: "Finished" });
    expect(
      notificationSchema.safeParse({
        open: { link: "https://github.com/example/repository" },
        title: "Finished",
      }).success,
    ).toBe(true);
  });

  testCases.each(invalidLinks)("rejects unsafe link %s", (link) => {
    expect(
      notificationSchema.safeParse({ open: { link }, title: "Finished" })
        .success,
    ).toBe(false);
  });
});
