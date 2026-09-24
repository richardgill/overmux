import { env as cloudflareEnv } from "cloudflare:workers";
import { z } from "zod";

type WorkerEnvLoader = () => Promise<unknown>;

const defaultPostHogLogsEndpoint = "https://eu.i.posthog.com/i/v1/logs";
const requiredBinding = (name: string) =>
  z.string().min(1, `Cloudflare ${name} binding is required`);
const versionMetadataSchema = z
  .object({
    id: z.string().min(1),
    tag: z.string().min(1),
    timestamp: z.string().min(1),
  })
  .strict();
const workerEnvSchema = z
  .object({
    ENVIRONMENT: z.enum(["local", "main", "preview"], {
      error: "Cloudflare ENVIRONMENT binding must be local, main, or preview",
    }),
    GIT_SHA: requiredBinding("GIT_SHA"),
    PUBLIC_POSTHOG_KEY: requiredBinding("PUBLIC_POSTHOG_KEY"),
    POSTHOG_LOGS_ENDPOINT: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.url().default(defaultPostHogLogsEndpoint),
    ),
    SERVICE_NAME: requiredBinding("SERVICE_NAME"),
    VERSION_METADATA: versionMetadataSchema.optional().catch(undefined),
  })
  .strict();
const workerEnvKeys = workerEnvSchema.keyof().options;

export type WorkerVersionMetadata = z.infer<typeof versionMetadataSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export const parseWorkerEnv = (value: unknown): WorkerEnv => {
  const bindings =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};

  return workerEnvSchema.parse(
    Object.fromEntries(workerEnvKeys.map((key) => [key, bindings[key]])),
  );
};

const importCloudflareWorkersEnv: WorkerEnvLoader = async () => cloudflareEnv;

export const hasWorkerEnv = cloudflareEnv !== undefined;

export const createWorkerEnvReader = (loadEnv: WorkerEnvLoader) => {
  let cachedEnv: Promise<WorkerEnv> | undefined;

  return async () => {
    if (!cachedEnv) {
      cachedEnv = loadEnv().then(parseWorkerEnv);
    }
    return await cachedEnv;
  };
};

export const getWorkerEnv = createWorkerEnvReader(importCloudflareWorkersEnv);
