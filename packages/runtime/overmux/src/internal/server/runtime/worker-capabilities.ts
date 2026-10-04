import type { RuntimeOperation } from "./runtime-operations";
import type { RuntimeResource } from "./runtime-resources";
import type { RuntimeStream } from "./runtime-streams";
import type { WorkerConnection } from "./worker-connection";

export const createWorkerResource = (
  connection: WorkerConnection,
  name: string,
): RuntimeResource => ({
  read: (input, signal, correlation) =>
    connection.request(
      { action: "resource-read", input, name, correlation },
      signal,
    ),
  subscribe: async (input, listener, signal, onError, correlation) => {
    const session = await connection.openSession({
      action: "resource-subscribe",
      name,
      input,
      signal,
      onEvent: listener,
      onError,
      correlation,
    });
    return session.close;
  },
});

export const createWorkerOperation = (
  connection: WorkerConnection,
  name: string,
  returnsVoid: boolean,
): RuntimeOperation => ({
  execute: (input, signal, correlation) =>
    connection.request(
      { action: "operation", input, name, correlation },
      signal,
    ),
  returnsVoid,
});

export const createWorkerStream = (
  connection: WorkerConnection,
  name: string,
): RuntimeStream => ({
  open: async (input, emit, signal, onError, correlation) => {
    const session = await connection.openSession({
      action: "stream-open",
      name,
      input,
      signal,
      onEvent: emit,
      onError,
      correlation,
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
