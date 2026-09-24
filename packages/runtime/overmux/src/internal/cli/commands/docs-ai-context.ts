import { loadOvermuxConfig } from "@overmux/shared/node";
import { buildCommand } from "@stricli/core";

import {
  composeAiContext,
  defaultAiContextSnippets,
} from "../../../public/ai-context";
import { getDefaultConfigPath } from "../../server/paths";

type AiContextFlags = { config: string };

export const createAiContextCommand = (process: NodeJS.Process) =>
  buildCommand({
    func: async (flags: AiContextFlags) => {
      const { config } = await loadOvermuxConfig({ configPath: flags.config });
      process.stdout.write(
        composeAiContext(config.aiContextSnippets ?? defaultAiContextSnippets),
      );
    },
    parameters: {
      aliases: { c: "config" },
      flags: {
        config: {
          brief: "Configuration file",
          default: getDefaultConfigPath(),
          kind: "parsed",
          parse: String,
          placeholder: "path",
        },
      },
    },
    docs: { brief: "Print the configured Overmux AI context" },
  });
