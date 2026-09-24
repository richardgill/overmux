// Handles operation request validation, execution, cancellation, and lifecycle logs.
// Operation payloads are limited to 1 MiB before JSON parsing.
import type { Handler } from "hono";

import type { AuthEnvironment } from "../auth/auth-http";
import type { ServerLogger } from "../server-logger";
import type { Runtime } from "../runtime/create-runtime";
import { OperationValidationError } from "../runtime/runtime-operations";

const maxOperationRequestBytes = 1_048_576;

const parseOperationRequest = async (request: Request) => {
  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0];
  if (contentType?.toLowerCase() !== "application/json") {
    return {
      error: "Content-Type must be application/json",
      status: 415,
    } as const;
  }
  const contentLength = Number(request.headers.get("Content-Length") ?? 0);
  if (contentLength > maxOperationRequestBytes) {
    return { error: "Request body is too large", status: 413 } as const;
  }
  try {
    const body = await request.arrayBuffer();
    if (body.byteLength > maxOperationRequestBytes) {
      return { error: "Request body is too large", status: 413 } as const;
    }
    const text = new TextDecoder().decode(body);
    return { input: text ? (JSON.parse(text) as unknown) : undefined };
  } catch {
    return { error: "Invalid JSON request body", status: 400 } as const;
  }
};

export const createOperationHandler =
  ({
    runtime,
    serverLogger,
  }: {
    runtime: Runtime;
    serverLogger?: ServerLogger;
  }): Handler<AuthEnvironment, "/api/operations/:name"> =>
  async (context) => {
    const operation = runtime.getOperation(context.req.param("name"));
    if (!operation) {
      return context.json({ error: "Operation not found" }, 404);
    }
    const parsed = await parseOperationRequest(context.req.raw);
    if ("error" in parsed) {
      return context.json({ error: parsed.error }, parsed.status);
    }
    const correlationId =
      context.res.headers.get("X-Overmux-Correlation-Id") ?? serverLogger?.id();
    const startedAt = Date.now();
    serverLogger?.log({
      correlationId,
      details: { registeredName: context.req.param("name") },
      event: "operation-start",
    });
    try {
      const output = await operation.execute(
        parsed.input,
        context.req.raw.signal,
      );
      serverLogger?.log({
        correlationId,
        details: { registeredName: context.req.param("name") },
        durationMs: Date.now() - startedAt,
        event: "operation-complete",
      });
      return operation.returnsVoid
        ? new Response(undefined, { status: 204 })
        : context.json(output);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Operation failed";
      serverLogger?.log({
        correlationId,
        details: { registeredName: context.req.param("name") },
        durationMs: Date.now() - startedAt,
        event: "operation-error",
        level: "error",
        message,
      });
      return context.json(
        { error: message },
        cause instanceof OperationValidationError && cause.phase === "input"
          ? 400
          : 500,
      );
    }
  };
