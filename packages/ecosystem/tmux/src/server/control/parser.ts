// Decodes streaming tmux control-mode output into command blocks and typed notifications.
// `tmux -C` writes command responses and unsolicited state changes to the same output stream.
// Command output is framed by matching `%begin` and `%end` or `%error` lines.
import {
  isTmuxPaneId,
  isTmuxSessionId,
  isTmuxWindowId,
} from "../../shared/tmux-values";

// Example: %begin 1710000000 42 0
const commandGuardPattern = /^%(begin|end|error) (\d+) (\d+) (\d+)$/;
// Matches every tmux octal escape such as `\040` for space and `\134` for backslash, plus escaped `\\`.
const tmuxEscapedCharacterPattern = /\\([0-7]{3}|\\)/g;

// Tmux repeats these three values on a command block's opening and closing lines so they can be paired.
export type TmuxControlGuard = {
  commandNumber: number;
  flags: number;
  timestamp: number;
};

// Normalizes tmux's unsolicited `%...` lines into application-facing event names and fields.
export type TmuxControlNotification =
  | {
      clientName: string;
      name: string;
      sessionId: string;
      type: "client-session-changed";
    }
  | { sessionId: string; type: "session-window-changed"; windowId: string }
  | { paneId: string; type: "window-pane-changed"; windowId: string }
  | { type: "window-added"; windowId: string }
  | { type: "window-closed"; windowId: string }
  | { name: string; type: "window-renamed"; windowId: string }
  | { type: "sessions-changed" }
  | { type: "layout-changed"; windowId: string };

// Our event for tmux's `%begin` line; the command's output follows in later lines.
export type TmuxControlBlockStarted = {
  guard: TmuxControlGuard;
  type: "block-started";
};
// Our event for output closed by tmux's matching `%end` line.
export type TmuxControlBlockCompleted = {
  guard: TmuxControlGuard;
  output: string;
  type: "block-completed";
};
// Our event for error output closed by tmux's matching `%error` line.
export type TmuxControlBlockFailed = {
  guard: TmuxControlGuard;
  output: string;
  type: "block-failed";
};
// Everything a consumer can receive after the raw tmux control stream has been parsed and normalized.
export type TmuxControlProtocolEvent =
  | TmuxControlBlockStarted
  | TmuxControlBlockCompleted
  | TmuxControlBlockFailed
  | TmuxControlNotification;

export const isTmuxControlNotification = (
  event: TmuxControlProtocolEvent,
): event is TmuxControlNotification => {
  switch (event.type) {
    case "client-session-changed":
    case "session-window-changed":
    case "window-pane-changed":
    case "window-added":
    case "window-closed":
    case "window-renamed":
    case "sessions-changed":
    case "layout-changed":
      return true;
    case "block-started":
    case "block-completed":
    case "block-failed":
      return false;
  }
};

type ActiveCommandBlock = { guard: TmuxControlGuard; outputLines: string[] };
type CommandGuardLine = {
  guard: TmuxControlGuard;
  kind: "begin" | "end" | "error";
};
type ClosingCommandGuardLine = CommandGuardLine & { kind: "end" | "error" };

const commandGuardsMatch = (left: TmuxControlGuard, right: TmuxControlGuard) =>
  left.timestamp === right.timestamp &&
  left.commandNumber === right.commandNumber &&
  left.flags === right.flags;

const parseCommandGuardLine = (line: string): CommandGuardLine | undefined => {
  const match = commandGuardPattern.exec(line);
  if (!match) {
    return undefined;
  }
  return {
    guard: {
      commandNumber: Number(match[3]),
      flags: Number(match[4]),
      timestamp: Number(match[2]),
    },
    kind: match[1] as CommandGuardLine["kind"],
  };
};

const isClosingGuardForBlock = (
  guardLine: CommandGuardLine | undefined,
  block: ActiveCommandBlock,
): guardLine is ClosingCommandGuardLine =>
  Boolean(
    guardLine &&
    guardLine.kind !== "begin" &&
    commandGuardsMatch(block.guard, guardLine.guard),
  );

export const decodeTmuxEscapes = (value: string) =>
  value.replace(tmuxEscapedCharacterPattern, (_match, escaped: string) =>
    escaped === "\\" ? "\\" : String.fromCharCode(Number.parseInt(escaped, 8)),
  );

const isSessionId = isTmuxSessionId;
const isWindowId = isTmuxWindowId;
const isPaneId = isTmuxPaneId;

const parseNotification = (
  line: string,
): TmuxControlNotification | undefined => {
  const [notificationName, first, second, ...rest] = line.split(" ");

  if (notificationName === "%client-session-changed") {
    if (first === undefined || !isSessionId(second)) {
      return undefined;
    }
    const clientName = decodeTmuxEscapes(first);
    const sessionName = decodeTmuxEscapes(rest.join(" "));
    if (!clientName || /\s/.test(clientName) || !sessionName) {
      return undefined;
    }
    return {
      clientName,
      name: sessionName,
      sessionId: second,
      type: "client-session-changed",
    };
  }

  if (notificationName === "%session-window-changed") {
    if (!isSessionId(first) || !isWindowId(second)) {
      return undefined;
    }
    return {
      sessionId: first,
      type: "session-window-changed",
      windowId: second,
    };
  }

  if (notificationName === "%window-pane-changed") {
    if (!isWindowId(first) || !isPaneId(second)) {
      return undefined;
    }
    return { paneId: second, type: "window-pane-changed", windowId: first };
  }

  if (
    notificationName === "%window-add" ||
    notificationName === "%unlinked-window-add"
  ) {
    return isWindowId(first)
      ? { type: "window-added", windowId: first }
      : undefined;
  }

  if (
    notificationName === "%window-close" ||
    notificationName === "%unlinked-window-close"
  ) {
    return isWindowId(first)
      ? { type: "window-closed", windowId: first }
      : undefined;
  }

  if (
    notificationName === "%window-renamed" ||
    notificationName === "%unlinked-window-renamed"
  ) {
    if (!isWindowId(first) || second === undefined) {
      return undefined;
    }
    return {
      name: decodeTmuxEscapes([second, ...rest].join(" ")),
      type: "window-renamed",
      windowId: first,
    };
  }

  if (notificationName === "%sessions-changed") {
    return { type: "sessions-changed" };
  }

  if (notificationName === "%layout-change") {
    return isWindowId(first)
      ? { type: "layout-changed", windowId: first }
      : undefined;
  }

  return undefined;
};

// Feed each stdout chunk to `push`; it returns every complete event decoded from that chunk.
// Call `finish` when the tmux process closes to flush trailing UTF-8 and a final unterminated line.
export const createTmuxControlParser = (): {
  finish: () => TmuxControlProtocolEvent[];
  push: (chunk: Uint8Array) => TmuxControlProtocolEvent[];
} => {
  const decoder = new TextDecoder();
  let activeCommandBlock: ActiveCommandBlock | undefined;
  let partialLine = "";

  const parseProtocolLine = (line: string): TmuxControlProtocolEvent[] => {
    const guardLine = parseCommandGuardLine(line);
    if (activeCommandBlock) {
      if (isClosingGuardForBlock(guardLine, activeCommandBlock)) {
        const guard = activeCommandBlock.guard;
        const output = activeCommandBlock.outputLines.length
          ? `${activeCommandBlock.outputLines.join("\n")}\n`
          : "";
        activeCommandBlock = undefined;
        return guardLine.kind === "end"
          ? [{ guard, output, type: "block-completed" }]
          : [{ guard, output, type: "block-failed" }];
      }
      activeCommandBlock.outputLines.push(line);
      return [];
    }

    if (guardLine?.kind === "begin") {
      activeCommandBlock = { guard: guardLine.guard, outputLines: [] };
      return [{ guard: guardLine.guard, type: "block-started" }];
    }

    const notification = parseNotification(line);
    return notification ? [notification] : [];
  };

  const consumeDecodedText = (decodedText: string) => {
    partialLine += decodedText;
    const completeLines = partialLine.split("\n");
    partialLine = completeLines.pop() ?? "";
    return completeLines.flatMap((line) =>
      parseProtocolLine(line.endsWith("\r") ? line.slice(0, -1) : line),
    );
  };

  return {
    finish: () => {
      const events = consumeDecodedText(decoder.decode());
      if (partialLine) {
        const line = partialLine;
        partialLine = "";
        events.push(...parseProtocolLine(line));
      }
      activeCommandBlock = undefined;
      return events;
    },
    push: (chunk) =>
      consumeDecodedText(decoder.decode(chunk, { stream: true })),
  };
};
