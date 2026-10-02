import { z } from "zod";

export const protocolErrorCodeSchema = z.enum([
  "bad-request",
  "conflict",
  "internal",
  "not-found",
]);

export type ProtocolErrorCode = z.infer<typeof protocolErrorCodeSchema>;

export class ProtocolError extends Error {
  constructor(
    readonly code: ProtocolErrorCode,
    message: string,
  ) {
    super(message);
  }
}
