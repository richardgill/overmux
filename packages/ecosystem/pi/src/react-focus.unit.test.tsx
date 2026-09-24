// @vitest-environment happy-dom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test as testCases,
} from "vitest";

import { PiConversation } from "./react";

type Snapshot = Parameters<
  Parameters<
    ComponentProps<typeof PiConversation>["conversation"]["subscribe"]
  >[0]
>[0];

const snapshot: Snapshot = {
  agentAvailable: true,
  entries: [],
  status: "idle",
};

const sendMessage = async () => undefined;

describe("Pi conversation focus", () => {
  let container: HTMLDivElement;
  let listener: (snapshot: Snapshot) => void;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  testCases(
    "focuses the composer when active Pi becomes available",
    async () => {
      const conversation = {
        status: "open" as const,
        subscribe: (next: (value: Snapshot) => void) => {
          listener = next;
          return () => undefined;
        },
      };

      await act(async () => {
        root.render(
          <PiConversation
            autoFocus
            conversation={conversation}
            sendMessage={sendMessage}
          />,
        );
      });
      await act(async () => listener(snapshot));

      expect(document.activeElement).toBe(
        container.querySelector(".om-pi-composer-textarea"),
      );
    },
  );
});
