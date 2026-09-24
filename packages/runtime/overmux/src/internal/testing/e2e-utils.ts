import { runCli as runCliEntrypoint } from "../cli/app";

type CliResult = {
  exitCode: number | string | null | undefined;
  stderr: string;
  stdout: string;
};

export const runCli = async (args: readonly string[]): Promise<CliResult> => {
  let stderr = "";
  let stdout = "";
  const process: {
    env: Record<string, string | undefined>;
    exitCode?: number | string | null;
    stderr: { write: (text: string) => string };
    stdin: { isTTY: boolean };
    stdout: { isTTY: boolean; write: (text: string) => string };
  } = {
    env: { ...globalThis.process.env, STRICLI_NO_COLOR: "1" },
    stderr: { write: (text: string) => (stderr += text) },
    stdin: { isTTY: false },
    stdout: { isTTY: false, write: (text: string) => (stdout += text) },
  };

  await runCliEntrypoint(args, process as unknown as NodeJS.Process);

  return { exitCode: process.exitCode, stderr, stdout };
};
