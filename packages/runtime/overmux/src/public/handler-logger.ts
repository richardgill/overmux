// Structured events supplied by handlers; the runtime adds capability and invocation identity.
export type HandlerLogger = {
  debug: (event: string, details?: Record<string, unknown>) => void;
  info: (event: string, details?: Record<string, unknown>) => void;
  warn: (event: string, details?: Record<string, unknown>) => void;
  error: (event: string, details?: Record<string, unknown>) => void;
};
