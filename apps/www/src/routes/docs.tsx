import { Outlet, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import type { Item, Node, Root } from "fumadocs-core/page-tree";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { InlineCodeTitle } from "@/content/inline-title";
import { DocsContainer, DocsHeader } from "@/components/docs-layout";
import { formattedTitles, source } from "@/content/source";

const loadPageTree = createServerFn({ method: "GET" }).handler(async () => ({
  formattedTitles: formattedTitles(),
  tree: await source.serializePageTree(source.getPageTree()),
}));

const formatPageTitle = (page: Item, titles: Record<string, string>) => {
  const title = titles[page.url];
  return title ? { ...page, name: <InlineCodeTitle title={title} /> } : page;
};

const formatTreeNode = (node: Node, titles: Record<string, string>): Node => {
  if (node.type === "page") {
    return formatPageTitle(node, titles);
  }
  if (node.type === "folder") {
    return {
      ...node,
      children: node.children.map((child) => formatTreeNode(child, titles)),
      index: node.index ? formatPageTitle(node.index, titles) : undefined,
    };
  }
  return node;
};

const formatTreeTitles = (
  tree: Root,
  titles: Record<string, string>,
): Root => ({
  ...tree,
  children: tree.children.map((node) => formatTreeNode(node, titles)),
});

const DocsRoute = () => {
  const { formattedTitles, tree } = useFumadocsLoader(Route.useLoaderData());

  return (
    <DocsLayout
      nav={{ title: "Overmux" }}
      githubUrl="https://github.com/richardgill/overmux"
      sidebar={{ defaultOpenLevel: 1, collapsible: false }}
      slots={{ container: DocsContainer, header: DocsHeader }}
      themeSwitch={{ enabled: false }}
      tree={formatTreeTitles(tree, formattedTitles)}
    >
      <Outlet />
    </DocsLayout>
  );
};

export const Route = createFileRoute("/docs")({
  component: DocsRoute,
  loader: () => loadPageTree(),
});
