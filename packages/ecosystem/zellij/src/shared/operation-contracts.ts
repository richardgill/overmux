import { z } from "zod";

const paneIdentitySchema = z
  .object({ id: z.number().int().nonnegative(), isPlugin: z.boolean() })
  .strict();
const successSchema = z
  .object({
    created: z
      .union([
        z
          .object({
            kind: z.literal("tab"),
            tabId: z.number().int().nonnegative(),
          })
          .strict(),
        z
          .object({ kind: z.literal("pane"), pane: paneIdentitySchema })
          .strict(),
      ])
      .optional(),
    outcome: z.literal("success"),
  })
  .strict();
const notFoundSchema = z.object({ outcome: z.literal("not-found") }).strict();
const errorSchema = z
  .object({ message: z.string(), outcome: z.literal("error") })
  .strict();

export const zellijOperationResultSchema = z.union([
  successSchema,
  notFoundSchema,
  errorSchema,
]);
export type ZellijOperationResult = z.infer<typeof zellijOperationResultSchema>;
export type ZellijPaneIdentity = z.infer<typeof paneIdentitySchema>;
