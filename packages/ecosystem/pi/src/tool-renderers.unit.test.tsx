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

import { PiConversation, type ToolRenderer } from "./react";

type Snapshot = Parameters<
  Parameters<
    ComponentProps<typeof PiConversation>["conversation"]["subscribe"]
  >[0]
>[0];

type ToolName = "bash" | "bash_process" | "edit" | "read" | "write";

const sendMessage = async () => undefined;

const snapshotWith = (
  toolName: string,
  arguments_: unknown,
  details?: unknown,
): Snapshot => ({
  agentAvailable: true,
  entries: [
    {
      content: [
        {
          arguments: arguments_,
          name: toolName,
          tool: {
            result: {
              content: [{ text: "tool output", type: "text" }],
              details,
              isError: false,
              toolCallId: "call-1",
              toolName,
            },
            status: "success",
          },
          type: "toolCall",
        },
      ],
      id: "entry-1",
      role: "assistant",
      source: "live",
      status: "complete",
    },
  ],
  status: "idle",
});

const conversationFor = (snapshot: Snapshot) => ({
  status: "open" as const,
  subscribe: (listener: (value: Snapshot) => void) => {
    listener(snapshot);
    return () => undefined;
  },
});

describe("Pi tool renderers", () => {
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
    ["bash", { command: "git status" }, undefined, "git status"],
    ["bash_process", { action: "peek", pgid: 42 }, undefined, "peek · 42"],
    [
      "read",
      { limit: 20, offset: 10, path: "src/file.ts" },
      undefined,
      "src/file.ts:10-29",
    ],
    [
      "edit",
      {
        edits: [{ newText: "request value", oldText: "old request value" }],
        path: "src/file.ts",
      },
      {
        diff: " 1 unchanged\n-2 old value\n+2 new value",
        patch:
          "diff --git a/src/file.ts b/src/file.ts\n--- a/src/file.ts\n+++ b/src/file.ts\n@@ -2 +2 @@\n-old value\n+new value",
      },
      "src/file.ts",
    ],
    [
      "write",
      { content: "file contents", path: "src/file.ts" },
      undefined,
      "src/file.ts",
    ],
  ] satisfies [ToolName, unknown, unknown, string][])(
    "renders the %s tool with a semantic summary",
    async (toolName, arguments_, details, summary) => {
      await act(async () => {
        root.render(
          <PiConversation
            conversation={conversationFor(
              snapshotWith(toolName, arguments_, details),
            )}
            sendMessage={sendMessage}
          />,
        );
      });

      const disclosure = container.querySelector(".om-pi-tool-details");
      if (toolName === "edit" || toolName === "write") {
        expect(disclosure?.tagName).toBe("DIV");
        expect(disclosure?.querySelector("summary")).toBeNull();
        expect(disclosure?.textContent).toContain(summary);
      } else if (toolName === "bash") {
        expect(disclosure?.tagName).toBe("DIV");
        expect(disclosure?.querySelector(".om-pi-tool-kind")?.textContent).toBe(
          "bash",
        );
        expect(
          disclosure?.querySelector<HTMLDetailsElement>(".om-pi-tool-section")
            ?.open,
        ).toBe(false);
        expect(disclosure?.querySelector("summary")?.textContent).toContain(
          "Logs",
        );
        expect(
          disclosure?.querySelector(".om-pi-tool-section summary svg"),
        ).not.toBeNull();
        expect(
          disclosure?.querySelector(".om-pi-tool-command")?.textContent,
        ).toBe("$ git status");
      } else {
        expect((disclosure as HTMLDetailsElement | null)?.open).toBe(false);
        expect(disclosure?.querySelector("summary")?.textContent).toContain(
          summary,
        );
      }
      expect(
        disclosure
          ?.querySelector(".om-pi-tool-status")
          ?.getAttribute("aria-label"),
      ).toBe("Tool success");
      expect(container.textContent).not.toContain("success");
      expect(container.textContent).not.toContain('"path"');
      if (toolName === "read" || toolName === "write") {
        expect(
          disclosure?.querySelector(".om-pi-tool-status")?.textContent,
        ).toBe(toolName);
      }
      if (toolName === "edit") {
        expect(
          disclosure?.querySelector(".om-pi-tool-status")?.textContent,
        ).toBe("edit");
        expect(disclosure?.querySelector(".om-pi-tool-path")?.textContent).toBe(
          "src/file.ts",
        );
        expect(disclosure?.querySelector(".om-pi-tool-diff")).not.toBeNull();
        expect(container.textContent).not.toContain("request value");
        expect(container.textContent).not.toContain("tool output");
      }
    },
  );

  testCases("hides anonymous partial tool arguments", async () => {
    const snapshot = snapshotWith("", '{"path":"secret"');
    const block = snapshot.entries[0]?.content[0];
    if (!block?.tool) {
      throw new Error("expected tool");
    }
    block.name = undefined;
    block.tool = { status: "pending" };
    await act(async () =>
      root.render(
        <PiConversation
          conversation={conversationFor(snapshot)}
          sendMessage={sendMessage}
        />,
      ),
    );
    expect(container.textContent).toContain("Running tool…");
    expect(container.textContent).not.toContain("secret");
  });

  testCases("renders writes as additions without boilerplate", async () => {
    const snapshot = snapshotWith("write", {
      content: "one\ntwo\n",
      path: "file.ts",
    });
    await act(async () =>
      root.render(
        <PiConversation
          conversation={conversationFor(snapshot)}
          sendMessage={sendMessage}
        />,
      ),
    );
    expect(container.querySelector(".om-pi-tool-diff")).not.toBeNull();
    expect(container.textContent).not.toContain("Successfully wrote");
  });

  testCases("keeps the 200th trailing-newline write line", async () => {
    const content = Array.from(
      { length: 201 },
      (_, index) => `line-${index + 1}`,
    )
      .join("\n")
      .concat("\n");
    await act(async () =>
      root.render(
        <PiConversation
          conversation={conversationFor(
            snapshotWith("write", { content, path: "long.ts" }),
          )}
          sendMessage={sendMessage}
        />,
      ),
    );
    const diff = container.querySelector(".om-pi-tool-diff");
    expect(diff?.getAttribute("data-patch")).toContain("line-200");
    expect(diff?.getAttribute("data-patch")).not.toContain("line-201");
  });

  testCases("renders empty writes without additions", async () => {
    await act(async () =>
      root.render(
        <PiConversation
          conversation={conversationFor(
            snapshotWith("write", { content: "", path: "empty.ts" }),
          )}
          sendMessage={sendMessage}
        />,
      ),
    );
    expect(
      container.querySelector(".om-pi-tool-diff")?.textContent,
    ).not.toContain("@@");
  });

  testCases(
    "collapses write errors into a wrapping error section",
    async () => {
      const snapshot = snapshotWith("write", { content: "x", path: "file.ts" });
      const result = snapshot.entries[0]?.content[0]?.tool?.result;
      if (!result) {
        throw new Error("expected write result");
      }
      result.isError = true;
      result.content = [{ text: "write failed", type: "text" }];
      await act(async () =>
        root.render(
          <PiConversation
            conversation={conversationFor(snapshot)}
            sendMessage={sendMessage}
          />,
        ),
      );
      const section = container.querySelector<HTMLDetailsElement>(
        ".om-pi-tool-section",
      );
      expect(section?.open).toBe(false);
      expect(
        section?.querySelector(".om-pi-tool-error")?.textContent,
      ).toContain("write failed");
    },
  );

  testCases("collapses edit errors into a wrapping error section", async () => {
    const snapshot = snapshotWith("edit", { path: "src/file.ts" });
    const block = snapshot.entries[0]?.content[0];
    if (!block?.tool?.result) {
      throw new Error("expected edit result");
    }
    block.tool.result.isError = true;
    block.tool.result.content = [
      {
        text: "Found 2 occurrences of edits[1] in a/very/long/path.ts",
        type: "text",
      },
    ];
    await act(async () => {
      root.render(
        <PiConversation
          conversation={conversationFor(snapshot)}
          sendMessage={sendMessage}
        />,
      );
    });

    const section = container.querySelector<HTMLDetailsElement>(
      ".om-pi-tool-section",
    );
    expect(section?.open).toBe(false);
    expect(section?.querySelector("summary")?.textContent).toContain("Error");
    expect(section?.querySelector(".om-pi-tool-error")?.textContent).toContain(
      "Found 2 occurrences",
    );
  });

  testCases("keeps pending and failed tool states visible", async () => {
    const pending = snapshotWith("bash", { command: "sleep 1" });
    const block = pending.entries[0]?.content[0];
    if (!block?.tool) {
      throw new Error("expected tool call");
    }
    block.tool = { status: "pending" };
    await act(async () => {
      root.render(
        <PiConversation
          conversation={conversationFor(pending)}
          sendMessage={sendMessage}
        />,
      );
    });
    expect(
      container.querySelector<HTMLDetailsElement>(".om-pi-tool-section")?.open,
    ).toBe(true);
    expect(
      container.querySelector(".om-pi-tool-status")?.getAttribute("aria-label"),
    ).toBe("Tool pending");

    const failed = snapshotWith("bash", { command: "false" });
    const failedBlock = failed.entries[0]?.content[0];
    if (!failedBlock?.tool?.result) {
      throw new Error("expected tool result");
    }
    failedBlock.tool.result.isError = true;
    await act(async () => {
      root.render(
        <PiConversation
          conversation={conversationFor(failed)}
          sendMessage={sendMessage}
        />,
      );
    });
    expect(
      container.querySelector<HTMLDetailsElement>(".om-pi-tool-section")?.open,
    ).toBe(true);
    expect(
      container.querySelector(".om-pi-tool-status")?.getAttribute("aria-label"),
    ).toBe("Tool error");
  });

  testCases("preserves explicit expansion across status updates", async () => {
    const first = snapshotWith("bash", { command: "sleep 1" });
    const firstBlock = first.entries[0]?.content[0];
    if (!firstBlock?.tool) {
      throw new Error("expected tool call");
    }
    firstBlock.tool = { status: "pending" };
    const updated = structuredClone(first);
    const block = updated.entries[0]?.content[0];
    if (!block?.tool) {
      throw new Error("expected tool call");
    }
    block.tool = {
      result: {
        content: [{ text: "updated output", type: "text" }],
        isError: false,
        toolCallId: "call-1",
        toolName: "bash",
      },
      status: "success",
    };
    await act(async () => {
      root.render(
        <PiConversation
          conversation={conversationFor(first)}
          sendMessage={sendMessage}
        />,
      );
    });
    const summary = container.querySelector(
      ".om-pi-tool-section summary",
    ) as HTMLElement;
    await act(async () => summary.click());
    await act(async () => summary.click());
    expect(
      container.querySelector<HTMLDetailsElement>(".om-pi-tool-section")?.open,
    ).toBe(true);
    await act(async () => {
      root.render(
        <PiConversation
          conversation={conversationFor(updated)}
          sendMessage={sendMessage}
        />,
      );
    });
    expect(
      container.querySelector<HTMLDetailsElement>(".om-pi-tool-section")?.open,
    ).toBe(true);
  });

  testCases(
    "previews streaming thinking then collapses completed thinking",
    async () => {
      const streaming: Snapshot = {
        agentAvailable: true,
        entries: [
          {
            content: [
              {
                thinking: "Inspecting the current implementation",
                type: "thinking",
              },
            ],
            id: "entry-1",
            role: "assistant",
            source: "live",
            status: "pending",
          },
        ],
        status: "busy",
      };
      const completed = structuredClone(streaming);
      const entry = completed.entries[0];
      if (!entry) {
        throw new Error("expected thinking entry");
      }
      entry.status = "complete";
      await act(async () => {
        root.render(
          <PiConversation
            conversation={conversationFor(streaming)}
            sendMessage={sendMessage}
          />,
        );
      });
      const disclosure =
        container.querySelector<HTMLDetailsElement>(".om-pi-thinking");
      expect(disclosure?.open).toBe(true);
      expect(disclosure?.querySelector("summary")?.textContent).toContain(
        "Inspecting",
      );
      await act(async () => {
        root.render(
          <PiConversation
            conversation={conversationFor(completed)}
            sendMessage={sendMessage}
          />,
        );
      });
      expect(disclosure?.open).toBe(false);
      expect(disclosure?.querySelector("summary")?.textContent).toBe(
        "Thinking…",
      );
    },
  );

  testCases("uses the generic renderer for unconfigured tools", async () => {
    await act(async () => {
      root.render(
        <PiConversation
          conversation={conversationFor(
            snapshotWith("other_tool", { value: 1 }),
          )}
          sendMessage={sendMessage}
        />,
      );
    });

    expect(container.textContent).toContain("other_tool");
    expect(container.textContent).toContain('"value": 1');
  });

  testCases("merges explicit renderers over the defaults", async () => {
    const renderer = vi.fn<ToolRenderer>(() => <p>custom bash</p>);
    await act(async () => {
      root.render(
        <PiConversation
          conversation={conversationFor(
            snapshotWith("bash", { command: "ignored" }),
          )}
          renderers={{ bash: renderer }}
          sendMessage={sendMessage}
        />,
      );
    });

    expect(renderer).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("custom bash");
    expect(container.textContent).not.toContain("ignored");
  });

  testCases("renders plain and highlighted fenced markdown", async () => {
    const snapshot: Snapshot = {
      agentAvailable: true,
      entries: [
        {
          content: [
            {
              text: "```unknown\nplain code\n```\n\n```ts\nconst answer = 42;\nconst next = answer + 1;\n```",
              type: "text",
            },
          ],
          id: "entry-1",
          role: "assistant",
          source: "live",
          status: "complete",
        },
      ],
      status: "idle",
    };
    await act(async () => {
      root.render(
        <PiConversation
          conversation={conversationFor(snapshot)}
          sendMessage={sendMessage}
        />,
      );
    });

    expect(container.querySelectorAll("pre code")).toHaveLength(2);
    expect(container.querySelector(".language-unknown")).not.toBeNull();
    await vi.waitFor(() =>
      expect(container.querySelector(".om-pi-code-highlighted")).not.toBeNull(),
    );
    const highlighted = container.querySelector(".om-pi-code-highlighted");
    expect(highlighted?.textContent).toBe(
      "const answer = 42;\nconst next = answer + 1;",
    );
    expect(highlighted?.querySelectorAll(".om-pi-code-line")).toHaveLength(2);

    const updated = structuredClone(snapshot);
    const updatedBlock = updated.entries[0]?.content[0];
    if (!updatedBlock) {
      throw new Error("expected markdown block");
    }
    updatedBlock.text = "```ts\nconst updated = true;\n```";
    await act(async () => {
      root.render(
        <PiConversation
          conversation={conversationFor(updated)}
          sendMessage={sendMessage}
        />,
      );
    });

    expect(container.textContent).toContain("const updated = true;");
    expect(container.textContent).not.toContain("const answer = 42;");
  });
});
