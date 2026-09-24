import {
  terminalDataMessageSchema,
  terminalInputLimit,
  terminalInputMessageSchema,
  terminalRenderedMessageSchema,
  terminalResizeMessageSchema,
} from "@overmux/terminal-stream/shared";
import { z } from "zod";

export const zellijTerminalOpenInputSchema = z
  .object({ sessionName: z.string().min(1) })
  .strict();
export const zellijTerminalInputLimit = terminalInputLimit;
export const zellijTerminalClientMessageSchema = z.discriminatedUnion("type", [
  terminalInputMessageSchema,
  terminalResizeMessageSchema,
  terminalRenderedMessageSchema,
]);
export const zellijTerminalServerMessageSchema = terminalDataMessageSchema;

export type ZellijTerminalOpenInput = z.infer<
  typeof zellijTerminalOpenInputSchema
>;
export type ZellijTerminalClientMessage = z.infer<
  typeof zellijTerminalClientMessageSchema
>;
export type ZellijTerminalServerMessage = z.infer<
  typeof zellijTerminalServerMessageSchema
>;
