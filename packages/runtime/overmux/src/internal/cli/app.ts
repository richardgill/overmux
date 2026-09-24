import {
  buildApplication,
  buildRouteMap,
  help,
  run,
  text_en,
} from "@stricli/core";

import { authRoute } from "./commands/auth";
import { checkCommand } from "./commands/check";
import { callCommand } from "./commands/call";
import { desktopRoute } from "./commands/desktop";
import { createDocsRoute, resolveInstalledDocsRoot } from "./commands/docs";
import { createInitCommand } from "./commands/init";
import { integrationCommand } from "./commands/integration";
import { createInstanceCommand } from "./commands/instance";
import { serveCommand } from "./commands/serve";
import { detectCliEnvironment, type CliCommandContext } from "./environment";

export const createCliApp = (process = globalThis.process) =>
  buildApplication<CliCommandContext>(
    buildRouteMap<string, CliCommandContext>({
      docs: { brief: "Initialize and manage Overmux applications" },
      routes: {
        auth: authRoute,
        check: checkCommand,
        call: callCommand,
        desktop: desktopRoute,
        docs: createDocsRoute({
          docsRoot: resolveInstalledDocsRoot(import.meta.url),
          process,
        }),
        init: createInitCommand(process),
        integration: integrationCommand,
        instance: createInstanceCommand(process.stdout),
        serve: serveCommand,
      },
    }),
    {
      name: "overmux",
      localization: {
        text: {
          ...text_en,
          commandErrorResult: (error) => error.message,
          exceptionWhileRunningCommand: (error) =>
            error instanceof Error ? error.message : String(error),
        },
      },
      scanner: {
        allowArgumentEscapeSequence: true,
        caseStyle: "allow-kebab-for-camel",
      },
    },
    {
      help: help({
        brief: "Show this help",
        defaultForRouteMap: true,
        formatting: {
          caseStyle: "convert-camel-to-kebab",
          onlyRequiredInUsageLine: false,
          useAliasInUsageLine: false,
        },
      }),
    },
  );

export const runCli = async (
  args: readonly string[],
  process = globalThis.process,
) => {
  const environment = await detectCliEnvironment(process);
  return run(createCliApp(process), args[0] === "--" ? args.slice(1) : args, {
    environment,
    process,
  });
};
