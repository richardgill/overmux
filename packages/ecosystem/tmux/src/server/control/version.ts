import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { tmuxSocketArguments } from "../backend";

export class TmuxVersionError extends Error {}

const execFileAsync = promisify(execFile);
const readVersion = async (args: readonly string[], signal: AbortSignal) => {
  const { stdout } = await execFileAsync("tmux", [...args], {
    encoding: "utf8",
    maxBuffer: 4096,
    signal,
    timeout: 5_000,
  });
  return stdout.trim();
};

const requireSupportedVersion = (output: string, source: string) => {
  const version = output.replace(/^tmux\s+/, "").trim();
  const match = /^(\d+)\.(\d+)[a-z]*$/.exec(version);
  if (!match) {
    throw new TmuxVersionError(
      `Could not determine tmux ${source} version from ${JSON.stringify(output)}.`,
    );
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major < 3 || (major === 3 && minor < 2)) {
    throw new TmuxVersionError(
      `Overmux requires tmux 3.2 or newer; found ${version} (${source}).`,
    );
  }
};

export const createTmuxVersionCheck = (
  socket: string,
  run: typeof readVersion = readVersion,
) => {
  let executableVersion: string | undefined;
  return async (signal: AbortSignal) => {
    // Cache the executable per backend, but probe the server again after a disconnect:
    // upgrading the executable does not replace an already-running tmux server.
    if (executableVersion === undefined) {
      executableVersion = await run(["-V"], signal);
    }
    requireSupportedVersion(executableVersion, "executable");
    const serverVersion = await run(
      [...tmuxSocketArguments(socket), "display-message", "-p", "#{version}"],
      signal,
    );
    requireSupportedVersion(serverVersion, "server");
  };
};
