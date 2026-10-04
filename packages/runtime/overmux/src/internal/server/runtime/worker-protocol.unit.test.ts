import { expect, test, test as testCases } from "vitest";
import { z, ZodError } from "zod";
import { ProtocolError, protocolErrorCodeSchema } from "../protocol-error";
import { OperationValidationError } from "./runtime-operations";
import {
  deserializeWorkerError,
  serializeWorkerError,
  workerErrorSchema,
} from "./worker-protocol";

const metadata = { name: "Error", message: "failed" };
const invalidEnvelopes = [
  { name: "null", value: null },
  { name: "missing message", value: { name: "Error" } },
  { name: "missing name", value: { message: "failed" } },
  { name: "non-string message", value: { ...metadata, message: 123 } },
  { name: "non-string name", value: { ...metadata, name: 123 } },
  { name: "extra field", value: { ...metadata, stack: "untrusted" } },
  {
    name: "oversized message",
    value: { ...metadata, message: "x".repeat(8193) },
  },
  { name: "oversized name", value: { ...metadata, name: "x".repeat(257) } },
  { name: "native string code", value: { ...metadata, code: "ENOENT" } },
  { name: "native numeric code", value: { ...metadata, code: 23 } },
  { name: "unknown category", value: { ...metadata, category: "validation" } },
  { name: "orphan phase", value: { ...metadata, phase: "input" } },
  {
    name: "missing validation phase",
    value: { ...metadata, category: "operation-validation" },
  },
  {
    name: "invalid validation phase",
    value: { ...metadata, category: "operation-validation", phase: "other" },
  },
];

testCases.each(invalidEnvelopes)(
  "rejects $name as an internal wire failure",
  ({ value }) => {
    expect(workerErrorSchema.safeParse(value).success).toBe(false);
    let failure: unknown;
    try {
      deserializeWorkerError(value);
    } catch (cause) {
      failure = cause;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ZodError);
    expect(failure).not.toBeInstanceOf(ProtocolError);
    expect(failure).toMatchObject({ message: "Invalid worker error envelope" });
  },
);

testCases.each(protocolErrorCodeSchema.options)(
  "reconstructs typed %s errors",
  (code) => {
    const cause = Object.assign(new Error("failed"), {
      code,
      name: "CustomError",
    });
    const error = deserializeWorkerError(serializeWorkerError(cause));
    expect(error).toBeInstanceOf(ProtocolError);
    expect(error).toMatchObject({
      code,
      message: "failed",
      name: "CustomError",
    });
  },
);

testCases.each(["input", "output"] as const)(
  "preserves %s operation validation",
  (phase) => {
    const cause = new OperationValidationError(
      phase,
      new Error("invalid operation"),
    );
    cause.name = "OperationValidationError";
    const wire = serializeWorkerError(cause);
    expect(wire).toEqual({
      category: "operation-validation",
      phase,
      message: "invalid operation",
      name: "OperationValidationError",
    });
    const error = deserializeWorkerError(wire);
    expect(error).toBeInstanceOf(OperationValidationError);
    expect(error).not.toBeInstanceOf(ProtocolError);
    expect(error).toMatchObject({
      phase,
      name: cause.name,
      message: cause.message,
    });
  },
);

const normalizedErrors = [
  {
    name: "native string",
    error: Object.assign(new Error("missing"), { code: "ENOENT" }),
  },
  {
    name: "unknown string",
    error: Object.assign(new Error("unknown"), { code: "custom" }),
  },
  {
    name: "timeout",
    error: new DOMException("upstream failed", "TimeoutError"),
  },
  { name: "abort", error: new DOMException("cancelled", "AbortError") },
];
testCases.each(normalizedErrors)(
  "normalizes $name codes before serialization",
  ({ error }) => {
    const wire = serializeWorkerError(error);
    expect(wire).not.toHaveProperty("code");
    expect(workerErrorSchema.safeParse(wire).success).toBe(true);
    expect(deserializeWorkerError(wire)).toMatchObject({
      code: "internal",
      name: error.name,
      message: error.message,
    });
  },
);

const badRequests = [
  { name: "syntax", error: new SyntaxError("invalid JSON") },
  { name: "schema", error: z.string().safeParse(123).error! },
];
testCases.each(badRequests)(
  "maps $name validation to bad-request",
  ({ error }) => {
    expect(deserializeWorkerError(serializeWorkerError(error))).toMatchObject({
      code: "bad-request",
      name: error.name,
      message: error.message,
    });
  },
);

test("bounds metadata and serializes non-Error failures", () => {
  const error = new Error("m".repeat(9000));
  error.name = "n".repeat(300);
  const wire = serializeWorkerError(error);
  expect(wire.message).toHaveLength(8192);
  expect(wire.name).toHaveLength(256);
  expect(workerErrorSchema.safeParse(wire).success).toBe(true);
  expect(deserializeWorkerError(serializeWorkerError("failed"))).toMatchObject({
    code: "internal",
    name: "Error",
    message: "failed",
  });
});
