import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test as testCases,
  vi,
} from "vitest";

import { PiMessageComposer, type PiMessageComposerProps } from "./react";

let container: HTMLDivElement;
let root: Root;

const query = <ElementType extends Element>(selector: string) => {
  const element = container.querySelector<ElementType>(selector);
  if (!element) {
    throw new Error(`Missing test element: ${selector}`);
  }
  return element;
};

const renderComposer = async (
  sendMessage: PiMessageComposerProps["sendMessage"],
  props: Partial<PiMessageComposerProps> = {},
) => {
  await act(async () => {
    root.render(
      <PiMessageComposer available busy sendMessage={sendMessage} {...props} />,
    );
  });
};

const changeDraft = (draft: string) => {
  const textarea = query<HTMLTextAreaElement>("textarea");
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  if (!setValue) {
    throw new Error("Missing textarea value setter");
  }
  act(() => {
    setValue.call(textarea, draft);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const sendButton = (deliverAs: "followUp" | "steer") =>
  query<HTMLButtonElement>(
    deliverAs === "followUp"
      ? ".om-pi-composer-follow-up"
      : ".om-pi-composer-send",
  );

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Pi message composer feedback", () => {
  testCases("renders only Send while idle", async () => {
    await renderComposer(async () => undefined, { busy: false });
    expect(container.querySelector(".om-pi-composer-stop")).toBeNull();
    expect(container.querySelector(".om-pi-composer-follow-up")).toBeNull();
    expect(query(".om-pi-composer-send").textContent).toContain("Send");
  });

  testCases("stops with ordered busy controls and feedback", async () => {
    let resolveStop: () => void = () => undefined;
    const stop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveStop = resolve;
        }),
    );
    await renderComposer(async () => undefined, { stop });
    const controls = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".om-pi-composer-box button",
      ),
    ];
    expect(controls[0]?.classList).toContain("om-pi-composer-stop-inline");
    expect(controls.map((button) => button.textContent)).toEqual([
      "",
      "Follow up",
      "Send",
    ]);
    expect(controls[0]?.getAttribute("aria-label")).toBe("Stop Pi");
    expect(controls[0]?.querySelector("svg.lucide-square")).not.toBeNull();
    act(() => controls[0]?.click());
    expect(stop).toHaveBeenCalledOnce();
    expect(controls[0]?.getAttribute("aria-label")).toBe("Stopping Pi");
    expect(controls[1]?.hasAttribute("disabled")).toBe(true);
    resolveStop();
    await act(async () => undefined);
  });

  testCases("moves Stop beside visible send actions", async () => {
    await renderComposer(async () => undefined, {
      stop: async () => undefined,
    });
    act(() => query<HTMLTextAreaElement>("textarea").focus());

    expect(container.querySelector(".om-pi-composer-stop-inline")).toBeNull();
    expect(
      container
        .querySelector(".om-pi-composer-stop")
        ?.parentElement?.classList.contains("om-pi-composer-actions"),
    ).toBe(true);
  });

  testCases("reports a stop failure", async () => {
    await renderComposer(async () => undefined, {
      stop: async () => Promise.reject(new Error("Stop failed")),
    });
    await act(async () =>
      query<HTMLButtonElement>(".om-pi-composer-stop").click(),
    );
    expect(query("[role='alert']").textContent).toBe("Stop failed");
  });

  testCases.each([
    {
      deliverAs: "steer" as const,
      delivery: "immediate" as const,
      title: "immediate",
    },
    {
      deliverAs: "steer" as const,
      delivery: "steer" as const,
      title: "steer",
    },
    {
      deliverAs: "followUp" as const,
      delivery: "followUp" as const,
      title: "follow-up",
    },
  ])(
    "renders no notice after $title delivery",
    async ({ deliverAs, delivery }) => {
      const sendMessage = vi.fn(async () => ({ delivery }));
      await renderComposer(sendMessage);
      changeDraft("Try this");

      await act(async () => sendButton(deliverAs).click());

      expect(sendMessage).toHaveBeenCalledWith({
        deliverAs,
        message: "Try this",
      });
      expect(query<HTMLTextAreaElement>("textarea").value).toBe("");
      expect(container.querySelector("output")).toBeNull();
      expect(container.textContent).not.toContain("Message sent.");
      expect(container.textContent).not.toContain("Steer queued.");
      expect(container.textContent).not.toContain("Follow-up queued.");
    },
  );

  testCases(
    "keeps a failure during retry and clears it after success",
    async () => {
      let resolveRetry: () => void = () => undefined;
      const retry = new Promise<void>((resolve) => {
        resolveRetry = resolve;
      });
      const sendMessage = vi
        .fn<PiMessageComposerProps["sendMessage"]>()
        .mockRejectedValueOnce(new Error("First failure"))
        .mockReturnValueOnce(retry);
      await renderComposer(sendMessage);
      changeDraft("Retry me");
      await act(async () => sendButton("steer").click());

      expect(query<HTMLElement>("[role='alert']").textContent).toBe(
        "First failure",
      );
      act(() => sendButton("steer").click());

      expect(sendButton("steer").textContent).toBe("Sending…");
      expect(query<HTMLElement>("[role='alert']").textContent).toBe(
        "First failure",
      );

      resolveRetry();
      await act(async () => retry);

      expect(container.querySelector("[role='alert']")).toBeNull();
      expect(query<HTMLTextAreaElement>("textarea").value).toBe("");
    },
  );

  testCases(
    "replaces the current failure when a retry also fails",
    async () => {
      const sendMessage = vi
        .fn<PiMessageComposerProps["sendMessage"]>()
        .mockRejectedValueOnce(new Error("First failure"))
        .mockRejectedValueOnce(new Error("Retry failure"));
      await renderComposer(sendMessage);
      changeDraft("Retry me");
      await act(async () => sendButton("steer").click());
      await act(async () => sendButton("steer").click());

      expect(query<HTMLElement>("[role='alert']").textContent).toBe(
        "Retry failure",
      );
      expect(query<HTMLTextAreaElement>("textarea").value).toBe("Retry me");
    },
  );
});
