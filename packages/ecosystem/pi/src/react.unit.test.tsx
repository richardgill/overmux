import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import * as piReact from "./react";
import { PiConversation, PiMessageComposer } from "./react";

const stream = {
  status: "opening" as const,
  subscribe: () => () => undefined,
};

const sendMessage = vi.fn(async () => ({ delivery: "steer" as const }));
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("Pi browser UI", () => {
  it("exports only reusable conversation components", () => {
    expect(Object.keys(piReact).sort()).toEqual([
      "PiConversation",
      "PiMessageComposer",
      "defaultToolRenderers",
    ]);
    expect(Object.keys(piReact.defaultToolRenderers).sort()).toEqual([
      "bash",
      "bash_process",
      "edit",
      "read",
      "write",
    ]);
  });

  it("renders scoped root and state selectors", () => {
    const markup = renderToStaticMarkup(
      <PiConversation
        className="conversation"
        conversation={stream}
        sendMessage={sendMessage}
        style={{ "--om-color-fg": "purple" }}
      />,
    );

    expect(markup).toContain("data-om-pi-conversation");
    expect(markup).toContain('data-om-agent-status="offline"');
    expect(markup).toContain("conversation");
    expect(markup).toContain("--om-color-fg:purple");
    expect(markup).toContain("Connecting to Pi…");
    expect(markup).toContain("Pi is offline");
  });

  it("renders a disabled composer when Pi is unavailable", () => {
    const markup = renderToStaticMarkup(
      <PiMessageComposer available={false} sendMessage={sendMessage} />,
    );

    expect(markup).toContain('placeholder="Pi is offline"');
    expect(markup).toContain("disabled");
    expect(markup).toContain('class="om-pi-visually-hidden"');
    expect(markup).toContain("lucide-send");
    expect(markup).toContain("Message Pi");
  });

  it("styles every structural and accessibility hook", () => {
    [
      ".om-pi-content-block",
      ".om-pi-visually-hidden",
      ".om-pi-markdown blockquote",
      ".om-pi-markdown :not(pre) > code",
      ".om-pi-markdown pre",
      "details.om-pi-tool-details",
      ".om-pi-tool-body",
      ".om-pi-tool-field",
      ".om-pi-composer-box:focus-within",
      ".om-pi-composer-send:disabled",
      ".om-pi-conversation-content > p.om-pi-muted",
    ].forEach((selector) => expect(styles).toContain(selector));
    expect(styles).toContain(":placeholder-shown:not(:focus)");
    expect(styles).toContain("--om-color-accent-fg");
  });

  it("allows grid children to shrink around long content", () => {
    expect(styles).toMatch(
      /:where\(\.om-pi-conversation-content > \*, \.om-pi-content-block > \*\) \{\s+min-inline-size: 0;/u,
    );
  });

  it("contains styles within conversation and composer roots", () => {
    expect(styles).toContain(
      "@scope ([data-om-pi-conversation], [data-om-pi-composer])",
    );
  });

  it("keeps responsive and forced-color presentation", () => {
    expect(styles).toContain("@media (width >= 40rem)");
    expect(styles).toContain("@media (forced-colors: active)");
    expect(styles).toContain("forced-color-adjust: auto");
  });
});
