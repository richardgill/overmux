import { createFileRoute } from "@tanstack/react-router";
import { getLLMText, source } from "@/content/source";

export const Route = createFileRoute("/llms-full.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(source.getPages().map(getLLMText).join("\n\n"), {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
    },
  },
});
