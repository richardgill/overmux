import { MDXContent } from "@content-collections/mdx/react";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { ImageZoom } from "fumadocs-ui/components/image-zoom";
import { buttonVariants } from "fumadocs-ui/components/ui/button";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "fumadocs-ui/components/ui/popover";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { Check, FileText, Link } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
} from "fumadocs-ui/layouts/docs/page";
import { InlineCodeTitle } from "@/content/inline-title";
import { source } from "@/content/source";

const mdxComponents = { ...defaultMdxComponents, ImageZoom };

const loadPage = createServerFn({ method: "GET" })
  .validator((slug: string) => slug)
  .handler(({ data: slug }) => {
    if (slug === "index") {
      throw redirect({
        to: "/docs/$",
        params: { _splat: "getting-started/install-and-run-overmux" },
        replace: true,
      });
    }

    const page = source.getPage(slug.split("/"));
    if (!page) {
      throw notFound();
    }

    return {
      body: page.data.body,
      description: page.data.description,
      full: page.data.full,
      markdownUrl: `/docs/${slug}.md`,
      formattedTitle: page.data.formattedTitle ?? page.data.title,
      title: page.data.title,
      toc: page.data.toc,
    };
  });

const CopyMarkdownUrlButton = ({ markdownUrl }: { markdownUrl: string }) => {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    if (status === "idle") {
      return;
    }
    const timeout = window.setTimeout(() => setStatus("idle"), 2000);
    return () => window.clearTimeout(timeout);
  }, [status]);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(
        new URL(markdownUrl, window.location.origin).href,
      );
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  };

  const Icon = status === "copied" ? Check : Link;
  return (
    <button
      type="button"
      className="flex items-center gap-2 rounded-lg p-2 text-sm hover:bg-fd-accent hover:text-fd-accent-foreground"
      onClick={copyUrl}
    >
      <Icon className="size-3.5 text-fd-muted-foreground" />
      <span aria-live="polite">
        {status === "copied"
          ? "Copied!"
          : status === "error"
            ? "Copy failed. Try again"
            : "Copy Markdown URL"}
      </span>
    </button>
  );
};

const MarkdownMenu = ({ markdownUrl }: { markdownUrl: string }) => (
  <Popover>
    <PopoverTrigger
      className={buttonVariants({
        color: "secondary",
        size: "sm",
        className: "shrink-0 gap-1.5",
      })}
    >
      Markdown
      <svg aria-hidden="true" className="size-3" viewBox="0 0 16 16">
        <path
          d="m4 6 4 4 4-4"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      </svg>
    </PopoverTrigger>
    <PopoverContent align="end" className="flex min-w-44 flex-col p-1">
      <PopoverClose asChild>
        <MarkdownCopyButton
          className="w-full justify-start border-0 bg-transparent p-2 text-sm font-normal"
          markdownUrl={markdownUrl}
        >
          Copy as Markdown
        </MarkdownCopyButton>
      </PopoverClose>
      <CopyMarkdownUrlButton markdownUrl={markdownUrl} />
      <PopoverClose asChild>
        <a
          className="flex items-center gap-2 rounded-lg p-2 text-sm hover:bg-fd-accent hover:text-fd-accent-foreground"
          href={markdownUrl}
          rel="noreferrer noopener"
          target="_blank"
        >
          <FileText className="size-3.5 text-fd-muted-foreground" />
          View as Markdown
        </a>
      </PopoverClose>
    </PopoverContent>
  </Popover>
);

const DocsContent = () => {
  const page = Route.useLoaderData();

  return (
    <DocsPage full={page.full} toc={page.toc}>
      <div className="flex items-start justify-between gap-4">
        <DocsTitle>
          <InlineCodeTitle
            title={page.formattedTitle}
            titleSize="text-inherit"
          />
        </DocsTitle>
        <MarkdownMenu markdownUrl={page.markdownUrl} />
      </div>
      <DocsDescription>{page.description}</DocsDescription>
      <DocsBody>
        <MDXContent code={page.body} components={mdxComponents} />
      </DocsBody>
    </DocsPage>
  );
};

export const Route = createFileRoute("/docs/$")({
  component: DocsContent,
  loader: ({ params }) => loadPage({ data: params._splat ?? "" }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData?.title }] }),
});
