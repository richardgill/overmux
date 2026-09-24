import { Terminal, type ILink, type ILinkHandler } from "@overmux/xterm-fork";
import { afterEach, expect, test as testCases, vi } from "vitest";

import { defaultLinkHandler } from "./default-link-handler";
import { createWebLinksAddon } from "./web-links";

const write = (terminal: Terminal, data: string) =>
  new Promise<void>((resolve) => terminal.write(data, resolve));

const linksAtFirstLine = async (
  url: string,
  linkHandler?: ILinkHandler | null,
) => {
  const terminal = new Terminal({ cols: 20, linkHandler });
  const register = vi.spyOn(terminal, "registerLinkProvider");
  terminal.loadAddon(createWebLinksAddon());
  await write(terminal, url);
  const provider = register.mock.calls[0]?.[0];
  if (!provider) {
    throw new Error("Web links addon did not register a link provider");
  }
  const links = await new Promise<ILink[]>((resolve) =>
    provider.provideLinks(1, (provided) => resolve(provided ?? [])),
  );
  const link = links[0];
  if (!link) {
    throw new Error("Web links addon did not detect the URL");
  }
  return { link, terminal };
};

const hoverAndActivate = (link: ILink, uri: string) => {
  const hover = new MouseEvent("mousemove");
  link.hover?.(hover, uri);
  const activate = new MouseEvent("click");
  link.activate(activate, uri);
  return { activate, hover };
};

afterEach(() => {
  vi.restoreAllMocks();
});

testCases(
  "detects and activates a wrapped Overmux link through the runtime anchor boundary",
  async () => {
    const url = "overmux://rich-work-4242/tmux/$71/@647/%25647";
    const { link, terminal } = await linksAtFirstLine(url, defaultLinkHandler);
    const intercept = vi.fn((event: MouseEvent) => {
      expect((event.target as HTMLAnchorElement).getAttribute("href")).toBe(
        url,
      );
      event.preventDefault();
    });
    document.addEventListener("click", intercept);
    try {
      expect(link.text).toBe(url);
      hoverAndActivate(link, link.text);
      expect(intercept).toHaveBeenCalledOnce();
    } finally {
      document.removeEventListener("click", intercept);
      terminal.dispose();
    }
  },
);

testCases(
  "detects and opens an HTTP link through the default handler",
  async () => {
    const url = "https://example.com/path?query#fragment";
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { link, terminal } = await linksAtFirstLine(url, defaultLinkHandler);

    expect(link.text).toBe(url);
    hoverAndActivate(link, link.text);

    expect(open).toHaveBeenCalledExactlyOnceWith(
      url,
      "_blank",
      "noopener,noreferrer",
    );
    terminal.dispose();
  },
);

testCases("forwards the hovered link's actual range", async () => {
  const activate = vi.fn();
  const hover = vi.fn();
  const leave = vi.fn();
  const handler = { activate, allowNonHttpProtocols: true, hover, leave };
  const url = "overmux://rich-work-4242/tmux/$71/@647/%25647";
  const { link, terminal } = await linksAtFirstLine(url, handler);

  const events = hoverAndActivate(link, url);
  link.leave?.(new MouseEvent("mouseleave"), url);

  expect(hover).toHaveBeenCalledExactlyOnceWith(events.hover, url, link.range);
  expect(activate).toHaveBeenCalledExactlyOnceWith(
    events.activate,
    url,
    link.range,
  );
  expect(leave).toHaveBeenCalledExactlyOnceWith(
    expect.any(MouseEvent),
    url,
    link.range,
  );
  terminal.dispose();
});

testCases("requires hover before activation", async () => {
  const activate = vi.fn();
  const url = "https://example.com/path";
  const { link, terminal } = await linksAtFirstLine(url, { activate });

  link.activate(new MouseEvent("click"), url);

  expect(activate).not.toHaveBeenCalled();
  terminal.dispose();
});

testCases("uses a replacement link handler at activation time", async () => {
  const initial = { activate: vi.fn(), allowNonHttpProtocols: true };
  const replacement = { activate: vi.fn(), allowNonHttpProtocols: true };
  const url = "overmux://host/path?query#fragment";
  const { link, terminal } = await linksAtFirstLine(url, initial);

  link.hover?.(new MouseEvent("mousemove"), url);
  terminal.options.linkHandler = replacement;
  link.activate(new MouseEvent("click"), url);

  expect(initial.activate).not.toHaveBeenCalled();
  expect(replacement.activate).toHaveBeenCalledExactlyOnceWith(
    expect.any(MouseEvent),
    url,
    link.range,
  );
  terminal.dispose();
});

testCases(
  "disables plain-text activation when the link handler is null",
  async () => {
    const url = "https://example.com/path";
    const { link, terminal } = await linksAtFirstLine(url, defaultLinkHandler);

    const open = vi.spyOn(window, "open").mockReturnValue(null);
    terminal.options.linkHandler = null;
    hoverAndActivate(link, url);

    expect(open).not.toHaveBeenCalled();
    terminal.dispose();
  },
);

testCases.each([
  {
    name: "blocks Overmux links without non-HTTP permission",
    url: "overmux://host/path",
    expectedCalls: 0,
  },
  {
    name: "allows HTTP links without non-HTTP permission",
    url: "https://example.com/path",
    expectedCalls: 1,
  },
])("$name", async ({ url, expectedCalls }) => {
  const activate = vi.fn();
  const { link, terminal } = await linksAtFirstLine(url, { activate });

  hoverAndActivate(link, url);

  expect(activate).toHaveBeenCalledTimes(expectedCalls);
  terminal.dispose();
});
