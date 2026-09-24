import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { defineOvermuxServer } from "overmux";
import {
  defineGitRepositories,
  gitOperationHandlers,
  gitSourceControlResource,
} from "@overmux/git/server";
import {
  definePiAgents,
  piOperationHandlers,
  piConversationStream,
} from "@overmux/pi/server";
import { defineResourceContract, noInputSchema } from "overmux";
import {
  defineTmuxControlBackend,
  tmuxOperations,
  tmuxResource,
  tmuxStream,
} from "@overmux/tmux/server";
import { z } from "zod";

import { piPaneSessionsSchema, workspaceStateSchema } from "./overmux.shared";

const execFileAsync = promisify(execFile);
const home = process.env.HOME ?? "/tmp";
const liveEventsDir =
  process.env.OVERMUX_PI_LIVE_EVENTS_DIR ??
  `${home}/.local/state/overmux/pi/events`;
const discoveredPiSessionSchema = z.object({
  session_file: z.string().min(1),
  session_id: z.string().min(1),
  tmux_pane: z.string().min(1),
});

const listPiSessions = async () => {
  try {
    const { stdout } = await execFileAsync(
      process.env.OVERMUX_AI_SESSIONS_COMMAND ?? "ai-sessions",
      ["json", "--agent=pi"],
      { encoding: "utf8" },
    );
    return z
      .array(discoveredPiSessionSchema)
      .parse(JSON.parse(stdout))
      .map(({ session_file, session_id, tmux_pane }) => ({
        agentId: session_id,
        paneId: tmux_pane,
        sessionFile: session_file,
      }));
  } catch {
    return [];
  }
};

const tmuxBackend = defineTmuxControlBackend({
  socket: process.env.OVERMUX_TMUX_SOCKET ?? "default",
});
const piAgents = definePiAgents({
  liveEventsDir,
  sessions: {
    list: async () =>
      (await listPiSessions()).map(({ agentId, sessionFile }) => ({
        id: agentId,
        sessionFile,
      })),
    subscribe: (invalidate, { signal }) => {
      const timer = setInterval(invalidate, 1_000);
      const dispose = () => clearInterval(timer);
      signal.addEventListener("abort", dispose, { once: true });
      return dispose;
    },
  },
});
const repositories = defineGitRepositories({ allowedRoots: [home] });
const tmuxState = tmuxResource({ backend: tmuxBackend });
const piPaneSessionsContract = defineResourceContract({
  input: noInputSchema,
  output: piPaneSessionsSchema,
});
const workspaceStateContract = defineResourceContract({
  input: noInputSchema,
  output: workspaceStateSchema,
});

export default defineOvermuxServer({
  operations: {
    ...tmuxOperations({ backend: tmuxBackend }),
    ...piOperationHandlers({ agents: piAgents }),
    ...gitOperationHandlers({ repositories, resourceId: "sourceControl" }),
  },
  resources: {
    tmuxState,
    piPaneSessions: {
      contract: piPaneSessionsContract,
      kind: "subscription",
      read: async () =>
        (await listPiSessions()).map(({ agentId, paneId }) => ({
          agentId,
          paneId,
        })),
      subscribe: (_input, invalidate, { signal }) => {
        const timer = setInterval(invalidate, 1_000);
        const dispose = () => clearInterval(timer);
        signal.addEventListener("abort", dispose, { once: true });
        return dispose;
      },
    },
    workspaceState: {
      combine: ({ piSessions, tmux }) => ({
        agentByPaneId: Object.fromEntries(
          piSessions.map(({ agentId, paneId }) => [paneId, { agentId }]),
        ),
        tmux,
      }),
      contract: workspaceStateContract,
      dependencies: { piSessions: "piPaneSessions", tmux: "tmuxState" },
      kind: "derived",
    },
    sourceControl: gitSourceControlResource({ repositories }),
  },
  streams: {
    piConversation: piConversationStream({ agents: piAgents }),
    tmuxTerminal: tmuxStream({ backend: tmuxBackend }),
  },
});
