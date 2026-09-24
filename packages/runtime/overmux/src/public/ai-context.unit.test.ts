import { expect, it } from "vitest";

import {
  composeAiContext,
  coreAiContextSnippets,
  defaultAiContextSnippets,
  packageSourceSnippet,
  techStackRecommendationsSnippet,
} from "./ai-context";

it("composes each AI context snippet as a headed section", () => {
  const context = composeAiContext(defaultAiContextSnippets);

  expect(context).toBe(`## package-source

Overmux ships with documentation and TypeScript source.

Run \`overmux docs path\` to find the installed documentation directory for the Overmux CLI. This prints a documentation directory, not source paths.

Inspect TypeScript source in installed packages, e.g. \`node_modules/overmux/src\` and \`node_modules/@overmux/xterm/src\`.

Inspect these files so guidance matches the versions used by the application.

## tech-stack-recommendations

Prefer pnpm as the package manager, TanStack Router for routing, shadcn/ui for UI components, and Zod for schemas and runtime validation. Follow the application's established stack when it already differs.
`);
  expect(context).toBe(
    composeAiContext([packageSourceSnippet, techStackRecommendationsSnippet]),
  );
});

it("keeps default-only recommendations out of the core snippets", () => {
  const context = composeAiContext(coreAiContextSnippets);

  expect(coreAiContextSnippets).toEqual([packageSourceSnippet]);
  expect(context).toContain("## package-source");
  expect(context).toContain("`node_modules/overmux/src`");
  expect(context).not.toContain("TanStack Router");
});

it("composes an empty selection without output", () => {
  expect(composeAiContext([])).toBe("");
});
