import { Serializer, Deserializer } from "node:v8";
import type { Worker } from "node:worker_threads";
import type { RuntimeConfigSettings } from "@overmux/shared/node";
import type { RuntimeManifest } from "../../shared/index";
import { z } from "zod";
import { ProtocolError, protocolErrorCodeSchema } from "../protocol-error";
import { OperationValidationError } from "./runtime-operations";

// Credits bound all worker-to-main traffic together, not just each terminal.
export const workerLimits = {
  messageBytes: 1024 * 1024,
  pendingRequests: 256,
  pendingBytes: 8 * 1024 * 1024,
  eventCount: 768,
  eventBytes: 8 * 1024 * 1024,
  lifetimes: 128,
  notifications: 32,
  startupMs: 10_000,
  streams: 64,
  shutdownMs: 1_000,
} as const;

const errorMetadata = {
  message: z.string().max(8192),
  name: z.string().max(256),
  code: protocolErrorCodeSchema.optional(),
};

export const workerErrorSchema = z.union([
  z.strictObject({
    ...errorMetadata,
    category: z.never().optional(),
    phase: z.never().optional(),
  }),
  z.strictObject({
    ...errorMetadata,
    category: z.literal("operation-validation"),
    phase: z.enum(["input", "output"]),
  }),
]);

export type WorkerError = z.infer<typeof workerErrorSchema>;

export const serializeWorkerError = (cause: unknown): WorkerError => {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  const candidateCode = (error as Error & { code?: unknown }).code;
  // Native codes (such as ENOENT and numeric DOMException codes) are not protocol codes.
  const parsedCode = protocolErrorCodeSchema.safeParse(candidateCode);
  const code = parsedCode.success
    ? parsedCode.data
    : error.name === "ZodError" || error instanceof SyntaxError
      ? "bad-request"
      : undefined;
  const metadata = {
    // Error metadata also crosses bounded control traffic, including fatal reports.
    message: error.message.slice(0, 8192),
    name: error.name.slice(0, 256),
    ...(code ? { code } : {}),
  };
  return cause instanceof OperationValidationError
    ? { ...metadata, category: "operation-validation", phase: cause.phase }
    : metadata;
};

export const deserializeWorkerError = (value: unknown): Error => {
  const parsed = workerErrorSchema.safeParse(value);
  if (!parsed.success) {
    // Invalid wire metadata is a bridge failure, never client input validation.
    throw new Error("Invalid worker error envelope", { cause: parsed.error });
  }
  const metadata = parsed.data;
  const error =
    metadata.category === "operation-validation"
      ? new OperationValidationError(
          metadata.phase,
          new Error(metadata.message),
        )
      : new ProtocolError(metadata.code ?? "internal", metadata.message);
  error.name = metadata.name;
  return error;
};

// Native V8 serialization includes complete backing stores and shared-view identity.
// DefaultSerializer stores visible view bytes instead, unlike structured cloning.
// Charge and transfer this exact representation, never the original object or a slab.
export const encodeWorkerMessage = (message: unknown) => {
  const serializer = new Serializer();
  serializer.writeHeader();
  serializer.writeValue(message);
  const bytes = serializer.releaseBuffer();
  if (bytes.byteLength > workerLimits.messageBytes) {
    throw new Error("Worker message exceeds 1 MiB");
  }
  return Uint8Array.from(bytes);
};

export const decodeWorkerMessage = <T>(bytes: Uint8Array): T => {
  if (
    !(bytes instanceof Uint8Array) ||
    !(bytes.buffer instanceof ArrayBuffer) ||
    bytes.byteOffset !== 0 ||
    bytes.byteLength !== bytes.buffer.byteLength ||
    bytes.byteLength > workerLimits.messageBytes
  ) {
    throw new Error("Invalid worker transport buffer");
  }
  const deserializer = new Deserializer(bytes);
  deserializer.readHeader();
  return deserializer.readValue() as T;
};

export const postWorkerMessage = (
  port: Pick<Worker, "postMessage">,
  bytes: Uint8Array<ArrayBuffer>,
) => port.postMessage(bytes, [bytes.buffer]);

export type WorkerRequest = {
  id: number;
  action:
    | "resource-read"
    | "resource-subscribe"
    | "operation"
    | "stream-open"
    | "stream-message"
    | "initialize-instance-identity";
  name?: string;
  input?: unknown;
  sessionId?: number;
  message?: unknown;
  port?: number;
  instanceId?: string;
};

export type WorkerInit = {
  type: "init";
  configPath: string;
  aliases: Record<string, string>;
  debug?: boolean;
  // Unselected definitions are constructed on import, but never activated.
  role: "application" | "stream" | "metadata";
  stream?: string;
};

export type WorkerReady = {
  type: "ready";
  manifest: RuntimeManifest;
  settings: RuntimeConfigSettings;
  voidOperations: string[];
};

export type WorkerEvent =
  | { type: "closed"; sessionId: number; error?: WorkerError }
  | { type: "invalidate"; sessionId: number }
  | { type: "stream-output"; sessionId: number; message: unknown }
  | { type: "stream-error"; sessionId: number; error: WorkerError }
  | { type: "notification"; id: number; notification: unknown };

export type WorkerDelivery = (
  | WorkerEvent
  | {
      type: "reply";
      id: number;
      ok: boolean;
      value?: unknown;
      error?: WorkerError;
    }
) & { deliveryId: number };
