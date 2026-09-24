import type {
  TmuxPane,
  TmuxSession,
  TmuxState,
  TmuxWindow,
} from "../shared/state-contract";
import type { TmuxControlNotification } from "./control/parser";

export const tmuxSocketArguments = (socket: string) =>
  socket.startsWith("/") ? ["-S", socket] : ["-L", socket];

export type TmuxBackend = {
  id: string;
  socket: string;
  configPath?: string;
  run: (args: readonly string[], signal?: AbortSignal) => Promise<string>;
  state: () => TmuxState;
  refresh: (signal?: AbortSignal) => Promise<TmuxState>;
  subscribe: (listener: () => void) => () => void;
  subscribeNotifications: (
    listener: (event: TmuxControlNotification) => void,
  ) => () => void;
};

export type { TmuxPane, TmuxSession, TmuxState, TmuxWindow };
