import { serverConfigRuntimeSchema } from "@overmux/shared/node";

export const parsePort = (value: string): Error | number => {
  const port = Number(value);
  return port > 0 &&
    serverConfigRuntimeSchema.shape.port.safeParse(port).success
    ? port
    : new Error(`Invalid port: ${value}`);
};
