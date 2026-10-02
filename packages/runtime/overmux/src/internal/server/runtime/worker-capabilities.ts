import type { RuntimeOperation } from "./runtime-operations";
import type { RuntimeResource } from "./runtime-resources";
import type { RuntimeStream } from "./runtime-streams";
import type { WorkerConnection } from "./worker-connection";

export const createWorkerResource = (
  connection: WorkerConnection,
  name: string,
): RuntimeResource => ({
  read: (input, signal) =>
    connection.request({ action: "resource-read", input, name }, signal),
  subscribe: async (input, listener, signal, onError) => {
    const session = await connection.openSession({
      action: "resource-subscribe",
      name,
      input,
      signal,
      onEvent: listener,
      onError,
    });
    return session.close;
  },
});

export const createWorkerOperation = (
  connection: WorkerConnection,
  name: string,
  returnsVoid: boolean,
): RuntimeOperation => ({
  execute: (input, signal) =>
    connection.request({ action: "operation", input, name }, signal),
  returnsVoid,
});

export const createWorkerStream = (
  connection: WorkerConnection,
  name: string,
): RuntimeStream => ({
  open: async (input, emit, signal, onError) => {
    const session = await connection.openSession({
      action: "stream-open",
      name,
      input,
      signal,
      onEvent: emit,
      onError,
    });
    return {
      dispose: session.close,
      send: async (message) => {
        session.assertOpen();
        await connection.request(
          { action: "stream-message", message, sessionId: session.id },
          signal,
        );
      },
    };
  },
});
