import type { CommandContext } from "@stricli/core";
import { determineAgent } from "@vercel/detect-agent";
import * as ciInfo from "ci-info";

export type CliEnvironment = {
  readonly agent?: string;
  readonly isAgent: boolean;
  readonly isCI: boolean;
  readonly isHumanUser: boolean;
  readonly isInteractiveTerminal: boolean;
};

export type CliCommandContext = CommandContext & {
  readonly environment: CliEnvironment;
  readonly process: NodeJS.Process;
};

type CliEnvironmentSignals = {
  readonly agent?: string;
  readonly isAgent: boolean;
  readonly isCI: boolean;
  readonly stdinIsTTY?: boolean;
  readonly stdoutIsTTY?: boolean;
};

export const classifyCliEnvironment = ({
  agent,
  isAgent,
  isCI,
  stdinIsTTY,
  stdoutIsTTY,
}: CliEnvironmentSignals): CliEnvironment => {
  const isInteractiveTerminal = stdinIsTTY === true && stdoutIsTTY === true;
  return {
    agent,
    isAgent,
    isCI,
    isHumanUser: isInteractiveTerminal && !isCI && !isAgent,
    isInteractiveTerminal,
  };
};

export const detectCliEnvironment = async (
  process: Pick<NodeJS.Process, "stdin" | "stdout"> = globalThis.process,
): Promise<CliEnvironment> => {
  const detectedAgent = await determineAgent();
  return classifyCliEnvironment({
    agent: detectedAgent.agent?.name,
    isAgent: detectedAgent.isAgent,
    isCI: ciInfo.isCI,
    stdinIsTTY: process.stdin.isTTY,
    stdoutIsTTY: process.stdout.isTTY,
  });
};
