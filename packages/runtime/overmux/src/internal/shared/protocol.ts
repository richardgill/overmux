import { z } from "zod";
import { instanceIdSchema } from "@overmux/shared";

import { notificationSchema } from "../../public/notifications";

// Compatibility gate, not negotiation: open tabs may still run older client assets.
// The exact version rejects incompatible runtime manifest and wire formats before later traffic.
export const protocolVersion = 10 as const;

// Application-defined WebSocket close codes shared by server and browser transports.
export const webSocketCloseCode = {
  authenticationRevoked: 4001,
  authenticationUnavailable: 4002,
} as const;

export const runtimeManifestSchema = z.object({
  debug: z.boolean(),
  operations: z.array(z.string().min(1)),
  protocolVersion: z.literal(protocolVersion),
  resources: z.array(z.string().min(1)),
  streams: z.array(z.string().min(1)),
});

export const updateAvailableEventSchema = z.object({
  type: z.literal("update-available"),
});

export const restartingEventSchema = z.object({
  type: z.literal("restarting"),
});

export const serverLifecycleEventSchema = z.discriminatedUnion("type", [
  updateAvailableEventSchema,
  restartingEventSchema,
]);

export const notificationEventSchema = z
  .object({
    notification: notificationSchema,
    type: z.literal("notification"),
  })
  .strict();

const operationIdSchema = z.string().min(1).max(256);
const registrationNameSchema = z.string().min(1).max(256);

export const resourceReadMessageSchema = z.object({
  input: z.unknown().optional(),
  operationId: operationIdSchema,
  resourceName: registrationNameSchema,
  type: z.literal("resource-read"),
});

export const resourceSubscribeMessageSchema = z.object({
  input: z.unknown().optional(),
  operationId: operationIdSchema,
  resourceName: registrationNameSchema,
  subscriptionId: operationIdSchema,
  type: z.literal("resource-subscribe"),
});

export const resourceUnsubscribeMessageSchema = z.object({
  subscriptionId: operationIdSchema,
  type: z.literal("resource-unsubscribe"),
});

export const streamOpenMessageSchema = z.object({
  input: z.unknown().optional(),
  operationId: operationIdSchema,
  streamId: operationIdSchema,
  streamName: registrationNameSchema,
  type: z.literal("stream-open"),
});

export const streamMessageSchema = z.object({
  message: z.unknown(),
  streamId: operationIdSchema,
  type: z.literal("stream-message"),
});

export const streamCloseMessageSchema = z.object({
  streamId: operationIdSchema,
  type: z.literal("stream-close"),
});

export const clientDiagnosticEventSchema = z.object({
  arguments: z.string().max(16_100),
  level: z.enum(["log", "info", "warn", "error", "debug"]),
  message: z.string().max(4_100),
  stack: z.string().max(8_100).optional(),
  timestamp: z.iso.datetime(),
  type: z.literal("client-diagnostic"),
  url: z.string().max(2_100).optional(),
});

export const clientProtocolMessageSchema = z.discriminatedUnion("type", [
  resourceReadMessageSchema,
  resourceSubscribeMessageSchema,
  resourceUnsubscribeMessageSchema,
  streamOpenMessageSchema,
  streamMessageSchema,
  streamCloseMessageSchema,
  clientDiagnosticEventSchema,
]);

export const resourceResultMessageSchema = z.object({
  operationId: operationIdSchema,
  output: z.unknown(),
  type: z.literal("resource-result"),
});

export const resourceInvalidatedMessageSchema = z.object({
  subscriptionId: operationIdSchema,
  type: z.literal("resource-invalidated"),
});

export const streamOpenedMessageSchema = z.object({
  operationId: operationIdSchema,
  streamId: operationIdSchema,
  type: z.literal("stream-opened"),
});

export const streamOutputMessageSchema = z.object({
  message: z.unknown(),
  streamId: operationIdSchema,
  type: z.literal("stream-output"),
});

export const streamClosedMessageSchema = z.object({
  streamId: operationIdSchema,
  type: z.literal("stream-closed"),
});

export const protocolErrorMessageSchema = z.object({
  code: z.enum(["bad-request", "conflict", "internal", "not-found"]),
  message: z.string(),
  operationId: operationIdSchema.optional(),
  streamId: operationIdSchema.optional(),
  subscriptionId: operationIdSchema.optional(),
  type: z.literal("error"),
});

export const serverInfoMessageSchema = z
  .object({
    type: z.literal("server-info"),
    instanceId: instanceIdSchema,
  })
  .strict();

export const serverProtocolMessageSchema = z.discriminatedUnion("type", [
  serverInfoMessageSchema,
  resourceResultMessageSchema,
  resourceInvalidatedMessageSchema,
  streamOpenedMessageSchema,
  streamOutputMessageSchema,
  streamClosedMessageSchema,
  protocolErrorMessageSchema,
  updateAvailableEventSchema,
  restartingEventSchema,
  notificationEventSchema,
]);

const byteMarker = "$overmuxBytes";

type EncodedBytes = { [byteMarker]: number[] };

const encodeValue = (value: unknown): unknown => {
  if (value instanceof Uint8Array) {
    return { [byteMarker]: Array.from(value) } satisfies EncodedBytes;
  }
  if (Array.isArray(value)) {
    return value.map(encodeValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, encodeValue(item)]),
    );
  }
  return value;
};

const decodeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(decodeValue);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length === 1 &&
    Array.isArray(record[byteMarker]) &&
    record[byteMarker].every(
      (item) => Number.isInteger(item) && item >= 0 && item <= 255,
    )
  ) {
    return Uint8Array.from(record[byteMarker] as number[]);
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, decodeValue(item)]),
  );
};

const binaryMarker = "$overmuxBinary";
const binaryMagic = 0x4f4d5801;

type EncodedBinary = { [binaryMarker]: [number, number] };

const encodeBinaryValue = (
  value: unknown,
  payloads: Uint8Array[],
  offset: { value: number },
): unknown => {
  if (value instanceof Uint8Array) {
    const marker = {
      [binaryMarker]: [offset.value, value.byteLength],
    } satisfies EncodedBinary;
    payloads.push(value);
    offset.value += value.byteLength;
    return marker;
  }
  if (Array.isArray(value)) {
    return value.map((item) => encodeBinaryValue(item, payloads, offset));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        encodeBinaryValue(item, payloads, offset),
      ]),
    );
  }
  return value;
};

const decodeBinaryValue = (value: unknown, payload: Uint8Array): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => decodeBinaryValue(item, payload));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const marker = record[binaryMarker];
  if (
    Object.keys(record).length === 1 &&
    Array.isArray(marker) &&
    marker.length === 2 &&
    marker.every((item) => Number.isInteger(item) && item >= 0)
  ) {
    const [offset, length] = marker as [number, number];
    if (offset + length > payload.byteLength) {
      throw new Error("Invalid Overmux binary payload range");
    }
    return payload.slice(offset, offset + length);
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [
      key,
      decodeBinaryValue(item, payload),
    ]),
  );
};

export const encodeProtocolMessage = (message: unknown): string =>
  JSON.stringify(encodeValue(message));

export const decodeProtocolMessage = (message: string): unknown =>
  decodeValue(JSON.parse(message));

export const encodeProtocolFrame = (message: unknown): string | Uint8Array => {
  const payloads: Uint8Array[] = [];
  const encoded = encodeBinaryValue(message, payloads, { value: 0 });
  if (!payloads.length) {
    return JSON.stringify(encoded);
  }
  const header = new TextEncoder().encode(JSON.stringify(encoded));
  const payloadLength = payloads.reduce(
    (total, payload) => total + payload.byteLength,
    0,
  );
  const frame = new Uint8Array(8 + header.byteLength + payloadLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, binaryMagic);
  view.setUint32(4, header.byteLength);
  frame.set(header, 8);
  let offset = 8 + header.byteLength;
  payloads.forEach((payload) => {
    frame.set(payload, offset);
    offset += payload.byteLength;
  });
  return frame;
};

export const decodeProtocolFrame = (
  frame: string | ArrayBuffer | Uint8Array,
): unknown => {
  if (typeof frame === "string") {
    return decodeProtocolMessage(frame);
  }
  const bytes =
    frame instanceof Uint8Array
      ? frame
      : new Uint8Array(frame, 0, frame.byteLength);
  if (bytes.byteLength < 8) {
    throw new Error("Invalid Overmux binary frame");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== binaryMagic) {
    throw new Error("Invalid Overmux binary frame magic");
  }
  const headerLength = view.getUint32(4);
  if (8 + headerLength > bytes.byteLength) {
    throw new Error("Invalid Overmux binary frame header");
  }
  const header = JSON.parse(
    new TextDecoder().decode(bytes.subarray(8, 8 + headerLength)),
  ) as unknown;
  return decodeBinaryValue(header, bytes.subarray(8 + headerLength));
};

export type RuntimeManifest = z.infer<typeof runtimeManifestSchema>;
export type ClientDiagnosticEvent = z.infer<typeof clientDiagnosticEventSchema>;
export type ClientProtocolMessage = z.infer<typeof clientProtocolMessageSchema>;
export type ServerLifecycleEvent = z.infer<typeof serverLifecycleEventSchema>;
export type ServerProtocolMessage = z.infer<typeof serverProtocolMessageSchema>;
