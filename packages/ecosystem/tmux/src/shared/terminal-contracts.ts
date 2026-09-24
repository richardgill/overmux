import {
  terminalDataMessageSchema,
  terminalInputLimit,
  terminalInputMessageSchema,
  terminalRenderedMessageSchema,
  terminalResizeMessageSchema,
} from "@overmux/terminal-stream/shared";
import { z } from "zod";

import {
  tmuxPaneIdSchema,
  tmuxSessionIdSchema,
  tmuxWindowIdSchema,
} from "./tmux-values";

export const tmuxTerminalOpenInputSchema = z.void();
export const tmuxTerminalInputLimit = terminalInputLimit;

export const tmuxTerminalLocationSchema = z
  .object({
    sessionId: tmuxSessionIdSchema,
    windowId: tmuxWindowIdSchema,
    paneId: tmuxPaneIdSchema,
  })
  .strict();

export const tmuxTerminalTargetSchema = z.union([
  z.object({ sessionId: tmuxSessionIdSchema }).strict(),
  z
    .object({ sessionId: tmuxSessionIdSchema, windowId: tmuxWindowIdSchema })
    .strict(),
  tmuxTerminalLocationSchema,
]);

const requestIdSchema = z.number().int().nonnegative().safe();
const goToMessageSchema = z
  .object({
    requestId: requestIdSchema,
    target: tmuxTerminalTargetSchema,
    type: z.literal("go-to"),
  })
  .strict();

const redrawMessageSchema = z.object({ type: z.literal("redraw") }).strict();

export const tmuxTerminalClientMessageSchema = z.discriminatedUnion("type", [
  terminalInputMessageSchema,
  terminalResizeMessageSchema,
  goToMessageSchema,
  redrawMessageSchema,
  terminalRenderedMessageSchema,
]);

const locationChangedMessageSchema = z
  .object({
    location: tmuxTerminalLocationSchema,
    // Monotonic observations order native changes and request confirmations on this stream.
    revision: requestIdSchema,
    type: z.literal("location-changed"),
  })
  .strict();

const goToResultMessageSchema = z
  .object({
    requestId: requestIdSchema,
    result: z.discriminatedUnion("outcome", [
      z
        .object({
          outcome: z.literal("success"),
          location: tmuxTerminalLocationSchema,
          revision: requestIdSchema,
        })
        .strict(),
      z.object({ outcome: z.literal("error"), message: z.string() }).strict(),
    ]),
    type: z.literal("go-to-result"),
  })
  .strict();

export const tmuxTerminalServerMessageSchema = z.discriminatedUnion("type", [
  terminalDataMessageSchema,
  locationChangedMessageSchema,
  goToResultMessageSchema,
]);

export type TmuxTerminalLocation = z.infer<typeof tmuxTerminalLocationSchema>;
export type TmuxTerminalTarget = z.infer<typeof tmuxTerminalTargetSchema>;
export type TmuxTerminalOpenInput = z.infer<typeof tmuxTerminalOpenInputSchema>;
export type TmuxTerminalClientMessage = z.infer<
  typeof tmuxTerminalClientMessageSchema
>;
export type TmuxTerminalServerMessage = z.infer<
  typeof tmuxTerminalServerMessageSchema
>;
