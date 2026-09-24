import { durationToMilliseconds } from "@overmux/lib";
import { realpath } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { createJiti } from "jiti";
import { z } from "zod";

import { aiContextSnippets } from "@overmux/ai-context";
import { instanceIdSchema } from "../instance";

const zodTypeSchema = z.custom<z.ZodType>(
  (value) => value instanceof z.ZodType,
  "Expected a Zod schema",
);

const functionSchema = z.custom<(...args: never[]) => unknown>(
  (value) => typeof value === "function",
  "Expected a function",
);

const contractRuntimeSchema = z.object({
  input: zodTypeSchema,
  output: zodTypeSchema,
});

const operationRuntimeSchema = z.object({
  handle: functionSchema,
  input: zodTypeSchema,
  output: zodTypeSchema,
});

const streamHandlerRuntimeSchema = z.object({
  contract: z.object({
    clientMessage: zodTypeSchema,
    input: zodTypeSchema,
    serverMessage: zodTypeSchema,
  }),
  open: functionSchema,
});

const resourceDefinitionRuntimeSchema = z.discriminatedUnion("kind", [
  z.object({
    contract: contractRuntimeSchema,
    kind: z.literal("query"),
    read: functionSchema,
  }),
  z.object({
    contract: contractRuntimeSchema,
    kind: z.literal("subscription"),
    read: functionSchema,
    subscribe: functionSchema,
  }),
  z.object({
    combine: functionSchema,
    contract: contractRuntimeSchema,
    dependencies: z.record(z.string(), z.string()),
    kind: z.literal("derived"),
  }),
]);

export const authDurationSchema = z
  .string()
  .regex(/^[1-9]\d*[mhd]$/, "Expected a positive duration such as 30d")
  .refine(
    (value) => durationToMilliseconds(value) !== undefined,
    "Duration is too large",
  ) as z.ZodType<`${number}${"m" | "h" | "d"}`>;

const isLoopbackHostname = (hostname: string) =>
  hostname === "localhost" ||
  hostname === "[::1]" ||
  /^127(?:\.\d{1,3}){3}$/.test(hostname);

const exactOriginSchema = z
  .url()
  .refine((value) => new URL(value).origin === value, "Expected an origin")
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && isLoopbackHostname(url.hostname))
    );
  }, "Non-loopback Overmux origins must use HTTPS");

const loopbackPeerSchema = z
  .string()
  .refine(
    (value) =>
      isIP(value) !== 0 && (value === "::1" || value.startsWith("127.")),
    "Expected a loopback IP address",
  );

export const authConfigRuntimeSchema = z
  .object({
    mode: z.literal("cli-login"),
    origins: z
      .array(exactOriginSchema)
      .min(1)
      .refine(
        (origins) => new Set(origins).size === origins.length,
        "Expected unique origins",
      )
      .optional(),
    sessionLifetime: z
      .union([z.literal("forever"), authDurationSchema])
      .default("forever"),
    trustedProxyPeer: loopbackPeerSchema.optional(),
  })
  .strict();

export const serverConfigRuntimeSchema = z.object({
  host: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65_535).optional(),
  productionWebAssetsDir: z.string().min(1).optional(),
  watch: z.boolean().optional(),
});

export const serverDefinitionRuntimeSchema = z.object({
  operations: z.record(z.string(), operationRuntimeSchema).optional(),
  resources: z.record(z.string(), resourceDefinitionRuntimeSchema),
  streams: z.record(z.string(), streamHandlerRuntimeSchema).optional(),
});

export const configDefinitionRuntimeSchema = serverConfigRuntimeSchema.extend({
  aiContextSnippets: z.array(z.enum(aiContextSnippets)).optional(),
  auth: authConfigRuntimeSchema,
  debug: z.boolean().optional(),
  instanceId: z
    .union([
      instanceIdSchema,
      z.custom<(context: { port: number }) => string>(
        (value) => typeof value === "function",
        "Expected an instance ID or a function of the bound port",
      ),
    ])
    .optional(),
  server: serverDefinitionRuntimeSchema,
  vite: z.string().min(1).optional(),
});

export type RuntimeConfigDefinition = z.infer<
  typeof configDefinitionRuntimeSchema
>;

export type ResolvedOvermuxConfigPaths = {
  logicalApplicationRoot: string;
  logicalConfigPath: string;
  realApplicationRoot: string;
  realConfigPath: string;
};

export const resolveLogicalPath = async (path: string) => {
  const logicalPath = resolve(path);
  return { logicalPath, realPath: await realpath(logicalPath) };
};

export const resolveOvermuxConfigPaths = async (
  configPath: string,
): Promise<ResolvedOvermuxConfigPaths> => {
  const { logicalPath, realPath } = await resolveLogicalPath(configPath);
  return {
    logicalApplicationRoot: dirname(logicalPath),
    logicalConfigPath: logicalPath,
    realApplicationRoot: dirname(realPath),
    realConfigPath: realPath,
  };
};

// Jiti can wrap a default export or return it directly depending on the module format.
const unwrapDefaultExport = (module: unknown) => {
  if (typeof module === "object" && module !== null && "default" in module) {
    return module.default;
  }
  return module;
};

export const loadOvermuxConfig = async ({
  aliases = {},
  configPath,
}: {
  aliases?: Record<string, string>;
  configPath: string;
}) => {
  const paths = await resolveOvermuxConfigPaths(configPath);
  const jiti = createJiti(paths.logicalConfigPath, {
    alias: aliases,
    fsCache: true,
    jsx: {
      importSource: "react",
      runtime: "automatic",
    },
    moduleCache: false,
    sourceMaps: true,
    tsconfigPaths: true,
  });
  const module = await jiti.import(paths.logicalConfigPath);
  return {
    config: configDefinitionRuntimeSchema.parse(unwrapDefaultExport(module)),
    paths,
  };
};
