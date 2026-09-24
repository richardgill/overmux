export const packageSourceSnippet = "package-source" as const;
export const techStackRecommendationsSnippet =
  "tech-stack-recommendations" as const;
export const aiContextSnippets = [
  packageSourceSnippet,
  techStackRecommendationsSnippet,
] as const;

export type AiContextSnippet = (typeof aiContextSnippets)[number];

export type AiContextSnippetDefinition = readonly AiContextSnippet[];

export const coreAiContextSnippets = [
  packageSourceSnippet,
] as const satisfies AiContextSnippetDefinition;
export const defaultAiContextSnippets = [
  ...coreAiContextSnippets,
  techStackRecommendationsSnippet,
] as const satisfies AiContextSnippetDefinition;

const packageSourceSnippetContent = `Overmux ships with documentation and TypeScript source.

Run \`overmux docs path\` to find the installed documentation directory for the Overmux CLI. This prints a documentation directory, not source paths.

Inspect TypeScript source in installed packages, e.g. \`node_modules/overmux/src\` and \`node_modules/@overmux/xterm/src\`.

Inspect these files so guidance matches the versions used by the application.`;

const techStackRecommendationsSnippetContent = `Prefer pnpm as the package manager, TanStack Router for routing, shadcn/ui for UI components, and Zod for schemas and runtime validation. Follow the application's established stack when it already differs.`;

export const aiContextContentBySnippet: Record<AiContextSnippet, string> = {
  [packageSourceSnippet]: packageSourceSnippetContent,
  [techStackRecommendationsSnippet]: techStackRecommendationsSnippetContent,
};
