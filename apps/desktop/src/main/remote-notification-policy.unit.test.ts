import { describe, expect, test as testCases } from "vitest";

import { isActiveRemoteMainFrame } from "./remote-notification-policy.js";

const activeWebContents = {
  mainFrame: { url: "https://overmux.test/workspace" },
};
const remoteView = { webContents: activeWebContents };
const validEvent = {
  sender: activeWebContents,
  senderFrame: activeWebContents.mainFrame,
};

const rejectedEvents = [
  { ...validEvent, sender: { mainFrame: validEvent.senderFrame } },
  { ...validEvent, senderFrame: { url: "https://overmux.test/frame" } },
  { ...validEvent, senderFrame: { url: "https://other.test/" } },
  { ...validEvent, senderFrame: null },
];

describe("remote notification policy", () => {
  testCases.each(rejectedEvents)(
    "rejects IPC outside the active remote main frame",
    (event) => {
      expect(
        isActiveRemoteMainFrame(
          event as never,
          remoteView as never,
          "https://overmux.test/",
        ),
      ).toBe(false);
    },
  );

  testCases.each([
    "https://overmux.test/",
    "https://overmux.test/different-path",
  ])("accepts the exact configured origin", (configuredUrl) => {
    expect(
      isActiveRemoteMainFrame(
        validEvent as never,
        remoteView as never,
        configuredUrl,
      ),
    ).toBe(true);
  });
});
