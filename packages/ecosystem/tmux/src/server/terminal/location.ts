import {
  tmuxTerminalLocationSchema,
  type TmuxTerminalLocation,
  type TmuxTerminalTarget,
} from "../../shared/terminal-contracts";
import { tmuxFormats } from "../../shared/tmux-values";
import type { TmuxBackend } from "../backend";

export const terminalLocationFormat = [
  tmuxFormats.clientName,
  "#{session_id}",
  "#{window_id}",
  "#{pane_id}",
].join("\u001f");

export const findTerminalLocation = (clients: string, clientName: string) => {
  const client = clients
    .trim()
    .split("\n")
    .map((line) => line.replaceAll("\\037", "\u001f").split("\u001f"))
    .find(([name]) => name === clientName);
  const parsed = tmuxTerminalLocationSchema.safeParse({
    sessionId: client?.[1],
    windowId: client?.[2],
    paneId: client?.[3],
  });
  return parsed.success ? parsed.data : undefined;
};

// Validate membership, not tmux's forgiving target lookup: an ID alone may resolve in another
// session. A linked window is valid only when explicitly linked into the requested session.
export const requireTerminalTarget = async (
  backend: TmuxBackend,
  target: TmuxTerminalTarget,
  signal: AbortSignal,
) => {
  const { sessionId, windowId, paneId }: Partial<TmuxTerminalLocation> = target;
  const resolved = (
    await backend.run(
      ["display-message", "-p", "-t", `${sessionId}:`, tmuxFormats.sessionId],
      signal,
    )
  ).trim();
  if (resolved !== sessionId) {
    throw new Error(`Tmux session ${sessionId} was not found`);
  }
  if (!windowId) {
    return;
  }
  const windows = await backend.run(
    ["list-windows", "-t", `=${sessionId}`, "-F", "#{window_id}"],
    signal,
  );
  if (!windows.trim().split("\n").includes(windowId)) {
    throw new Error(
      `Tmux window ${windowId} does not belong to session ${sessionId}`,
    );
  }
  if (!paneId) {
    return;
  }
  const panes = await backend.run(
    ["list-panes", "-t", `=${sessionId}:${windowId}`, "-F", "#{pane_id}"],
    signal,
  );
  if (!panes.trim().split("\n").includes(paneId)) {
    throw new Error(
      `Tmux pane ${paneId} does not belong to window ${windowId}`,
    );
  }
};

export const terminalSelectionCommands = (
  clientName: string,
  target: TmuxTerminalTarget,
) => {
  const { sessionId, windowId, paneId }: Partial<TmuxTerminalLocation> = target;
  return [
    ["switch-client", "-c", clientName, "-t", `=${sessionId}`],
    ...(windowId ? [["select-window", "-t", `=${sessionId}:${windowId}`]] : []),
    ...(paneId
      ? [["select-pane", "-t", `=${sessionId}:${windowId}.${paneId}`]]
      : []),
  ];
};

export const terminalLocationMatches = (
  location: TmuxTerminalLocation,
  target: TmuxTerminalTarget,
) =>
  Object.entries(target).every(
    ([key, value]) => location[key as keyof TmuxTerminalLocation] === value,
  );
