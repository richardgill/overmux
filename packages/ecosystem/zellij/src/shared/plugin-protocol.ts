// This is the versioned wire contract between Overmux and its Zellij plugin.
// Keeping framing and validation here prevents installation and runtime from drifting.
import { z } from "zod";

import { zellijPaneInfoSchema, zellijTabInfoSchema } from "./state-contract";

export const ZELLIJ_PROTOCOL_VERSION = 1 as const;

const protocolVersionSchema = z.literal(ZELLIJ_PROTOCOL_VERSION);
const wireSessionSchema = z
  .object({
    name: z.string().min(1),
    tabs: z.array(
      z
        .object({
          info: zellijTabInfoSchema,
          panes: z.array(zellijPaneInfoSchema),
        })
        .strict(),
    ),
  })
  .strict();
const durationSchema = z
  .object({
    nanos: z.number().int().nonnegative(),
    secs: z.number().int().nonnegative(),
  })
  .strict();

export const runtimeControlMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      connectionId: z.string().min(1),
      protocolVersion: protocolVersionSchema,
      purpose: z.enum(["install", "runtime"]),
      type: z.literal("init"),
    })
    .strict(),
  z
    .object({
      connectionId: z.string().min(1),
      protocolVersion: protocolVersionSchema,
      type: z.literal("shutdown"),
    })
    .strict(),
]);

export const pluginMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      connectionId: z.string().min(1),
      pluginId: z.number().int().nonnegative(),
      pluginVersion: z.string().min(1),
      protocolVersion: protocolVersionSchema,
      type: z.literal("hello"),
    })
    .strict(),
  z
    .object({
      connectionId: z.string().min(1),
      protocolVersion: protocolVersionSchema,
      type: z.literal("install_ok"),
    })
    .strict(),
  z
    .object({
      connectionId: z.string().min(1),
      protocolVersion: protocolVersionSchema,
      resurrectableSessions: z.array(z.tuple([z.string(), durationSchema])),
      sequence: z.number().int().positive(),
      sessions: z.array(wireSessionSchema),
      type: z.literal("snapshot"),
    })
    .strict(),
  z
    .object({
      code: z.string().min(1),
      connectionId: z.string().min(1),
      message: z.string().min(1),
      protocolVersion: protocolVersionSchema,
      type: z.literal("fatal"),
    })
    .strict(),
  z
    .object({
      connectionId: z.string().min(1),
      protocolVersion: protocolVersionSchema,
      type: z.literal("bye"),
    })
    .strict(),
]);

export type RuntimeControlMessage = z.infer<typeof runtimeControlMessageSchema>;
export type PluginMessage = z.infer<typeof pluginMessageSchema>;

export const encodeControlMessage = (message: RuntimeControlMessage) =>
  `${JSON.stringify(runtimeControlMessageSchema.parse(message))}\n`;

export const parsePluginMessage = (line: string): PluginMessage => {
  const value = JSON.parse(line) as unknown;
  return pluginMessageSchema.parse(value);
};
