import { describe, expect, it, test as testCases } from "vitest";

import {
  decideNavigation,
  getOrigin,
  normalizeHttpUrl,
  parseDeepLink,
  resolveDeepLinkRoute,
  resolveNotificationLink,
  resolveNotificationPath,
} from "./url-policy.js";

const invalidUrls = [
  "",
  "overmux.example.com",
  "file:///tmp/overmux",
  "javascript:alert(1)",
  "https://user:password@example.com",
];
const invalidDeepLinks = [
  "https://example.com/path",
  "overmux:example.com/path",
  "overmux:///path",
  "overmux://user:password@example.com/path",
  "overmux://@example.com/path",
  "overmux://%6cocalhost/path",
  "overmux://localhost%2Fevil.test/path",
  "overmux://localhost:4242/path",
  "overmux://[::1]/path",
  "overmux://UPPER/path",
  "overmux://-work/path",
  "overmux://work./path",
  `overmux://${"a".repeat(254)}/`,
  "overmux://localhost\\\\@evil.test/path",
  "overmux://local\thost/path",
  "overmux://localhost/path\n",
  "overmux://localhost/path with spaces",
  "overmux://localhost//evil.test",
  "overmux://localhost/%2fevil.test",
  "overmux://localhost/a/..//evil.test",
  "overmux://localhost/a/%2e%2e/x",
  "overmux://localhost/%5cevil.test",
  "overmux://localhost/%00",
  "overmux://localhost/%7f",
  "overmux://localhost/%zz",
  "overmux://localhost/%",
];

describe("desktop URL policy", () => {
  it("normalizes arbitrary HTTP and HTTPS URLs", () => {
    expect(normalizeHttpUrl(" HTTPS://Example.COM:443/a?q=1#result ")).toBe(
      "https://example.com/a?q=1#result",
    );
    expect(normalizeHttpUrl("http://localhost:4242")).toBe(
      "http://localhost:4242/",
    );
    expect(getOrigin("https://Example.com:443/a")).toBe("https://example.com");
  });

  testCases.each(invalidUrls)("rejects an unsafe instance URL: %s", (url) => {
    expect(() => normalizeHttpUrl(url)).toThrow();
  });

  it("keeps same-origin navigation and externalizes cross-origin HTTP links", () => {
    expect(
      decideNavigation(
        "https://overmux.test/workspace",
        "https://overmux.test",
      ),
    ).toEqual({ type: "allow" });
    expect(
      decideNavigation("https://docs.test/overmux", "https://overmux.test"),
    ).toEqual({ type: "external", url: "https://docs.test/overmux" });
  });

  it("routes deep links, externalizes local files, and denies unsafe schemes", () => {
    expect(
      decideNavigation("overmux://overmux.test/", "https://overmux.test").type,
    ).toBe("deep-link");
    expect(
      decideNavigation("file:///tmp/pi-session.md", "https://overmux.test"),
    ).toEqual({ type: "external", url: "file:///tmp/pi-session.md" });
    expect(
      decideNavigation(
        "file://untrusted-host/etc/passwd",
        "https://overmux.test",
      ),
    ).toEqual({ type: "deny" });
    expect(
      decideNavigation("data:text/html,unsafe", "https://overmux.test"),
    ).toEqual({ type: "deny" });
  });

  testCases.each([
    "/\\\\evil.test",
    "/%5Cevil.test",
    "/%2F%2Fevil.test",
    "//evil.test",
  ])("rejects hostile notification navigation path: %s", (path) => {
    expect(() =>
      resolveNotificationPath(path, "https://overmux.test"),
    ).toThrow();
  });

  it("resolves relative and absolute notification links", () => {
    expect(
      resolveNotificationLink(
        "/workspaces/main?tab=terminal",
        "https://overmux.test",
      ),
    ).toBe("https://overmux.test/workspaces/main?tab=terminal");
    expect(
      resolveNotificationLink(
        "https://github.com/example/repository",
        "https://overmux.test",
      ),
    ).toBe("https://github.com/example/repository");
  });

  testCases.each([
    "rich-work-4242",
    "localhost",
    "127.1",
    "overmux.test",
    "a".repeat(253),
  ])("treats %s only as an instance ID", (instanceId) => {
    expect(parseDeepLink(`overmux://${instanceId}`)).toEqual({
      instanceId,
      route: "/",
    });
  });

  testCases.each([
    "/tmux/$71/@647/%25647",
    "/a%2Fb/%E2%9C%93?x=a%20b&x=a+b&v=%2f#pane%202",
    "/workspace?tab=terminal#pane-2",
    "/path?#",
    "/path?",
    "/path#",
    "/path?origin=https%3A%2F%2Fevil.test&path=%2Felsewhere",
    "/path?overmux-scheme=ftp&overmux-scheme=&%6fvermux-scheme=http#overmux-scheme=https",
  ])(
    "preserves original route bytes and resolves only at a chosen address: %s",
    (route) => {
      const link = parseDeepLink(`overmux://rich-work-4242${route}`);
      expect(link).toEqual({ instanceId: "rich-work-4242", route });
      expect(
        resolveDeepLinkRoute(link.route, "http://chosen.test:9000/base"),
      ).toBe(`http://chosen.test:9000${route}`);
    },
  );

  it("supplies a root path for a query-only or fragment-only link", () => {
    expect(parseDeepLink("overmux://work?tab=terminal").route).toBe(
      "/?tab=terminal",
    );
    expect(parseDeepLink("overmux://work#").route).toBe("/#");
  });

  testCases.each(invalidDeepLinks)(
    "rejects an unsafe or unsupported deep link: %s",
    (url) => {
      expect(() => parseDeepLink(url)).toThrow();
      expect(decideNavigation(url, "https://overmux.test").type).not.toBe(
        "deep-link",
      );
    },
  );
});
