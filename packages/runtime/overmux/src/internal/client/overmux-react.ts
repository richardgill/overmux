import type {
  ContractInputArguments,
  InstanceIdentity,
} from "../../public/index";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { z } from "zod";

import { skipToken, type SkipToken, useRuntime } from "./commands";

type Resources<TConfig> = TConfig extends { resources?: infer TResources }
  ? NonNullable<TResources>
  : never;
type Operations<TConfig> = TConfig extends { operations?: infer TOperations }
  ? NonNullable<TOperations>
  : never;
type Streams<TConfig> = TConfig extends { streams?: infer TStreams }
  ? NonNullable<TStreams>
  : never;
type ContractOf<T> = T extends { contract: infer TContract }
  ? TContract
  : never;
type InputOf<T> = T extends { input: infer TInput extends z.ZodType }
  ? TInput
  : never;
type OutputOf<T> = T extends { output: infer TOutput extends z.ZodType }
  ? z.output<TOutput>
  : never;
type ClientMessageOf<T> =
  ContractOf<T> extends {
    clientMessage: infer TMessage extends z.ZodType;
  }
    ? z.input<TMessage>
    : never;
type ServerMessageOf<T> =
  ContractOf<T> extends {
    serverMessage: infer TMessage extends z.ZodType;
  }
    ? z.output<TMessage>
    : never;
type InputProperty<TInput extends z.ZodType> =
  undefined extends z.input<TInput>
    ? { input?: Exclude<z.input<TInput>, undefined> }
    : { input: z.input<TInput> };
type OperationOptions<TId extends string, TInput extends z.ZodType> = {
  id: TId;
} & InputProperty<TInput>;
type UseResource<TServerConfig> = {
  <TId extends Extract<keyof Resources<TServerConfig>, string>>(
    options: OperationOptions<
      TId,
      InputOf<ContractOf<Resources<TServerConfig>[TId]>>
    >,
  ): ResourceResult<OutputOf<ContractOf<Resources<TServerConfig>[TId]>>>;
  <TId extends Extract<keyof Resources<TServerConfig>, string>>(options: {
    id: TId;
    input: SkipToken;
  }): undefined;
  <TId extends Extract<keyof Resources<TServerConfig>, string>>(options: {
    id: TId;
    input:
      | z.input<InputOf<ContractOf<Resources<TServerConfig>[TId]>>>
      | SkipToken;
  }):
    | ResourceResult<OutputOf<ContractOf<Resources<TServerConfig>[TId]>>>
    | undefined;
};

export type ResourceResult<T> =
  | {
      data?: never;
      error?: never;
      refetch: () => void;
      status: "pending";
    }
  | {
      data?: T;
      error: Error;
      refetch: () => void;
      status: "error";
    }
  | {
      data: T;
      error?: never;
      refetch: () => void;
      status: "success";
    };

export type StreamResult<TClientMessage, TServerMessage> = {
  // Identifies one server-confirmed stream lifetime, not this hook or its stable methods.
  // Undefined until stream-opened; reconnects and effect restarts receive a fresh identity.
  // Replacement renders report opening, never readiness inherited from the old stream.
  connectionId: symbol | undefined;
  close: () => void;
  error?: Error;
  send: (message: TClientMessage) => boolean;
  status: "closed" | "open" | "opening";
  subscribe: (listener: (message: TServerMessage) => void) => () => void;
};

type OperationResult<TInputSchema extends z.ZodType, TOutput> = Omit<
  UseMutationResult<TOutput, Error, z.input<TInputSchema>>,
  "mutate" | "mutateAsync"
> & {
  mutate: (...args: ContractInputArguments<TInputSchema>) => void;
  mutateAsync: (
    ...args: ContractInputArguments<TInputSchema>
  ) => Promise<TOutput>;
};

const inputKey = (input: unknown) => JSON.stringify(input) ?? "";

const useCanonicalInput = (input: unknown) => {
  const key = inputKey(input);
  return useMemo(() => (key ? JSON.parse(key) : undefined), [key]);
};

const useResourceById = <TOutput>(
  id: string,
  input: unknown,
  skipped: boolean,
): ResourceResult<TOutput> | undefined => {
  const { manifest, overmuxServerApi } = useRuntime();
  const queryClient = useQueryClient();
  const canonicalInput = useCanonicalInput(input);
  const queryKey = useMemo(
    () => [id, canonicalInput] as const,
    [canonicalInput, id],
  );
  const query = useQuery<TOutput, Error>({
    enabled: !skipped,
    queryFn: () =>
      overmuxServerApi.readResource({
        id,
        input: canonicalInput,
      }) as Promise<TOutput>,
    queryKey,
  });
  useEffect(
    () =>
      !skipped && manifest.resources.includes(id)
        ? overmuxServerApi.subscribeResource({
            id,
            input: canonicalInput,
            onError: () =>
              void queryClient.invalidateQueries({ exact: true, queryKey }),
            onInvalidate: () =>
              void queryClient.invalidateQueries({ exact: true, queryKey }),
          })
        : undefined,
    [
      manifest.resources,
      canonicalInput,
      id,
      overmuxServerApi,
      queryClient,
      queryKey,
      skipped,
    ],
  );
  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ exact: true, queryKey });
  }, [queryClient, queryKey]);
  if (skipped) {
    return undefined;
  }
  if (query.status === "pending") {
    return { refetch, status: "pending" };
  }
  if (query.status === "error") {
    return query.data === undefined
      ? { error: query.error, refetch, status: "error" }
      : { data: query.data, error: query.error, refetch, status: "error" };
  }
  return { data: query.data, refetch, status: "success" };
};

const useOperationById = <TInputSchema extends z.ZodType, TOutput>(
  id: string,
  signal?: AbortSignal,
): OperationResult<TInputSchema, TOutput> => {
  const { overmuxServerApi } = useRuntime();
  return useMutation<TOutput, Error, z.input<TInputSchema>>({
    mutationFn: (input) =>
      overmuxServerApi.executeOperation(id, input, signal) as Promise<TOutput>,
  }) as OperationResult<TInputSchema, TOutput>;
};

const useStreamById = <TClientMessage, TServerMessage>(
  id: string,
  input: unknown,
): StreamResult<TClientMessage, TServerMessage> => {
  const { manifest, overmuxServerApi } = useRuntime();
  const streamAvailable = manifest.streams.includes(id);
  const canonicalInput = useCanonicalInput(input);
  // This scope owns the stream-opening effect. Fast Refresh invalidates the memo
  // and restarts that effect; the previous scope's open state is never exposed as
  // readiness for the replacement, even before its passive effect has run.
  const scope = useMemo(
    () => ({ canonicalInput, id, overmuxServerApi, streamAvailable }),
    [canonicalInput, id, overmuxServerApi, streamAvailable],
  );
  const [state, setState] = useState<{
    scope: typeof scope;
    connectionId?: symbol;
    error?: Error;
    status: "closed" | "open" | "opening";
  }>({ scope, status: "opening" });
  // Unlike memoized callbacks, state survives Fast Refresh. Existing consumers
  // keep their subscriptions and methods while the real stream lifetime changes.
  const [listeners] = useState(
    () => new Set<(message: TServerMessage) => void>(),
  );
  const streamRef = useRef<
    ReturnType<typeof overmuxServerApi.openStream> | undefined
  >(undefined);
  useEffect(() => {
    streamRef.current?.close();
    streamRef.current = undefined;
    if (!scope.streamAvailable) {
      setState({ scope, status: "closed" });
      return;
    }
    setState({ scope, status: "opening" });
    let active = true;
    const stream = scope.overmuxServerApi.openStream({
      id: scope.id,
      input: scope.canonicalInput,
      onClose: () => active && setState({ scope, status: "closed" }),
      onError: (error) =>
        active && setState({ scope, error, status: "closed" }),
      // The transport reuses its handle on reconnect, but acknowledges a new server stream.
      onOpen: () =>
        active &&
        setState({ scope, connectionId: Symbol(scope.id), status: "open" }),
      onMessage: (message) =>
        active &&
        listeners.forEach((listener) => listener(message as TServerMessage)),
    });
    const connection = {
      close: () => {
        if (!active) {
          return;
        }
        // Old callbacks must not overwrite the stream created by an effect restart (including HMR).
        active = false;
        if (streamRef.current === connection) {
          streamRef.current = undefined;
        }
        setState({ scope, status: "closed" });
        stream.close();
      },
      send: stream.send,
    };
    streamRef.current = connection;
    return connection.close;
  }, [listeners, scope]);
  const [methods] = useState(() => ({
    close: () => streamRef.current?.close(),
    send: (message: TClientMessage) =>
      streamRef.current?.send(message) ?? false,
    subscribe: (listener: (message: TServerMessage) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  }));
  if (!streamAvailable) {
    return {
      ...methods,
      connectionId: undefined,
      error: new Error(`Stream is not available: ${id}`),
      status: "closed",
    };
  }
  if (state.scope !== scope) {
    return { ...methods, connectionId: undefined, status: "opening" };
  }
  return {
    ...methods,
    connectionId: state.connectionId,
    error: state.error,
    status: state.status,
  };
};

const undiscoveredInstance = () => undefined;

const useInstance = (): InstanceIdentity | undefined => {
  const { overmuxServerApi } = useRuntime();
  return useSyncExternalStore(
    overmuxServerApi.subscribeInstance,
    overmuxServerApi.getInstance,
    undiscoveredInstance,
  );
};

export const createOvermuxHooks = <TServerConfig>() => ({
  useInstance,
  useOperation: <TId extends Extract<keyof Operations<TServerConfig>, string>>({
    id,
    signal,
  }: {
    id: TId;
    signal?: AbortSignal;
  }) => {
    type TInputSchema = InputOf<Operations<TServerConfig>[TId]>;
    type TOutput = OutputOf<Operations<TServerConfig>[TId]>;
    return useOperationById<TInputSchema, TOutput>(id, signal);
  },
  useResource: (({ id, input }: { id: string; input?: unknown }) =>
    useResourceById(
      id,
      input,
      input === skipToken,
    )) as UseResource<TServerConfig>,
  useStream: <TId extends Extract<keyof Streams<TServerConfig>, string>>({
    id,
    input,
  }: OperationOptions<TId, InputOf<ContractOf<Streams<TServerConfig>[TId]>>>) =>
    useStreamById<
      ClientMessageOf<Streams<TServerConfig>[TId]>,
      ServerMessageOf<Streams<TServerConfig>[TId]>
    >(id, input),
});
