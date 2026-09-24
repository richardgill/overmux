import type { ITerminalOptions } from "@overmux/xterm-fork";

// Opens valid file, HTTP, and HTTPS OSC 8 destinations without confirmation, subject to browser restrictions.
// Overmux deep links are opened through the registered platform handler.
// Inside Overmux, the runtime intercepts same-instance anchor activation first.
export const defaultLinkHandler: NonNullable<ITerminalOptions["linkHandler"]> =
  {
    allowNonHttpProtocols: true,
    activate: (_event, text) => {
      let url: URL;
      try {
        url = new URL(text);
      } catch {
        return;
      }
      if (!["file:", "http:", "https:", "overmux:"].includes(url.protocol)) {
        return;
      }
      if (url.protocol === "overmux:") {
        // Use the same activation boundary as ordinary HTML links, without depending
        // on runtime internals. Keep raw text for validation before URL normalization.
        const anchor = document.createElement("a");
        anchor.href = text;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.hidden = true;
        document.body.append(anchor);
        try {
          anchor.click();
        } finally {
          anchor.remove();
        }
        return;
      }
      window.open(url.href, "_blank", "noopener,noreferrer");
    },
  };
