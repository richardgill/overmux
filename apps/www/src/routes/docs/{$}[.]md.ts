import { createFileRoute, notFound } from "@tanstack/react-router";
import { getLLMText, source } from "@/content/source";

export const Route = createFileRoute("/docs/{$}.md")({
  server: {
    handlers: {
      GET: ({ params }) => {
        const slug = params._splat ?? "";
        const page = source.getPage(
          !slug || slug === "index" ? [] : slug.split("/"),
        );
        if (!page) {
          throw notFound();
        }

        return new Response(getLLMText(page), {
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
        });
      },
    },
  },
});
