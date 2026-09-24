import { buildCommand, buildRouteMap } from "@stricli/core";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createAiContextCommand } from "./docs-ai-context";

type DocsOutput = { write: (text: string) => unknown };

export const resolveInstalledDocsRoot = (moduleUrl: string) => {
  const candidates = ["../docs", "./docs", "../../../docs"].map((path) =>
    fileURLToPath(new URL(path, moduleUrl)),
  );
  const docsRoot = candidates.find((candidate) => existsSync(candidate));
  if (!docsRoot) {
    throw new Error("Installed Overmux documentation is missing");
  }
  return resolve(docsRoot);
};

const createDocsPathCommand = ({
  docsRoot,
  output,
}: {
  docsRoot: string;
  output: DocsOutput;
}) =>
  buildCommand({
    func: () => {
      output.write(`${resolve(docsRoot)}\n`);
    },
    parameters: {},
    docs: {
      brief: "Print the installed documentation directory",
    },
  });

export const createDocsRoute = ({
  docsRoot,
  process,
}: {
  docsRoot: string;
  process: NodeJS.Process;
}) =>
  buildRouteMap({
    docs: { brief: "Find documentation and print coding-agent guidance" },
    routes: {
      path: createDocsPathCommand({ docsRoot, output: process.stdout }),
      "ai-context": createAiContextCommand(process),
    },
  });
