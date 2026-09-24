// Owns public Zellij CLI effects shared by installation and the event-driven backend.
// Topology is read only through the plugin; session listing exists solely for anchor selection.
// Spawned pipe processes are returned to the connection layer for bounded cleanup.

import {
  execFile as execFileCallback,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { verifyInstalledArtifact } from "../install/artifact";
import { ZellijNoSessionError } from "../install/errors";
import { parseActiveSessionList } from "../install/session-selection";

const execFile = promisify(execFileCallback);

export type ZellijCommandRunner = (
  args: readonly string[],
  signal?: AbortSignal,
) => Promise<string>;

export type ZellijPipeProcess = ChildProcessWithoutNullStreams;

export type ZellijProcessDependencies = {
  listSessions: (signal?: AbortSignal) => Promise<readonly string[]>;
  runCommand: ZellijCommandRunner;
  spawnPipe: (options: {
    anchorSession: string;
    artifactPath: string;
    connectionId: string;
  }) => ZellijPipeProcess;
  verifyArtifact: () => Promise<{ artifactPath: string }>;
};

export const runZellijCommand: ZellijCommandRunner = async (args, signal) => {
  const { stdout } = await execFile("zellij", [...args], {
    encoding: "utf8",
    signal,
  });
  return stdout;
};

export const listZellijSessions = async (signal?: AbortSignal) => {
  try {
    const { stdout } = await execFile(
      "zellij",
      ["list-sessions", "--no-formatting"],
      {
        encoding: "utf8",
        // Zellij renders (current) instead of EXITED when an inherited session name is stale.
        // Clear only this subprocess's hint; backend selection still prefers the caller's live session.
        env: { ...process.env, ZELLIJ_SESSION_NAME: "" },
        signal,
      },
    );
    return parseActiveSessionList(stdout);
  } catch (error) {
    const failure = error as { code?: number | string; stderr?: string };
    if (/no active (zellij )?sessions/iu.test(failure.stderr ?? "")) {
      return [];
    }
    throw new ZellijNoSessionError(
      `Could not list Zellij sessions: ${failure.stderr?.trim() || (error instanceof Error ? error.message : String(error))}`,
    );
  }
};

export const spawnZellijPipe = ({
  anchorSession,
  artifactPath,
  connectionId,
}: {
  anchorSession: string;
  artifactPath: string;
  connectionId: string;
}) =>
  spawn(
    "zellij",
    [
      "--session",
      anchorSession,
      "pipe",
      "--name",
      `overmux-runtime-${connectionId}`,
      "--plugin",
      pathToFileURL(artifactPath).href,
      "--plugin-configuration",
      `connection_id=${connectionId}`,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );

export const defaultZellijProcessDependencies: ZellijProcessDependencies = {
  listSessions: listZellijSessions,
  runCommand: runZellijCommand,
  spawnPipe: spawnZellijPipe,
  verifyArtifact: verifyInstalledArtifact,
};
