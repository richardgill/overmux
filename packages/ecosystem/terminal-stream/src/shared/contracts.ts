import { z } from "zod";

const sequenceSchema = z.number().int().nonnegative();
const terminalIdSchema = z.string().min(1);

export const terminalInputLimit = 64 * 1_024;
const binaryInputSchema = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength <= terminalInputLimit);

export const terminalInputMessageSchema = z
  .object({
    data: z.union([z.string().max(terminalInputLimit), binaryInputSchema]),
    type: z.literal("input"),
  })
  .strict();

export const terminalResizeMessageSchema = z
  .object({
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
    type: z.literal("resize"),
  })
  .strict();

export const terminalRenderedMessageSchema = z
  .object({
    sequence: sequenceSchema,
    terminalId: terminalIdSchema,
    type: z.literal("rendered"),
  })
  .strict();

export const terminalDataMessageSchema = z
  .object({
    bytes: z.instanceof(Uint8Array),
    sequence: sequenceSchema,
    terminalId: terminalIdSchema,
    type: z.literal("data"),
  })
  .strict();

export type TerminalInputMessage = z.infer<typeof terminalInputMessageSchema>;
export type TerminalResizeMessage = z.infer<typeof terminalResizeMessageSchema>;
export type TerminalRenderedMessage = z.infer<
  typeof terminalRenderedMessageSchema
>;
export type TerminalDataMessage = z.infer<typeof terminalDataMessageSchema>;
