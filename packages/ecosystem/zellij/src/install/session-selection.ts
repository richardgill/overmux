// Installation must target one existing session without an interactive ambiguity.
// This pure policy makes inside-Zellij and explicit CLI selection deterministic.
import { ZellijNoSessionError } from "./errors";

// Zellij 0.45.1's short listing hides exited status; parse the unformatted long listing instead.
// Output format: https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-utils/src/sessions.rs
export const parseActiveSessionList = (stdout: string) =>
  stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match =
        /^(.*) \[Created [^\]]+ ago\]( \(EXITED - attach to resurrect\))?$/u.exec(
          line,
        );
      if (!match) {
        throw new Error(`Unrecognized Zellij session listing: ${line}`);
      }
      return match[2] ? [] : [match[1]!];
    })
    .sort();

export const selectInstallSession = ({
  currentSession,
  requestedSession,
  sessions,
}: {
  currentSession?: string;
  requestedSession?: string;
  sessions: readonly string[];
}) => {
  if (currentSession !== undefined) {
    if (!sessions.includes(currentSession)) {
      throw new ZellijNoSessionError(
        `The current Zellij session "${currentSession}" is not active. Active sessions: ${sessions.join(", ") || "none"}`,
      );
    }
    return currentSession;
  }
  if (requestedSession !== undefined) {
    if (!sessions.includes(requestedSession)) {
      throw new ZellijNoSessionError(
        `Zellij session "${requestedSession}" is not active. Active sessions: ${sessions.join(", ") || "none"}`,
      );
    }
    return requestedSession;
  }
  if (sessions.length === 1) {
    return sessions[0] as string;
  }
  if (sessions.length === 0) {
    throw new ZellijNoSessionError(
      "No active Zellij session. Start Zellij, then run the install command again.",
    );
  }
  throw new ZellijNoSessionError(
    `Multiple Zellij sessions are active: ${sessions.join(", ")}\nRe-run with --session <name>.`,
  );
};
