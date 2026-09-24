"use client";

import type { ComponentProps, CSSProperties } from "react";
import { SidebarIcon } from "lucide-react";
import { useDocsLayout } from "fumadocs-ui/layouts/docs";
import { SearchTrigger } from "fumadocs-ui/layouts/shared/slots/search-trigger";
import { ThemeSwitch } from "fumadocs-ui/layouts/shared/slots/theme-switch";

export const DocsHeader = ({
  className,
  ...props
}: ComponentProps<"header">) => {
  const { slots, menuItems } = useDocsLayout();
  const githubLink = menuItems
    .filter((item) => item.type === "icon")
    .find((item) => item.label === "GitHub");

  return (
    <header
      className={`[grid-area:header] sticky top-(--fd-docs-row-1) z-30 flex h-14 items-center border-b bg-fd-background/80 px-4 backdrop-blur-sm ${className ?? ""}`}
      {...props}
    >
      <a className="font-semibold" href="/">
        Overmux
      </a>
      <div className="ms-auto flex items-center gap-1">
        <SearchTrigger className="p-2 md:hidden" hideIfDisabled />
        <a
          aria-label="Overmux on GitHub"
          className="rounded-md p-2 text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-accent-foreground"
          href={githubLink?.url}
          rel="noreferrer"
          target="_blank"
        >
          <span aria-hidden="true" className="block size-4 [&>svg]:size-full">
            {githubLink?.icon}
          </span>
        </a>
        <ThemeSwitch className="border-0 p-0" />
        <slots.sidebar.trigger
          aria-label="Toggle sidebar"
          className="rounded-md p-2 text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-accent-foreground md:hidden"
        >
          <SidebarIcon className="size-4" />
        </slots.sidebar.trigger>
      </div>
    </header>
  );
};

export const DocsContainer = ({
  className,
  style,
  ...props
}: ComponentProps<"div">) => {
  const { slots } = useDocsLayout();
  const { collapsed } = slots.sidebar.useSidebar();
  const layoutStyle: CSSProperties = {
    "--fd-docs-row-1": "var(--fd-banner-height, 0px)",
    "--fd-docs-row-2": "calc(var(--fd-docs-row-1) + var(--fd-header-height))",
    "--fd-docs-row-3":
      "calc(var(--fd-docs-row-2) + var(--fd-toc-popover-height))",
    "--fd-sidebar-col": collapsed ? "0px" : "var(--fd-sidebar-width)",
    ...style,
  } as CSSProperties;

  return (
    <div
      className={`grid min-h-(--fd-docs-height) overflow-x-clip [--fd-docs-height:100dvh] [--fd-header-height:--spacing(14)] [--fd-sidebar-width:0px] [--fd-toc-popover-height:0px] [--fd-toc-width:0px] ${className ?? ""}`}
      data-sidebar-collapsed={collapsed}
      id="nd-docs-layout"
      style={layoutStyle}
      {...props}
    />
  );
};
