import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";
import {
  parseLiveEventRecord,
  type LiveEventWireRecord as LiveRecord,
} from "./live-events.js";
import {
  probePiSession,
  sendUserMessage,
  type UserMessageInput,
  type UserMessageResponse,
} from "./protocol.js";
import { createJsonlTail, type JsonlTail } from "./jsonl-tail.js";

export type PiContentBlock = {
  arguments?: unknown;
  data?: string;
  id?: string;
  mimeType?: string;
  name?: string;
  text?: string;
  thinking?: string;
  tool?: PiToolProjection;
  type: string;
};
export type PiToolResultProjection = {
  content: PiContentBlock[];
  details?: unknown;
  isError: boolean;
  toolCallId: string;
  toolName: string;
};
export type PiToolProjection = {
  result?: PiToolResultProjection;
  status: "error" | "pending" | "success";
};
export type PiConversationEntry = {
  content: PiContentBlock[];
  details?: unknown;
  errorMessage?: string;
  id: string;
  isError?: boolean;
  role: "assistant" | "toolResult" | "user";
  source: "canonical" | "live";
  status: "complete" | "error" | "pending";
  stopReason?: string;
  timestamp?: number;
  toolCallId?: string;
  toolName?: string;
};

export const piContentBlockSchema: z.ZodType<PiContentBlock> = z.lazy(() =>
  z.object({
    arguments: z.unknown().optional(),
    data: z.string().optional(),
    id: z.string().optional(),
    mimeType: z.string().optional(),
    name: z.string().optional(),
    text: z.string().optional(),
    thinking: z.string().optional(),
    tool: piToolProjectionSchema.optional(),
    type: z.string(),
  }),
);

export const piToolResultProjectionSchema: z.ZodType<PiToolResultProjection> =
  z.object({
    content: z.array(piContentBlockSchema),
    details: z.unknown().optional(),
    isError: z.boolean(),
    toolCallId: z.string(),
    toolName: z.string(),
  });

export const piToolProjectionSchema: z.ZodType<PiToolProjection> = z.lazy(() =>
  z.object({
    result: piToolResultProjectionSchema.optional(),
    status: z.enum(["error", "pending", "success"]),
  }),
);
export const piSessionMetadataSchema = z
  .object({
    contextUsage: z
      .object({
        tokens: z.number().nonnegative(),
        contextWindow: z.number().positive(),
        percent: z.number().nonnegative(),
      })
      .strict()
      .optional(),
    model: z
      .object({
        provider: z.string().min(1),
        id: z.string().min(1),
        name: z.string().min(1),
      })
      .strict()
      .optional(),
    thinkingLevel: z.string().min(1),
    modelOptions: z
      .array(
        z
          .object({
            provider: z.string().min(1),
            id: z.string().min(1),
            name: z.string().min(1),
          })
          .strict(),
      )
      .max(256)
      .optional(),
  })
  .strict();

export type PiSessionMetadata = z.infer<typeof piSessionMetadataSchema>;
export type PiConversationSnapshot = {
  agentAvailable: boolean;
  entries: PiConversationEntry[];
  sessionMetadata?: PiSessionMetadata;
  status: "busy" | "degraded" | "idle" | "offline";
};

export const piConversationSnapshotSchema: z.ZodType<PiConversationSnapshot> =
  z.object({
    agentAvailable: z.boolean(),
    entries: z.array(
      z.object({
        content: z.array(piContentBlockSchema),
        details: z.unknown().optional(),
        errorMessage: z.string().optional(),
        id: z.string(),
        isError: z.boolean().optional(),
        role: z.enum(["assistant", "toolResult", "user"]),
        source: z.enum(["canonical", "live"]),
        status: z.enum(["complete", "error", "pending"]),
        stopReason: z.string().optional(),
        timestamp: z.number().optional(),
        toolCallId: z.string().optional(),
        toolName: z.string().optional(),
      }),
    ),
    sessionMetadata: piSessionMetadataSchema.optional(),
    status: z.enum(["busy", "degraded", "idle", "offline"]),
  });

export type PiAgentSession = {
  id: string;
  liveEventsDir?: string;
  sessionFile: string;
  sessionMetadata?: PiSessionMetadata;
};

type PiAgentResource = PiAgentSession & { sessionId: string };

type PiMessage = {
  content?: string | unknown[];
  details?: unknown;
  errorMessage?: string;
  isError?: boolean;
  role?: string;
  stopReason?: string;
  timestamp?: number | string;
  toolCallId?: string;
  toolName?: string;
};

type StreamState = {
  conflict: boolean;
  records: Map<number, LiveRecord>;
  tail: JsonlTail;
};
type LiveMessageState = {
  blocks: PiContentBlock[];
  ended: boolean;
  id: string;
  message?: PiMessage;
  messageSequence: number;
  sourceOrder: number;
  status: PiConversationEntry["status"];
  streamId: string;
  timestamp?: number;
};
type ToolState = {
  isError?: boolean;
  result?: unknown;
  status: PiToolProjection["status"];
  toolCallId: string;
  toolName: string;
};
type ProjectionState = {
  agentAvailable?: boolean;
  canonicalRecords: unknown[];
  canonicalTail: JsonlTail;
  configKey: string;
  refreshQueue: Promise<void>;
  sessionMetadata?: PiSessionMetadata;
  snapshot?: PiConversationSnapshot;
  streams: Map<string, StreamState>;
};
type SnapshotListener = (snapshot: PiConversationSnapshot) => void;

export type PiAgentConversationService = {
  dispose: () => void;
  getSnapshot: (agentId: string) => Promise<PiConversationSnapshot>;
  subscribe: (agentId: string, listener: SnapshotListener) => () => void;
};

type PiMessageResponse = Extract<UserMessageResponse, { ok: true }>;

export type PiMessageSender = (
  sessionId: string,
  request: UserMessageInput,
) => Promise<UserMessageResponse | undefined>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const timestampOf = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
};

const contentBlocksOf = (content: PiMessage["content"]): PiContentBlock[] => {
  if (typeof content === "string") {
    return [{ text: content, type: "text" }];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  return content.flatMap((value) => {
    if (!isObject(value) || typeof value.type !== "string") {
      return [];
    }
    return [{ ...value, type: value.type } as PiContentBlock];
  });
};

const browserToolDetails = (details: unknown) => {
  if (!isObject(details)) {
    return details;
  }
  const { fullOutputPath: _fullOutputPath, ...safeDetails } = details;
  return safeDetails;
};

const toolResultOf = (
  message: PiMessage,
): PiToolResultProjection | undefined => {
  if (
    message.role !== "toolResult" ||
    typeof message.toolCallId !== "string" ||
    typeof message.toolName !== "string"
  ) {
    return undefined;
  }
  return {
    content: contentBlocksOf(message.content),
    details: browserToolDetails(message.details),
    isError: message.isError === true,
    toolCallId: message.toolCallId,
    toolName: message.toolName,
  };
};

const entryOf = (
  value: unknown,
  source: PiConversationEntry["source"],
): PiConversationEntry | undefined => {
  if (
    !isObject(value) ||
    value.type !== "message" ||
    !isObject(value.message)
  ) {
    return undefined;
  }
  if (typeof value.id !== "string") {
    return undefined;
  }
  const message = value.message as PiMessage;
  if (
    message.role !== "assistant" &&
    message.role !== "toolResult" &&
    message.role !== "user"
  ) {
    return undefined;
  }
  return {
    content: contentBlocksOf(message.content),
    details: message.details,
    errorMessage: message.errorMessage,
    id: value.id,
    isError: message.isError,
    role: message.role,
    source,
    status:
      message.isError === true || message.stopReason === "error"
        ? "error"
        : "complete",
    stopReason: message.stopReason,
    timestamp: timestampOf(value.timestamp) ?? timestampOf(message.timestamp),
    toolCallId: message.toolCallId,
    toolName: message.toolName,
  };
};

const appendDelta = (
  blocks: PiContentBlock[],
  event: Record<string, unknown>,
) => {
  const update = event.assistantMessageEvent;
  if (!isObject(update) || !Number.isSafeInteger(update.contentIndex)) {
    return;
  }
  const index = update.contentIndex as number;
  if (index < 0) {
    return;
  }
  const current = blocks[index] ?? { type: "text" };
  if (update.type === "text_start") {
    blocks[index] = { type: "text" };
  }
  if (update.type === "thinking_start") {
    blocks[index] = { type: "thinking" };
  }
  if (update.type === "toolcall_start") {
    blocks[index] = { type: "toolCall" };
  }
  if (update.type === "text_delta") {
    blocks[index] = {
      ...current,
      text: `${current.text ?? ""}${typeof update.delta === "string" ? update.delta : ""}`,
      type: "text",
    };
  }
  if (update.type === "thinking_delta") {
    blocks[index] = {
      ...current,
      thinking: `${current.thinking ?? ""}${typeof update.delta === "string" ? update.delta : ""}`,
      type: "thinking",
    };
  }
  if (update.type === "toolcall_delta") {
    blocks[index] = {
      ...current,
      arguments: `${typeof current.arguments === "string" ? current.arguments : ""}${typeof update.delta === "string" ? update.delta : ""}`,
      type: "toolCall",
    };
  }
};

const updateMessage = (
  messages: Map<string, LiveMessageState>,
  record: LiveRecord,
  sourceOrder: number,
) => {
  const event = record.event;
  if (typeof event.messageId !== "string") {
    return;
  }
  const key = `${record.streamId}\0${event.messageId}`;
  const current = messages.get(key) ?? {
    blocks: [],
    ended: false,
    id: key,
    messageSequence:
      typeof event.messageSequence === "number"
        ? event.messageSequence
        : sourceOrder,
    sourceOrder,
    status: "pending" as const,
    streamId: record.streamId,
  };
  current.timestamp = record.timestamp;
  if (event.type === "message_start" && isObject(event.message)) {
    current.message = event.message as PiMessage;
  }
  if (event.type === "message_update") {
    appendDelta(current.blocks, event);
    const update = event.assistantMessageEvent;
    if (isObject(update) && update.type === "done") {
      current.status = "complete";
    }
    if (isObject(update) && update.type === "error") {
      current.status = "error";
      current.message = {
        ...current.message,
        errorMessage:
          typeof update.errorMessage === "string"
            ? update.errorMessage
            : undefined,
      };
    }
  }
  if (event.type === "message_end" && isObject(event.message)) {
    current.ended = true;
    current.message = event.message as PiMessage;
    current.blocks = contentBlocksOf(current.message.content);
    current.status =
      current.message.isError === true || current.message.stopReason === "error"
        ? "error"
        : "complete";
  }
  messages.set(key, current);
};

const updateTool = (
  tools: Map<string, ToolState>,
  event: Record<string, unknown>,
) => {
  if (
    (event.type !== "tool_execution_start" &&
      event.type !== "tool_execution_end") ||
    typeof event.toolCallId !== "string" ||
    typeof event.toolName !== "string"
  ) {
    return;
  }
  tools.set(event.toolCallId, {
    isError: event.type === "tool_execution_end" && event.isError === true,
    result: event.type === "tool_execution_end" ? event.result : undefined,
    status:
      event.type === "tool_execution_start"
        ? "pending"
        : event.isError === true
          ? "error"
          : "success",
    toolCallId: event.toolCallId,
    toolName: event.toolName,
  });
};

const liveEntryOf = (
  state: LiveMessageState,
): PiConversationEntry | undefined => {
  const message = state.message;
  if (!message) {
    return undefined;
  }
  const role = message.role;
  if (role !== "assistant" && role !== "toolResult" && role !== "user") {
    return undefined;
  }
  return {
    content: state.ended
      ? contentBlocksOf(message.content)
      : state.blocks.length
        ? state.blocks
        : contentBlocksOf(message.content),
    details: message.details,
    errorMessage: message.errorMessage,
    id: state.id,
    isError: message.isError,
    role,
    source: "live",
    status: state.status,
    stopReason: message.stopReason,
    timestamp: state.timestamp ?? timestampOf(message.timestamp),
    toolCallId: message.toolCallId,
    toolName: message.toolName,
  };
};

const projectLive = (records: LiveRecord[]) => {
  const messages = new Map<string, LiveMessageState>();
  const tools = new Map<string, ToolState>();
  let active = false;
  let shutdown = false;
  records.forEach((record, index) => {
    updateMessage(messages, record, index);
    updateTool(tools, record.event);
    if (record.event.type === "agent_start") {
      active = true;
    }
    if (record.event.type === "agent_settled") {
      active = false;
    }
    if (record.event.type === "session_shutdown") {
      shutdown = true;
    }
    if (record.event.type === "session_start") {
      shutdown = false;
    }
  });
  return {
    active,
    entries: [...messages.values()]
      .sort(
        (left, right) =>
          (left.timestamp ?? 0) - (right.timestamp ?? 0) ||
          left.streamId.localeCompare(right.streamId) ||
          left.messageSequence - right.messageSequence,
      )
      .flatMap((message) => {
        const entry = liveEntryOf(message);
        return entry ? [entry] : [];
      }),
    shutdown,
    tools,
  };
};

const fingerprint = (entry: PiConversationEntry) =>
  JSON.stringify({
    content: entry.content.map(({ tool: _tool, ...block }) => block),
    details: entry.details,
    isError: entry.isError,
    role: entry.role,
    toolCallId: entry.toolCallId,
    toolName: entry.toolName,
  });

const matchedLiveIndexes = (
  canonical: PiConversationEntry[],
  live: PiConversationEntry[],
) => {
  const liveByFingerprint = new Map<string, number[]>();
  live.forEach((entry, index) => {
    if (entry.status === "pending") {
      return;
    }
    const key = fingerprint(entry);
    const indexes = liveByFingerprint.get(key) ?? [];
    indexes.push(index);
    liveByFingerprint.set(key, indexes);
  });
  const consumed = new Map<string, number>();
  const matched = new Set<number>();
  canonical.forEach((entry) => {
    const key = fingerprint(entry);
    const offset = consumed.get(key) ?? 0;
    const index = liveByFingerprint.get(key)?.[offset];
    if (index !== undefined) {
      matched.add(index);
      consumed.set(key, offset + 1);
    }
  });
  return matched;
};

const contentFromToolEnd = (result: unknown): PiContentBlock[] => {
  if (isObject(result) && "content" in result) {
    return contentBlocksOf(result.content as PiMessage["content"]);
  }
  if (typeof result === "string") {
    return [{ text: result, type: "text" }];
  }
  return result === undefined
    ? []
    : [{ text: JSON.stringify(result, null, 2), type: "text" }];
};

const pairTools = (
  entries: PiConversationEntry[],
  liveTools: Map<string, ToolState>,
) => {
  const callIds = new Set(
    entries.flatMap((entry) =>
      entry.content.flatMap((block) =>
        block.type === "toolCall" && typeof block.id === "string"
          ? [block.id]
          : [],
      ),
    ),
  );
  const results = new Map<string, PiToolResultProjection>();
  entries.forEach((entry) => {
    if (entry.role !== "toolResult") {
      return;
    }
    const result = toolResultOf({
      content: entry.content,
      details: entry.details,
      isError: entry.isError,
      role: entry.role,
      toolCallId: entry.toolCallId,
      toolName: entry.toolName,
    });
    if (result) {
      results.set(result.toolCallId, result);
    }
  });
  liveTools.forEach((tool) => {
    if (results.has(tool.toolCallId) || tool.result === undefined) {
      return;
    }
    results.set(tool.toolCallId, {
      content: contentFromToolEnd(tool.result),
      details: isObject(tool.result)
        ? browserToolDetails(tool.result.details)
        : undefined,
      isError: tool.isError === true,
      toolCallId: tool.toolCallId,
      toolName: tool.toolName,
    });
  });

  return entries
    .map((entry) => ({
      ...entry,
      content: entry.content.map((block) => {
        if (block.type !== "toolCall" || typeof block.id !== "string") {
          return block;
        }
        const result = results.get(block.id);
        const live = liveTools.get(block.id);
        return {
          ...block,
          tool: {
            result,
            status: result
              ? result.isError
                ? "error"
                : "success"
              : (live?.status ?? "pending"),
          },
        };
      }),
    }))
    .filter(
      (entry) =>
        entry.role !== "toolResult" ||
        !entry.toolCallId ||
        !callIds.has(entry.toolCallId),
    );
};

const recordsSafeToProject = (stream: StreamState) => {
  const records = [...stream.records.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const gapIndex = records.findIndex(
    (record, index) => record.sequence !== index + 1,
  );
  if (gapIndex < 0) {
    return records;
  }
  return [
    ...records.slice(0, gapIndex),
    ...records
      .slice(gapIndex)
      .filter((record) => record.event.type === "message_end"),
  ];
};

const sortedStreamRecords = (streams: Map<string, StreamState>) =>
  [...streams.values()]
    .flatMap(recordsSafeToProject)
    .sort(
      (left, right) =>
        left.timestamp - right.timestamp ||
        left.streamId.localeCompare(right.streamId) ||
        left.sequence - right.sequence,
    );

const streamHasIssue = (stream: StreamState) => {
  if (stream.conflict) {
    return true;
  }
  const sequences = [...stream.records.keys()].sort(
    (left, right) => left - right,
  );
  return sequences.some((sequence, index) => sequence !== index + 1);
};

const refreshCanonical = async (
  state: ProjectionState,
  sessionFile: string | undefined,
) => {
  if (!sessionFile) {
    const changed = state.canonicalRecords.length > 0;
    state.canonicalRecords = [];
    return changed;
  }
  const update = await state.canonicalTail.read(sessionFile);
  if (update.reset) {
    state.canonicalRecords = [];
  }
  state.canonicalRecords.push(...update.records);
  return update.reset || update.records.length > 0;
};

const refreshStreams = async (
  state: ProjectionState,
  data: PiAgentResource,
) => {
  if (!data.liveEventsDir) {
    const changed = state.streams.size > 0;
    state.streams.clear();
    return changed;
  }
  const directory = join(data.liveEventsDir, data.sessionId);
  const files = (await readdir(directory).catch(() => [] as string[])).filter(
    (file) => file.endsWith(".jsonl"),
  );
  const present = new Set(files);
  let removed = false;
  [...state.streams.keys()].forEach((file) => {
    if (!present.has(file)) {
      const stream = state.streams.get(file);
      removed = removed || Boolean(stream?.conflict || stream?.records.size);
      state.streams.delete(file);
    }
  });
  const updates = await Promise.all(
    files.map(async (file) => {
      const stream = state.streams.get(file) ?? {
        conflict: false,
        records: new Map<number, LiveRecord>(),
        tail: createJsonlTail(),
      };
      state.streams.set(file, stream);
      const update = await stream.tail.read(join(directory, file));
      let changed =
        update.reset && Boolean(stream.conflict || stream.records.size);
      if (update.reset) {
        stream.conflict = false;
        stream.records.clear();
      }
      const expectedStreamId = file.slice(0, -".jsonl".length);
      update.records.forEach((value) => {
        const record = parseLiveEventRecord(value, data.sessionId);
        if (!record) {
          return;
        }
        if (record.streamId !== expectedStreamId) {
          changed = changed || !stream.conflict;
          stream.conflict = true;
          return;
        }
        const previous = stream.records.get(record.sequence);
        if (previous && JSON.stringify(previous) !== JSON.stringify(record)) {
          changed = changed || !stream.conflict;
          stream.conflict = true;
          return;
        }
        changed = changed || !previous;
        stream.records.set(record.sequence, record);
      });
      return changed;
    }),
  );
  return removed || updates.some(Boolean);
};

const activeCanonicalBranch = (records: unknown[]) => {
  const treeEntries = records.flatMap((record) => {
    if (
      !isObject(record) ||
      typeof record.id !== "string" ||
      (record.parentId !== null && typeof record.parentId !== "string")
    ) {
      return [];
    }
    return [record as Record<string, unknown> & { id: string }];
  });
  const leaf = treeEntries.at(-1);
  if (!leaf) {
    return records;
  }
  const byId = new Map(treeEntries.map((entry) => [entry.id, entry]));
  const ancestry = new Set<string>();
  for (let current: (typeof treeEntries)[number] | undefined = leaf; current;) {
    if (ancestry.has(current.id)) {
      return [];
    }
    ancestry.add(current.id);
    current =
      typeof current.parentId === "string"
        ? byId.get(current.parentId)
        : undefined;
  }
  return records.filter(
    (record) =>
      isObject(record) &&
      typeof record.id === "string" &&
      ancestry.has(record.id),
  );
};

const projectSnapshot = (
  state: ProjectionState,
  agentAvailable: boolean,
): PiConversationSnapshot => {
  const canonical = activeCanonicalBranch(state.canonicalRecords).flatMap(
    (value) => {
      const entry = entryOf(value, "canonical");
      return entry ? [entry] : [];
    },
  );
  const live = projectLive(sortedStreamRecords(state.streams));
  const matched = matchedLiveIndexes(canonical, live.entries);
  const entries = pairTools(
    [
      ...canonical,
      ...live.entries.filter((_entry, index) => !matched.has(index)),
    ].sort(
      (left, right) =>
        (left.timestamp ?? 0) - (right.timestamp ?? 0) ||
        left.id.localeCompare(right.id),
    ),
    live.tools,
  );
  const degraded = [...state.streams.values()].some(streamHasIssue);
  return piConversationSnapshotSchema.parse({
    entries,
    agentAvailable,
    ...(state.sessionMetadata
      ? { sessionMetadata: state.sessionMetadata }
      : {}),
    status: degraded
      ? "degraded"
      : live.shutdown || (!agentAvailable && !live.active)
        ? "offline"
        : live.active || entries.some((entry) => entry.status === "pending")
          ? "busy"
          : "idle",
  });
};

const configKeyOf = (data: PiAgentResource) =>
  JSON.stringify([data.sessionId, data.sessionFile, data.liveEventsDir]);

const createProjectionState = (data: PiAgentResource): ProjectionState => ({
  canonicalRecords: [],
  canonicalTail: createJsonlTail(),
  configKey: configKeyOf(data),
  refreshQueue: Promise.resolve(),
  sessionMetadata: data.sessionMetadata,
  streams: new Map(),
});

const queueProjectionRefresh = <Result>(
  state: ProjectionState,
  operation: () => Promise<Result>,
) => {
  const result = state.refreshQueue.then(operation);
  state.refreshQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

export const probePiAgent = probePiSession;

export const createPiAgentConversationService = ({
  resolveAgent,
  pollIntervalMs = 250,
  probe = probePiAgent,
}: {
  resolveAgent: (agentId: string) => Promise<PiAgentResource>;
  pollIntervalMs?: number;
  probe?: (sessionId: string) => Promise<boolean>;
}): PiAgentConversationService => {
  const projections = new Map<string, ProjectionState>();
  const subscriptions = new Map<string, Set<SnapshotListener>>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let polling = false;

  const refresh = async (agentId: string) => {
    const data = await resolveAgent(agentId);
    const key = agentId;
    const previous = projections.get(key);
    const state =
      previous?.configKey === configKeyOf(data)
        ? previous
        : createProjectionState(data);
    projections.set(key, state);
    return queueProjectionRefresh(state, async () => {
      const metadataChanged =
        JSON.stringify(state.sessionMetadata) !==
        JSON.stringify(data.sessionMetadata);
      state.sessionMetadata = data.sessionMetadata;
      const [canonicalChanged, streamsChanged, agentAvailable] =
        await Promise.all([
          refreshCanonical(state, data.sessionFile),
          refreshStreams(state, data),
          probe(data.sessionId),
        ]);
      if (
        state.snapshot &&
        !canonicalChanged &&
        !streamsChanged &&
        !metadataChanged &&
        state.agentAvailable === agentAvailable
      ) {
        return state.snapshot;
      }
      const snapshot = projectSnapshot(state, agentAvailable);
      state.agentAvailable = agentAvailable;
      state.snapshot = snapshot;
      return snapshot;
    });
  };

  const poll = async () => {
    if (polling) {
      return;
    }
    polling = true;
    try {
      await Promise.all(
        [...subscriptions.entries()].map(async ([key, listeners]) => {
          const id = key;
          try {
            const state = projections.get(key);
            const before = state?.snapshot;
            const snapshot = await refresh(id);
            if (snapshot !== before) {
              listeners.forEach((listener) => listener(snapshot));
            }
          } catch {
            const state = projections.get(key);
            if (!state || state.agentAvailable === false) {
              return;
            }
            const snapshot = projectSnapshot(state, false);
            state.agentAvailable = false;
            state.snapshot = snapshot;
            listeners.forEach((listener) => listener(snapshot));
          }
        }),
      );
    } finally {
      polling = false;
    }
  };

  const startPolling = () => {
    if (!timer) {
      timer = setInterval(() => void poll(), pollIntervalMs);
    }
  };

  return {
    dispose: () => {
      if (timer) {
        clearInterval(timer);
      }
      timer = undefined;
      subscriptions.clear();
      projections.clear();
    },
    getSnapshot: (agentId) => refresh(agentId),
    subscribe: (agentId, listener) => {
      const key = agentId;
      const listeners = subscriptions.get(key) ?? new Set<SnapshotListener>();
      listeners.add(listener);
      subscriptions.set(key, listeners);
      startPolling();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          subscriptions.delete(key);
        }
        if (!subscriptions.size && timer) {
          clearInterval(timer);
          timer = undefined;
        }
      };
    },
  };
};

export const sendPiAgentMessage = async (
  {
    deliverAs,
    message,
    sessionId,
  }: {
    deliverAs: "followUp" | "steer";
    message: string;
    sessionId: string;
  },
  send: PiMessageSender = sendUserMessage,
): Promise<PiMessageResponse> => {
  const response = await send(sessionId, {
    deliverAs,
    message,
    requestId: randomUUID(),
  });
  if (!response?.ok) {
    throw new Error("Pi agent is unavailable");
  }
  return response;
};
