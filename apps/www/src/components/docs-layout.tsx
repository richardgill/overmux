"use client";

import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { SidebarIcon } from "lucide-react";
import { useDocsLayout } from "fumadocs-ui/layouts/docs";
import { SearchTrigger } from "fumadocs-ui/layouts/shared/slots/search-trigger";
import { ThemeSwitch } from "fumadocs-ui/layouts/shared/slots/theme-switch";

type SiteHeaderProps = ComponentProps<"header"> & {
  navigation?: ReactNode;
  stickyTopClassName?: string;
};

type SiteHeaderControlsProps = {
  githubIcon?: ReactNode;
  githubUrl?: string;
};

const GitHubIcon = () => (
  <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
);

export const SiteHeader = ({
  children,
  className,
  navigation,
  stickyTopClassName = "top-0",
  ...props
}: SiteHeaderProps) => (
  <header
    className={`sticky ${stickyTopClassName} z-30 flex h-14 items-center border-b bg-fd-background/80 px-4 backdrop-blur-sm ${className ?? ""}`}
    {...props}
  >
    <a className="font-semibold" href="/">
      Overmux
    </a>
    {navigation}
    <div className="ms-auto flex items-center gap-1">{children}</div>
  </header>
);

export const SiteHeaderControls = ({
  githubIcon,
  githubUrl = "https://github.com/richardgill/overmux",
}: SiteHeaderControlsProps) => (
  <>
    <a
      aria-label="Overmux on GitHub"
      className="rounded-md p-2 text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-accent-foreground"
      href={githubUrl}
      rel="noreferrer"
      target="_blank"
    >
      <span aria-hidden="true" className="block size-4 [&>svg]:size-full">
        {githubIcon ?? <GitHubIcon />}
      </span>
    </a>
    <ThemeSwitch className="border-0 p-0" />
  </>
);

export const DocsHeader = ({
  className,
  ...props
}: ComponentProps<"header">) => {
  const { slots, menuItems } = useDocsLayout();
  const githubLink = menuItems
    .filter((item) => item.type === "icon")
    .find((item) => item.label === "GitHub");

  return (
    <SiteHeader
      className={`[grid-area:header] ${className ?? ""}`}
      stickyTopClassName="top-(--fd-docs-row-1)"
      {...props}
    >
      <SearchTrigger className="p-2 md:hidden" hideIfDisabled />
      <SiteHeaderControls
        githubIcon={githubLink?.icon}
        githubUrl={githubLink?.url}
      />
      <slots.sidebar.trigger
        aria-label="Toggle sidebar"
        className="rounded-md p-2 text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-accent-foreground md:hidden"
      >
        <SidebarIcon className="size-4" />
      </slots.sidebar.trigger>
    </SiteHeader>
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
