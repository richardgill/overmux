import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import { DocumentationLink } from "@/content/documentation-link";
import styles from "@/styles.css?url";

const NotFoundPage = () => (
  <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6">
    <h1 className="text-3xl font-semibold">Not found</h1>
    <p className="mt-2 text-fd-muted-foreground">
      The page you requested does not exist.
    </p>
    <Link className="mt-4 underline" to="/">
      Return home
    </Link>
  </main>
);

const RootDocument = () => (
  <html lang="en" suppressHydrationWarning>
    <head>
      <HeadContent />
    </head>
    <body className="flex min-h-screen flex-col">
      <RootProvider components={{ Link: DocumentationLink }}>
        <Outlet />
      </RootProvider>
      <Scripts />
    </body>
  </html>
);

export const Route = createRootRoute({
  component: RootDocument,
  head: () => ({
    links: [
      { href: styles, rel: "stylesheet" },
      { href: "/favicon.svg", rel: "icon", type: "image/svg+xml" },
    ],
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { title: "Overmux" },
    ],
  }),
  notFoundComponent: NotFoundPage,
});
