import type {
  TmuxTerminalClient,
  TmuxTerminalLocation,
  TmuxTerminalTarget,
} from "../client/terminal-client";

import { tmuxTerminalTargetSchema } from "../shared/terminal-contracts";

// Remember only the session to reattach. Tmux owns its current window and pane for a session.
// Explicit requests use the low-level client's promises unchanged: no replay on interruption.
export const createSessionReattachment = (
  onError: (error: Error | undefined) => void,
) => {
  let session: { sessionId: string } | undefined;
  let requested = false;
  let revision = 0;

  return {
    observe: (location: TmuxTerminalLocation | undefined) => {
      if (location) {
        session = { sessionId: location.sessionId };
        onError(undefined);
      }
    },
    reset: () => {
      requested = false;
      revision += 1;
    },
    goTo: (client: TmuxTerminalClient, target: TmuxTerminalTarget) => {
      if (!tmuxTerminalTargetSchema.safeParse(target).success) {
        return client.goTo(target);
      }
      requested = true;
      revision += 1;
      onError(undefined);
      return client.goTo(target);
    },
    restore: (client: TmuxTerminalClient) => {
      if (requested || !session) {
        return;
      }
      requested = true;
      const target = session;
      const attempt = ++revision;
      void client.goTo(target).catch((error: Error) => {
        // Ignore failures from an old connection or an attachment superseded by goTo.
        if (attempt !== revision) {
          return;
        }
        // A failed session is not retried on every reconnect. Keep a newer observation.
        if (session === target) {
          session = undefined;
        }
        onError(error);
      });
    },
  };
};
