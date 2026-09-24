import {
  aiContextContentBySnippet,
  type AiContextSnippetDefinition,
} from "@overmux/ai-context";

export {
  coreAiContextSnippets,
  defaultAiContextSnippets,
  packageSourceSnippet,
  techStackRecommendationsSnippet,
  type AiContextSnippet,
  type AiContextSnippetDefinition,
} from "@overmux/ai-context";

export const composeAiContext = (snippets: AiContextSnippetDefinition) =>
  snippets.length === 0
    ? ""
    : `${snippets
        .map(
          (snippet) => `## ${snippet}\n\n${aiContextContentBySnippet[snippet]}`,
        )
        .join("\n\n")}\n`;
