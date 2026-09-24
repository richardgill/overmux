import { z } from "zod";

// tmux assigns session IDs as `$` followed by a number, e.g. `$1`.
const sessionIdPattern = /^\$\d+$/;

// tmux assigns window IDs as `@` followed by a number, e.g. `@2`.
const windowIdPattern = /^@\d+$/;

// tmux assigns pane IDs as `%` followed by a number, e.g. `%3`.
const paneIdPattern = /^%\d+$/;

export const tmuxSessionIdSchema = z.string().regex(sessionIdPattern);
export const tmuxWindowIdSchema = z.string().regex(windowIdPattern);
export const tmuxPaneIdSchema = z.string().regex(paneIdPattern);

export const isTmuxSessionId = (value: string | undefined): value is string =>
  Boolean(value && sessionIdPattern.test(value));

export const isTmuxWindowId = (value: string | undefined): value is string =>
  Boolean(value && windowIdPattern.test(value));

export const isTmuxPaneId = (value: string | undefined): value is string =>
  Boolean(value && paneIdPattern.test(value));

// tmux format expressions interpolate values in command output, e.g. `#{session_id}` becomes `$1`.
export const tmuxFormats = {
  clientControlMode: "#{client_control_mode}",
  configFiles: "#{config_files}",
  clientFlags: "#{client_flags}",
  clientHeight: "#{client_height}",
  clientName: "#{client_name}",
  clientPid: "#{client_pid}",
  clientWidth: "#{client_width}",
  paneActive: "#{pane_active}",
  paneCurrentCommand: "#{pane_current_command}",
  paneCurrentPath: "#{pane_current_path}",
  paneId: "#{pane_id}",
  paneInMode: "#{pane_in_mode}",
  paneIndex: "#{pane_index}",
  paneTitle: "#{pane_title}",
  sessionId: "#{session_id}",
  sessionName: "#{session_name}",
  windowId: "#{window_id}",
  windowIndex: "#{window_index}",
  windowName: "#{window_name}",
} as const;
