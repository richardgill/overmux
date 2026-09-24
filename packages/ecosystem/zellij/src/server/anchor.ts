// Selects the one live session that hosts the otherwise global plugin connection.
// Preferences are validated, while automatic selection is stable across process runs.
// Replacement uses the same ordering and never changes the state snapshot's global scope.

import { ZellijNoSessionError } from "../install/errors";

export const selectAnchorSession = ({
  currentSession,
  preferredSession,
  sessions,
}: {
  currentSession?: string;
  preferredSession?: string;
  sessions: readonly string[];
}) => {
  const sorted = [...new Set(sessions)].sort();
  if (!sorted.length) {
    throw new ZellijNoSessionError("No active Zellij sessions were found.");
  }
  if (preferredSession) {
    if (!sorted.includes(preferredSession)) {
      throw new ZellijNoSessionError(
        `Preferred Zellij session ${JSON.stringify(preferredSession)} was not found. Active sessions: ${sorted.join(", ")}`,
      );
    }
    return preferredSession;
  }
  return currentSession && sorted.includes(currentSession)
    ? currentSession
    : sorted[0]!;
};

export const selectReplacementAnchor = ({
  previousAnchor,
  sessions,
}: {
  previousAnchor: string;
  sessions: readonly string[];
}) =>
  selectAnchorSession({
    preferredSession: sessions.includes(previousAnchor)
      ? previousAnchor
      : undefined,
    sessions,
  });
