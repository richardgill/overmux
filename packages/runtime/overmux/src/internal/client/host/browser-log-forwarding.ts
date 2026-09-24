import type { ClientDiagnosticEvent } from "../../shared/index";

const maxStringLength = 2_000;
const truncate = (value: string, length = maxStringLength) =>
  value.length <= length ? value : `${value.slice(0, length)}…[truncated]`;

const serializeValue = (
  value: unknown,
  seen: WeakSet<object>,
  depth = 0,
): unknown => {
  if (typeof value === "string") {
    return truncate(value);
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "bigint") {
    return `${value}n`;
  }
  if (typeof value === "undefined" || typeof value === "symbol") {
    return String(value);
  }
  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }
  if (depth >= 4) {
    return "[Max depth]";
  }
  if (typeof value !== "object") {
    return truncate(String(value));
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  if (value instanceof Error) {
    return {
      message: truncate(value.message),
      name: value.name,
      ...(value.stack ? { stack: truncate(value.stack, 8_000) } : {}),
    };
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 25)
      .map((item) => serializeValue(item, seen, depth + 1));
  }
  try {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 25)
        .map(([key, item]) => [key, serializeValue(item, seen, depth + 1)]),
    );
  } catch {
    return `[Unserializable ${Object.prototype.toString.call(value)}]`;
  }
};

export const serializeBrowserLogArguments = (values: unknown[]) => {
  const seen = new WeakSet<object>();
  const serialized = values.map((value) => serializeValue(value, seen));
  const json = JSON.stringify(serialized);
  return truncate(json, 16_000);
};

const diagnosticUrl = () => {
  try {
    return `${location.origin}${location.pathname}`;
  } catch {
    return undefined;
  }
};

const stackOf = (values: unknown[]) => {
  const error = values.find((value) => value instanceof Error);
  return error instanceof Error && error.stack
    ? truncate(error.stack, 8_000)
    : undefined;
};

export const installBrowserLogForwarding = (
  report: (event: ClientDiagnosticEvent) => void,
) => {
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const originals = Object.fromEntries(
    methods.map((level) => [level, console[level].bind(console)]),
  ) as Record<(typeof methods)[number], (...values: unknown[]) => void>;
  let reporting = false;
  const emit = (
    level: ClientDiagnosticEvent["level"],
    values: unknown[],
    stack?: string,
  ) => {
    if (reporting) {
      return;
    }
    reporting = true;
    try {
      const serializedArguments = serializeBrowserLogArguments(values);
      report({
        arguments: serializedArguments,
        level,
        message: truncate(
          values
            .map((value) =>
              typeof value === "string" ? value : serializedArguments,
            )
            .join(" "),
          4_000,
        ),
        ...(stack ? { stack: truncate(stack, 8_000) } : {}),
        timestamp: new Date().toISOString(),
        type: "client-diagnostic",
        ...(diagnosticUrl() ? { url: diagnosticUrl() } : {}),
      });
    } finally {
      reporting = false;
    }
  };
  methods.forEach((level) => {
    console[level] = (...values: unknown[]) => {
      originals[level](...values);
      emit(level, values, stackOf(values));
    };
  });
  const onError = (event: ErrorEvent) =>
    emit("error", [event.message], event.error?.stack);
  const onRejection = (event: PromiseRejectionEvent) =>
    emit(
      "error",
      ["Unhandled rejection", event.reason],
      stackOf([event.reason]),
    );
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  return () => {
    methods.forEach((level) => {
      console[level] = originals[level];
    });
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
};
