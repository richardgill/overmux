// @vitest-environment happy-dom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test as testCases,
  vi,
} from "vitest";

import { PiConversation } from "./react";

type Snapshot = Parameters<
  Parameters<
    ComponentProps<typeof PiConversation>["conversation"]["subscribe"]
  >[0]
>[0];

const sendMessage = async () => undefined;

const conversationFor = (snapshot: Snapshot) => ({
  status: "open" as const,
  subscribe: (listener: (value: Snapshot) => void) => {
    listener(snapshot);
    return () => undefined;
  },
});

describe("Pi conversation metadata", () => {
  let container: HTMLDivElement;
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

  testCases.each([
    [
      {
        contextUsage: {
          contextWindow: 200_000,
          percent: 85.1,
          tokens: 170_100,
        },
        model: {
          id: "gpt-5.6-sol",
          name: "GPT-5.6 Sol",
          provider: "openai-codex",
        },
        thinkingLevel: "medium",
      },
      "gpt-5.6-sol · medium · ctx 170.1k/372.0k 45.7%",
    ],
    [
      {
        contextUsage: { contextWindow: 999, percent: 1, tokens: 999 },
        model: { id: "small", name: "Small", provider: "example" },
        thinkingLevel: "low",
      },
      "small · low · ctx 999/999 100.0%",
    ],
    [{ thinkingLevel: "high" }, "no-model · high"],
  ] satisfies [NonNullable<Snapshot["sessionMetadata"]>, string][])(
    "formats session metadata as %s",
    async (sessionMetadata, expected) => {
      await act(async () => {
        root.render(
          <PiConversation
            conversation={conversationFor({
              agentAvailable: true,
              entries: [],
              sessionMetadata,
              status: "idle",
            })}
            sendMessage={sendMessage}
          />,
        );
      });

      const metadata = container.querySelector(".om-pi-conversation-metadata");
      expect(metadata?.textContent).toBe(expected);
      expect(
        metadata?.previousElementSibling?.hasAttribute("data-om-pi-composer"),
      ).toBe(true);
    },
  );

  testCases("controls metadata and reports action failures", async () => {
    const setModel = vi.fn(async () => undefined);
    const setThinkingLevel = vi
      .fn<
        NonNullable<ComponentProps<typeof PiConversation>["setThinkingLevel"]>
      >()
      .mockRejectedValueOnce(new Error("No API key"))
      .mockResolvedValueOnce(undefined);
    const metadata = {
      model: { id: "gpt-5.6-sol", name: "Sol", provider: "openai-codex" },
      modelOptions: [
        { id: "gpt-5.6-sol", name: "Sol", provider: "openai-codex" },
      ],
      thinkingLevel: "medium",
    };
    await act(async () =>
      root.render(
        <PiConversation
          conversation={conversationFor({
            agentAvailable: true,
            entries: [],
            sessionMetadata: metadata,
            status: "idle",
          })}
          sendMessage={sendMessage}
          setModel={setModel}
          setThinkingLevel={setThinkingLevel}
        />,
      ),
    );
    const model = container.querySelector<HTMLSelectElement>(
      "[aria-label='Pi model']",
    )!;
    const thinking = container.querySelector<HTMLSelectElement>(
      "[aria-label='Pi thinking level']",
    )!;
    expect(model.value).toContain("gpt-5.6-sol");
    expect(model.textContent).toContain("gpt-5.6-sol");
    expect(thinking.value).toBe("medium");
    await act(async () =>
      thinking.dispatchEvent(new Event("change", { bubbles: true })),
    );
    expect(container.querySelector("[role='alert']")?.textContent).toBe(
      "No API key",
    );
    await act(async () =>
      thinking.dispatchEvent(new Event("change", { bubbles: true })),
    );
    expect(container.querySelector("[role='alert']")).toBeNull();
  });

  testCases(
    "omits the metadata line when a snapshot has no metadata",
    async () => {
      await act(async () => {
        root.render(
          <PiConversation
            conversation={conversationFor({
              agentAvailable: true,
              entries: [],
              status: "idle",
            })}
            sendMessage={sendMessage}
          />,
        );
      });

      expect(
        container.querySelector(".om-pi-conversation-metadata"),
      ).toBeNull();
      expect(container.textContent).toContain("Pi is ready");
      expect(container.textContent).toContain("No conversation yet.");
    },
  );
});
