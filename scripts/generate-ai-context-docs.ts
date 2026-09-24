import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  aiContextContentBySnippet,
  coreAiContextSnippets,
  defaultAiContextSnippets,
} from "../packages/runtime/ai-context/src/index.ts";

const documentationPath = new URL(
  "../packages/runtime/overmux/docs/400-reference/700-cli/600-docs.md",
  import.meta.url,
);
const replaceGeneratedBlock = (
  markdown: string,
  { name, content }: { name: string; content: string },
) => {
  // Link-reference comments stay invisible in both plain Markdown and the website's MDX compiler.
  const startMarker = `[//]: # (BEGIN GENERATED ${name})`;
  const endMarker = `[//]: # (END GENERATED ${name})`;
  const start = markdown.indexOf(startMarker);
  const end = markdown.indexOf(endMarker);
  if (
    start < 0 ||
    end < start ||
    markdown.indexOf(startMarker, start + startMarker.length) !== -1 ||
    markdown.indexOf(endMarker, end + endMarker.length) !== -1
  ) {
    throw new Error(
      `Expected one ordered pair of ${name} documentation markers`,
    );
  }
  return `${markdown.slice(0, start + startMarker.length)}\n\n${content}\n\n${markdown.slice(end)}`;
};

const renderAiContextDocumentation = (markdown: string) => {
  const presets = Object.entries({
    defaultAiContextSnippets,
    coreAiContextSnippets,
  }).map(
    ([name, snippets]) =>
      `| \`${name}\` | ${snippets.map((id) => `\`${id}\``).join(", ")} |`,
  );
  const withPresets = replaceGeneratedBlock(markdown, {
    name: "AI CONTEXT PRESETS",
    content: [
      "| Export | Included snippets |",
      "| --- | --- |",
      ...presets,
    ].join("\n"),
  });
  return replaceGeneratedBlock(withPresets, {
    name: "AI CONTEXT",
    content: Object.entries(aiContextContentBySnippet)
      .map(
        ([id, content]) => `#### \`${id}\`\n\n\`\`\`text\n${content}\n\`\`\``,
      )
      .join("\n\n"),
  });
};

export const generateAiContextDocumentation = async ({
  check = false,
} = {}) => {
  const current = await readFile(documentationPath, "utf8");
  const generated = renderAiContextDocumentation(current);
  if (current === generated) {
    return;
  }
  if (check) {
    throw new Error(
      "AI context docs are stale. Run pnpm generate-ai-context-docs.",
    );
  }
  await writeFile(documentationPath, generated);
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await generateAiContextDocumentation({
    check: process.argv.includes("--check"),
  });
}
