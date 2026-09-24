import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test as testCases } from "vitest";
import { DocumentationLink, internalLinkTarget } from "./documentation-link";

const linkCases = [
  {
    name: "keeps a same-page fragment",
    href: "#query",
    target: { hash: "query", to: "." },
  },
  {
    name: "keeps path, query, and fragment",
    href: "/docs/reference/server/resources?kind=query#query",
    target: {
      hash: "query",
      search: { kind: "query" },
      to: "/docs/reference/server/resources",
    },
  },
  {
    name: "keeps repeated query values",
    href: "/docs?tag=runtime&tag=server",
    target: { search: { tag: ["runtime", "server"] }, to: "/docs" },
  },
  {
    name: "leaves external URLs to native anchors",
    href: "https://example.com/docs#query",
    target: null,
  },
  {
    name: "leaves protocol-relative URLs to native anchors",
    href: "//example.com/docs#query",
    target: null,
  },
] as const;

describe("documentation links", () => {
  testCases.each(linkCases)("$name", ({ href, target }) => {
    expect(internalLinkTarget(href)).toEqual(target);
  });

  testCases(
    "renders a same-page fragment in the router link href",
    async () => {
      const rootRoute = createRootRoute({ component: Outlet });
      const documentationRoute = createRoute({
        component: () =>
          createElement(DocumentationLink, { href: "#query" }, "Query"),
        getParentRoute: () => rootRoute,
        path: "/docs/reference/server/resources",
      });
      const router = createRouter({
        history: createMemoryHistory({
          initialEntries: ["/docs/reference/server/resources"],
        }),
        routeTree: rootRoute.addChildren([documentationRoute]),
      });

      await router.load();

      expect(
        renderToStaticMarkup(createElement(RouterProvider, { router })),
      ).toContain('href="/docs/reference/server/resources#query"');
    },
  );
});
