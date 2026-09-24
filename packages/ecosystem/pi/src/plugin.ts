import { randomUUID } from "node:crypto";

import {
  defineOperation,
  type HandlerContext,
  type StreamHandlerDefinition,
} from "overmux";
import {
  defineResourceContract,
  defineStreamContract,
  noInputSchema,
} from "overmux";
import { z } from "zod";

import {
  sendAbort,
  sendSetModel,
  sendSetThinkingLevel,
  sendUserMessage,
  type AbortResponse,
  type UserMessageResponse,
} from "./protocol.js";
import {
  createPiAgentConversationService,
  piConversationSnapshotSchema,
  piSessionMetadataSchema,
  type PiAgentSession,
  type PiConversationSnapshot,
} from "./projection.js";

type Awaitable<T> = T | Promise<T>;
type Dispose = () => void;
export type PiSessionSource = {
  list: () => Awaitable<readonly PiAgentSession[]>;
  subscribe: (
    invalidate: () => void,
    options: { signal: AbortSignal },
  ) => Dispose | void;
};
type PiAgentListener = () => void;

export type PiAgents = {
  get: (agentId: string) => Promise<PiAgentSession | undefined>;
  list: () => Promise<readonly PiAgentSession[]>;
  subscribe: (listener: PiAgentListener) => Dispose;
};

const piAgentSessionSchema = z
  .object({
    id: z.string().min(1),
    liveEventsDir: z.string().min(1).optional(),
    sessionFile: z.string().min(1),
    sessionMetadata: piSessionMetadataSchema.optional(),
  })
  .strict();

const piSessionSchema = z.object({ agentId: z.string().min(1) }).strict();
const piMessageInputSchema = z
  .object({
    agentId: z.string().min(1),
    deliverAs: z.enum(["steer", "followUp"]),
    message: z.string().trim().min(1),
  })
  .strict();
const piMessageResultSchema = z.object({
  delivery: z.enum(["immediate", "steer", "followUp"]),
  requestId: z.string().min(1),
});
const piStopInputSchema = z.object({ agentId: z.string().min(1) }).strict();
const piStopResultSchema = z.object({ requestId: z.string().min(1) });
const piModelInputSchema = z
  .object({
    agentId: z.string().min(1),
    provider: z.string().min(1),
    id: z.string().min(1),
  })
  .strict();
const piThinkingInputSchema = z
  .object({
    agentId: z.string().min(1),
    level: z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]),
  })
  .strict();
const piControlResultSchema = z.object({ requestId: z.string().min(1) });

const once = (dispose: Dispose): Dispose => {
  let disposed = false;
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    dispose();
  };
};

const sameSessions = (
  left: readonly PiAgentSession[],
  right: readonly PiAgentSession[],
): boolean =>
  left.length === right.length &&
  left.every(
    (session, index) =>
      session.id === right[index]?.id &&
      session.sessionFile === right[index]?.sessionFile &&
      session.liveEventsDir === right[index]?.liveEventsDir &&
      JSON.stringify(session.sessionMetadata) ===
        JSON.stringify(right[index]?.sessionMetadata),
  );

export const definePiAgents = ({
  liveEventsDir,
  sessions,
}: {
  liveEventsDir: string;
  sessions: PiSessionSource;
}): PiAgents => {
  const listeners = new Set<PiAgentListener>();
  let cached: PiAgentSession[] = [];
  let sourceDispose: Dispose | undefined;
  let refreshQueue = Promise.resolve();

  const refresh = async () => {
    const result = refreshQueue.then(async () => {
      const next = (await sessions.list())
        .map((session) =>
          piAgentSessionSchema.parse({ ...session, liveEventsDir }),
        )
        .sort((left, right) => left.id.localeCompare(right.id));
      if (new Set(next.map(({ id }) => id)).size !== next.length) {
        throw new Error("Pi agent discovery returned duplicate IDs");
      }
      if (!sameSessions(cached, next)) {
        cached = next;
        listeners.forEach((listener) => listener());
      }
    });
    refreshQueue = result.catch(() => undefined);
    await result;
    return cached;
  };

  const stopSource = () => {
    sourceDispose?.();
    sourceDispose = undefined;
  };

  const startSource = () => {
    if (sourceDispose) {
      return;
    }
    const controller = new AbortController();
    const dispose = sessions.subscribe(
      () => void refresh().catch(() => undefined),
      { signal: controller.signal },
    );
    sourceDispose = once(() => {
      controller.abort();
      dispose?.();
    });
  };

  return {
    get: async (agentId) => (await refresh()).find(({ id }) => id === agentId),
    list: refresh,
    subscribe: (listener) => {
      listeners.add(listener);
      startSource();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          stopSource();
        }
      };
    },
  };
};

const piSessionsContract = defineResourceContract({
  input: noInputSchema,
  output: z.array(piSessionSchema),
});

export const piSessionsResource = ({ agents }: { agents: PiAgents }) => ({
  contract: piSessionsContract,
  kind: "subscription" as const,
  read: async (_input: void, _context: HandlerContext) =>
    (await agents.list()).map(({ id }) => ({ agentId: id })),
  subscribe: (
    _input: void,
    invalidate: () => void,
    context: HandlerContext,
  ) => {
    const dispose = once(agents.subscribe(invalidate));
    context.signal.addEventListener("abort", dispose, { once: true });
    return once(() => {
      context.signal.removeEventListener("abort", dispose);
      dispose();
    });
  },
});

const piConversationContract = defineStreamContract({
  clientMessage: z.never(),
  input: z.object({ agentId: z.string().min(1) }).strict(),
  serverMessage: piConversationSnapshotSchema,
});

const limitConversationEntries = (
  snapshot: PiConversationSnapshot,
  maxEntries: number | undefined,
): PiConversationSnapshot =>
  maxEntries === undefined
    ? snapshot
    : { ...snapshot, entries: snapshot.entries.slice(-maxEntries) };

export const piConversationStream = ({
  agents,
  maxEntries,
}: {
  agents: PiAgents;
  maxEntries?: number;
}): StreamHandlerDefinition<
  typeof piConversationContract.input,
  typeof piConversationContract.clientMessage,
  typeof piConversationContract.serverMessage
> => {
  if (
    maxEntries !== undefined &&
    (!Number.isSafeInteger(maxEntries) || maxEntries < 1)
  ) {
    throw new Error("Pi conversation maxEntries must be a positive integer");
  }
  return {
    contract: piConversationContract,
    open: async ({ agentId }, context) => {
      const service = createPiAgentConversationService({
        resolveAgent: async (id) => {
          const agent = await agents.get(id);
          if (!agent) {
            throw new Error(`Pi agent not found: ${id}`);
          }
          return { ...agent, sessionId: agent.id };
        },
      });
      try {
        context.emit(
          limitConversationEntries(
            await service.getSnapshot(agentId),
            maxEntries,
          ),
        );
        const unsubscribe = service.subscribe(agentId, (snapshot) =>
          context.emit(limitConversationEntries(snapshot, maxEntries)),
        );
        return {
          dispose: once(() => {
            unsubscribe();
            service.dispose();
          }),
        };
      } catch (error) {
        service.dispose();
        throw error;
      }
    },
  };
};

const piMessageResult = async (
  agent: PiAgentSession | undefined,
  input: z.infer<typeof piMessageInputSchema>,
): Promise<z.infer<typeof piMessageResultSchema>> => {
  if (!agent) {
    throw new Error(`Pi agent not found: ${input.agentId}`);
  }
  const response = await sendUserMessage(agent.id, {
    deliverAs: input.deliverAs,
    message: input.message,
    requestId: randomUUID(),
  });
  if (!response?.ok) {
    throw new Error("Pi agent is unavailable");
  }
  return response;
};

const piStopResult = async (
  agent: PiAgentSession | undefined,
  input: z.infer<typeof piStopInputSchema>,
): Promise<z.infer<typeof piStopResultSchema>> => {
  if (!agent) {
    throw new Error(`Pi agent not found: ${input.agentId}`);
  }
  const requestId = randomUUID();
  const response = await sendAbort(agent.id, { requestId });
  if (!response?.ok) {
    throw new Error("Pi agent is unavailable");
  }
  return { requestId };
};

const piControlResult = async (
  agent: PiAgentSession | undefined,
  input: { agentId: string },
  send: (
    agentId: string,
    requestId: string,
  ) => Promise<{ ok: boolean; error?: string } | undefined>,
): Promise<z.infer<typeof piControlResultSchema>> => {
  if (!agent) {
    throw new Error(`Pi agent not found: ${input.agentId}`);
  }
  const requestId = randomUUID();
  const response = await send(agent.id, requestId);
  if (response?.ok) {
    return { requestId };
  }
  if (response?.error === "not_found") {
    throw new Error("Pi model was not found");
  }
  if (response?.error === "no_key") {
    throw new Error("No API key is available for this Pi model");
  }
  throw new Error("Pi agent is unavailable");
};

export const piOperationHandlers = ({ agents }: { agents: PiAgents }) => ({
  sendPiMessage: defineOperation({
    handle: async (input) =>
      piMessageResult(await agents.get(input.agentId), input),
    input: piMessageInputSchema,
    output: piMessageResultSchema,
  }),
  stopPiAgent: defineOperation({
    handle: async (input) =>
      piStopResult(await agents.get(input.agentId), input),
    input: piStopInputSchema,
    output: piStopResultSchema,
  }),
  setPiModel: defineOperation({
    handle: async (input) =>
      piControlResult(
        await agents.get(input.agentId),
        input,
        (agentId, requestId) =>
          sendSetModel(agentId, {
            id: input.id,
            provider: input.provider,
            requestId,
          }),
      ),
    input: piModelInputSchema,
    output: piControlResultSchema,
  }),
  setPiThinkingLevel: defineOperation({
    handle: async (input) =>
      piControlResult(
        await agents.get(input.agentId),
        input,
        (agentId, requestId) =>
          sendSetThinkingLevel(agentId, { level: input.level, requestId }),
      ),
    input: piThinkingInputSchema,
    output: piControlResultSchema,
  }),
});

export type { AbortResponse, UserMessageResponse };
