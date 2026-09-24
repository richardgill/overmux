import { createContext, useContext } from "react";

import {
  createWebSocketTransport,
  type WebSocketTransport,
  type TransportStatus,
} from "./websocket";

export type ClientTransport = WebSocketTransport & {
  invokeOperation: (input: {
    input?: unknown;
    name: string;
    signal?: AbortSignal;
  }) => Promise<unknown>;
};

export const TransportContext = createContext<ClientTransport | undefined>(
  undefined,
);

export const useTransport = () => {
  const transport = useContext(TransportContext);
  if (!transport) {
    throw new Error(
      "Overmux transport hooks must be used inside an active Overmux client runtime",
    );
  }
  return transport;
};

const operationError = async (response: Response) => {
  const body = await response.text();
  try {
    const error = (JSON.parse(body) as { error?: unknown }).error;
    if (typeof error === "string") {
      return new Error(error);
    }
  } catch {}
  return new Error(
    `Operation request failed: ${response.status} ${response.statusText}`,
  );
};

export const createClientTransport = ({
  createSocket,
  fetch: fetchRequest = globalThis.fetch,
}: {
  createSocket?: () => WebSocket;
  fetch?: typeof globalThis.fetch;
} = {}): ClientTransport => ({
  ...createWebSocketTransport({ createSocket }),
  invokeOperation: async ({ input, name, signal }) => {
    const response = await fetchRequest(
      `/api/operations/${encodeURIComponent(name)}`,
      {
        body: input === undefined ? undefined : JSON.stringify(input),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal,
      },
    );
    if (!response.ok) {
      throw await operationError(response);
    }
    return response.status === 204 ? undefined : response.json();
  },
});

export type { WebSocketTransport, TransportStatus };
