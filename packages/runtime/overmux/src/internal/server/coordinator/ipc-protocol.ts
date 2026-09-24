// Defines the complete validated IPC boundary between coordinator and child.
// Application traffic never crosses this process boundary.

import { z } from "zod";

const childOptionsSchema = z.object({
  configAliases: z.record(z.string(), z.string()).optional(),
  configPath: z.string(),
  debug: z.boolean().optional(),
  developmentWebTarget: z.url().optional(),
  host: z.string().optional(),
  port: z.number().int().min(0).max(65_535).optional(),
  productionWebAssetsDir: z.string().optional(),
  watch: z.boolean().optional(),
});

const parentMessageSchema = z.discriminatedUnion("type", [
  z.object({ options: childOptionsSchema, type: z.literal("start") }),
  z.object({ type: z.literal("update-available") }),
  z.object({ type: z.literal("stop") }),
]);

const childMessageSchema = z.discriminatedUnion("type", [
  z.object({
    host: z.string(),
    port: z.number().int().min(1).max(65_535),
    type: z.literal("ready"),
    url: z.string(),
    watch: z.boolean(),
  }),
  z.object({ type: z.literal("restart-requested") }),
  z.object({ message: z.string(), type: z.literal("startup-failed") }),
]);

export type ChildServerOptions = z.infer<typeof childOptionsSchema>;
export type ParentToChildMessage = z.infer<typeof parentMessageSchema>;
export type ChildToParentMessage = z.infer<typeof childMessageSchema>;

export const parseParentMessage = (value: unknown): ParentToChildMessage =>
  parentMessageSchema.parse(value);

export const parseChildMessage = (value: unknown): ChildToParentMessage =>
  childMessageSchema.parse(value);
