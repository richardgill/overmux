import { z } from "zod";

const successSchema = z.object({ outcome: z.literal("success") }).strict();
const notFoundSchema = z.object({ outcome: z.literal("not-found") }).strict();
const errorSchema = z
  .object({ message: z.string(), outcome: z.literal("error") })
  .strict();

export const tmuxOperationResultSchema = z.union([
  successSchema,
  notFoundSchema,
  errorSchema,
]);

export type TmuxOperationResult = z.infer<typeof tmuxOperationResultSchema>;
