import { afterEach, expect, test as testCases, vi } from "vitest";

import { defaultLinkHandler } from "./index";

const linkRange = { start: { x: 1, y: 1 }, end: { x: 2, y: 1 } };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

testCases.each([
  {
    name: "local file",
    text: "file:///tmp/a b.txt",
    href: "file:///tmp/a%20b.txt",
  },
  { name: "HTTP", text: "http://example.com", href: "http://example.com/" },
  {
    name: "HTTPS with mixed-case scheme",
    text: "HTTPS://example.com/a b",
    href: "https://example.com/a%20b",
  },
])("opens $name synchronously without confirmation", ({ text, href }) => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const confirm = vi.fn();
  vi.stubGlobal("confirm", confirm);

  defaultLinkHandler.activate(new MouseEvent("click"), text, linkRange);

  expect(defaultLinkHandler.allowNonHttpProtocols).toBe(true);
  expect(open).toHaveBeenCalledExactlyOnceWith(
    href,
    "_blank",
    "noopener,noreferrer",
  );
  expect(confirm).not.toHaveBeenCalled();
});

testCases.each([
  "overmux://rich-work-4242/tmux/$71/@647/%25647?tab=one#pane",
  "OVERMUX://host/path?#",
  "overmux://host/a/../unsafe",
  "overmux://host/path\n",
])(
  "activates a runtime-interceptable anchor with the original text: %j",
  (text) => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const anchorsBefore = document.querySelectorAll("a").length;
    const intercept = vi.fn((event: MouseEvent) => {
      const anchor = event.target as HTMLAnchorElement;
      expect(anchor.getAttribute("href")).toBe(text);
      expect(anchor.target).toBe("_blank");
      expect(anchor.rel).toBe("noopener noreferrer");
      event.preventDefault();
    });
    document.addEventListener("click", intercept);
    try {
      defaultLinkHandler.activate(new MouseEvent("click"), text, linkRange);
      expect(intercept).toHaveBeenCalledOnce();
      expect(open).not.toHaveBeenCalled();
      expect(document.querySelectorAll("a")).toHaveLength(anchorsBefore);
    } finally {
      document.removeEventListener("click", intercept);
    }
  },
);

testCases.each([
  { name: "JavaScript", text: "javascript:alert(1)" },
  { name: "data", text: "data:text/html,hello" },
  { name: "FTP", text: "ftp://example.com" },
  { name: "mail", text: "mailto:person@example.com" },
  { name: "custom scheme", text: "vscode://file/tmp/example" },
  { name: "malformed URL", text: "https://[invalid" },
  { name: "relative URL", text: "/tmp/example" },
  { name: "empty input", text: "" },
])("ignores $name", ({ text }) => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);

  defaultLinkHandler.activate(new MouseEvent("click"), text, linkRange);

  expect(open).not.toHaveBeenCalled();
});
