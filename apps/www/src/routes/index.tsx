import { createFileRoute } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import readme from "../../../../README.md?raw";
import { SiteHeader, SiteHeaderControls } from "@/components/docs-layout";

const githubLicenseUrl =
  "https://github.com/richardgill/overmux/blob/main/LICENSE";

const homepageMarkdown = readme.replace(/^> \[!NOTE\]\n> /, "> ");

const resolvedREADMEHref = (href: string | undefined) => {
  if (href === "./LICENSE") {
    return githubLicenseUrl;
  }
  if (!href?.startsWith("https://overmux.com/")) {
    return href;
  }

  return href.slice("https://overmux.com".length);
};

const READMELink = ({ href, ...props }: ComponentProps<"a">) => {
  const resolvedHref = resolvedREADMEHref(href);
  const isExternal = resolvedHref?.startsWith("http");

  return (
    <a
      {...props}
      href={resolvedHref}
      rel={isExternal ? "noreferrer" : undefined}
      target={isExternal ? "_blank" : undefined}
    />
  );
};

const HomePage = () => (
  <div className="min-h-screen">
    <SiteHeader
      navigation={
        <a
          className="ms-6 text-sm text-fd-muted-foreground hover:text-fd-foreground"
          href="/docs"
        >
          Docs
        </a>
      }
    >
      <SiteHeaderControls />
    </SiteHeader>
    <main className="mx-auto w-full max-w-3xl px-6 pt-8 pb-16 sm:pt-12 sm:pb-24">
      <article className="readme-content">
        <ReactMarkdown components={{ a: READMELink }}>
          {homepageMarkdown}
        </ReactMarkdown>
      </article>
    </main>
  </div>
);

export const Route = createFileRoute("/")({ component: HomePage });
