import { WebLinksAddon } from "@xterm/addon-web-links";
import type {
  IBufferRange,
  ITerminalAddon,
  Terminal,
} from "@overmux/xterm-fork";

// Copied from https://github.com/xtermjs/xterm.js/blob/6.0.0/addons/addon-web-links/src/WebLinksAddon.ts
const detectedUrl =
  /(?:https?|overmux):[/]{2}[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~[\]`()<>]/i;

type HoveredLink = { range: IBufferRange; uri: string };

const allowsLink = (
  handler: Terminal["options"]["linkHandler"],
  uri: string,
) => {
  const protocol = new URL(uri).protocol;
  return (
    protocol === "http:" ||
    protocol === "https:" ||
    handler?.allowNonHttpProtocols
  );
};

// Bridges WebLinksAddon callbacks to terminal.options.linkHandler so the same
// mutable handler controls both detected plain-text URLs and core OSC 8 links.
// Plain text links are detected separately from OSC 8 links, which xterm core handles.
// The upstream addon exposes ranges only on hover. xterm hovers before activating;
// retain that range until leave/disposal rather than inventing coordinates for handlers.
export const createWebLinksAddon = (): ITerminalAddon => {
  let webLinks: WebLinksAddon | undefined;
  let hovered: HoveredLink | undefined;
  return {
    activate: (terminal) => {
      const hover = (event: MouseEvent, uri: string, range: IBufferRange) => {
        const current = terminal.options.linkHandler;
        if (!current || !allowsLink(current, uri)) {
          return;
        }
        hovered = { range, uri };
        current.hover?.(event, uri, range);
      };
      const leave = (event: MouseEvent, uri: string) => {
        const previous = hovered;
        hovered = undefined;
        const current = terminal.options.linkHandler;
        if (previous?.uri === uri && current && allowsLink(current, uri)) {
          current.leave?.(event, uri, previous.range);
        }
      };
      webLinks = new WebLinksAddon(
        (event, uri) => {
          const current = terminal.options.linkHandler;
          if (
            !current ||
            !hovered ||
            hovered.uri !== uri ||
            !allowsLink(current, uri)
          ) {
            return;
          }
          current.activate(event, uri, hovered.range);
        },
        { hover, leave, urlRegex: detectedUrl },
      );
      webLinks.activate(terminal);
    },
    dispose: () => {
      hovered = undefined;
      webLinks?.dispose();
      webLinks = undefined;
    },
  };
};
